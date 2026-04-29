// 7 Levels Deep — Root Cause Analysis Engine
// Adapted from Dean Graziosi's "7 Levels Deep" methodology applied to engineering verification.
// When DanteForge verification fails, this engine asks "why" seven times to find the root cause.
// Each level peels back one layer of causation, from symptom to fundamental truth.

import { callLLM } from './llm.js';
import { logger } from './logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LevelDomain =
  | 'symptom'      // Level 1: what failed
  | 'code'         // Level 2: code-level cause
  | 'model'        // Level 3: model reasoning cause
  | 'context'      // Level 4: context/prompt cause
  | 'system'       // Level 5: system pipeline cause
  | 'architecture' // Level 6: architectural blind spot
  | 'root_truth';  // Level 7: fundamental assumption

export interface LevelAnalysis {
  level: number;
  question: string;
  answer: string;
  domain: LevelDomain;
  confidence: number;  // 0–1
  actionable: boolean; // whether this level's finding suggests a concrete fix
}

export interface SevenLevelsResult {
  taskDescription: string;
  failureType: string;    // e.g. "pdse_below_threshold" | "antistub_violation" | "step_failure"
  failureDetails: string;
  levels: LevelAnalysis[];
  rootCause: string;
  rootCauseDomain: LevelDomain;
  suggestedFix: string;
  lessonForFuture: string;
  modelAttribution?: string;
  depthReached: number;   // how many levels were actually analyzed (3–7)
}

export interface SevenLevelsConfig {
  /** Minimum depth to analyze. Default: 3. */
  minDepth?: number;
  /** Maximum depth. Default: 7. */
  maxDepth?: number;
  /** Stop early if a clearly actionable root cause is found. Default: true. */
  earlyStop?: boolean;
  /** Confidence threshold to accept a level's analysis as actionable. Default: 0.6. */
  confidenceThreshold?: number;
  /** Override model for analysis (format: "provider:modelId"). */
  analysisModel?: string;
  /** Inject a custom LLM caller for testing without real API calls. */
  _llmCaller?: (prompt: string) => Promise<string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CODE_CHARS = 2000;

const DOMAIN_MAP: Record<number, LevelDomain> = {
  1: 'symptom',
  2: 'code',
  3: 'model',
  4: 'context',
  5: 'system',
  6: 'architecture',
  7: 'root_truth',
};

const LEVEL_QUESTIONS: Record<number, string> = {
  1: 'What failed? (Symptom identification — the specific output failure)',
  2: 'Why did the code fail? (Code-level cause — the coding mistake)',
  3: 'Why did the model make this mistake? (Model reasoning cause)',
  4: 'Why did the model lack this knowledge? (Context/prompt cause)',
  5: 'Why was the context insufficient? (System pipeline cause)',
  6: 'Why does the system have this blind spot? (Architecture-level cause)',
  7: 'What fundamental assumption is wrong? (Root truth)',
};

const LEVEL_PROMPTS: Record<number, string> = {
  1: `You are analyzing a DanteForge verification failure. Respond with JSON only — no markdown fences.

TASK: {taskDescription}
FAILURE: {failureType} — {failureDetails}
CODE (relevant section): {codeSnippet}

Level 1 — WHAT FAILED?
Identify the specific symptom. What exactly is wrong with the output?
Be precise: name the function, the line, the missing piece.
Do NOT suggest fixes yet. Only diagnose the symptom.

{"answer": "<symptom description>", "confidence": 0.0, "actionable": false, "suggestedFix": ""}`,

  2: `You are analyzing a DanteForge verification failure. Respond with JSON only — no markdown fences.

Previous analysis:
Level 1 (Symptom): {level1Answer}

Level 2 — WHY DID THE CODE FAIL?
Go deeper than the symptom. Why is this specific piece of code wrong?
What coding mistake or misunderstanding produced this symptom?
Focus on the code-level cause, not the model or the system.

{"answer": "<code-level cause>", "confidence": 0.0, "actionable": true, "suggestedFix": "<concrete code fix>"}`,

  3: `You are analyzing a DanteForge verification failure. Respond with JSON only — no markdown fences.

Previous analysis:
Level 1 (Symptom): {level1Answer}
Level 2 (Code cause): {level2Answer}

Level 3 — WHY DID THE MODEL MAKE THIS MISTAKE?
This is about the model's reasoning, not the code. Why did the AI model
produce this incorrect code? What did it misunderstand, hallucinate,
or fail to consider? What knowledge gap does this reveal?

{"answer": "<model reasoning failure>", "confidence": 0.0, "actionable": true, "suggestedFix": "<model guidance fix>"}`,

  4: `You are analyzing a DanteForge verification failure. Respond with JSON only — no markdown fences.

Previous analysis:
{previousSummary}

Level 4 — WHY DID THE MODEL LACK THIS KNOWLEDGE?
Look at the context the model was given. Was the system prompt insufficient?
Was the task description ambiguous? Was relevant documentation missing?
Was the wrong model selected for this task type?
Focus on what the SYSTEM provided to the model, not the model itself.

{"answer": "<context/prompt cause>", "confidence": 0.0, "actionable": true, "suggestedFix": "<context improvement>"}`,

  5: `You are analyzing a DanteForge verification failure. Respond with JSON only — no markdown fences.

Previous analysis:
{previousSummary}

Level 5 — WHY WAS THE CONTEXT INSUFFICIENT?
Look at the pipeline that assembled the context. Did skill decomposition
miss a subtask? Did the wave planner classify incorrectly? Did the repo
map fail to surface relevant files? Did memory recall miss a relevant lesson?
Focus on the SYSTEM PIPELINE, not the context itself.

{"answer": "<system pipeline cause>", "confidence": 0.0, "actionable": true, "suggestedFix": "<pipeline fix>"}`,

  6: `You are analyzing a DanteForge verification failure. Respond with JSON only — no markdown fences.

Previous analysis:
{previousSummary}

Level 6 — WHY DOES THE SYSTEM HAVE THIS BLIND SPOT?
Now we're at the architectural level. What mechanism is missing from
DanteForge's architecture that would have prevented this? What assumption
in the system design led to this pipeline gap?

{"answer": "<architectural blind spot>", "confidence": 0.0, "actionable": true, "suggestedFix": "<architectural change>"}`,

  7: `You are analyzing a DanteForge verification failure. Respond with JSON only — no markdown fences.

Previous analysis:
{previousSummary}

Level 7 — WHAT FUNDAMENTAL ASSUMPTION IS WRONG?
This is the deepest level. What belief or assumption — about the task domain,
about how models work, about how code should be structured — is fundamentally
incorrect? If you could fix ONE thing that would prevent this ENTIRE CLASS
of failures (not just this instance), what would it be?
Your answer should be a general principle, not a specific code fix.

{"answer": "<fundamental assumption>", "confidence": 0.0, "actionable": true, "suggestedFix": "<systemic fix principle>"}`,
};

// ─── Static Helpers ───────────────────────────────────────────────────────────

/**
 * Determine if a 7 Levels Deep analysis should be triggered based on PDSE score.
 * Returns true when score is below threshold (significant failure warrants deep analysis).
 */
export function shouldTriggerSevenLevels(pdseScore: number | undefined, threshold: number): boolean {
  if (pdseScore === undefined) return true;
  return pdseScore < threshold;
}

/**
 * Truncate a code snippet to prevent prompt overflow.
 */
export function truncateCode(code: string, maxChars = MAX_CODE_CHARS): string {
  if (code.length <= maxChars) return code;
  return code.slice(0, maxChars) + `\n... [truncated — ${code.length - maxChars} additional chars omitted]`;
}

function isCodeTruncated(code: string, maxChars = MAX_CODE_CHARS): boolean {
  return code.length > maxChars;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class SevenLevelsEngine {
  private readonly minDepth: number;
  private readonly maxDepth: number;
  private readonly earlyStop: boolean;
  private readonly confidenceThreshold: number;
  private readonly llmCaller: (prompt: string) => Promise<string>;

  constructor(config: SevenLevelsConfig = {}) {
    this.minDepth = Math.max(1, config.minDepth ?? 3);
    this.maxDepth = Math.min(7, config.maxDepth ?? 7);
    this.earlyStop = config.earlyStop ?? true;
    this.confidenceThreshold = config.confidenceThreshold ?? 0.6;
    this.llmCaller = config._llmCaller ?? (
      (prompt: string) => callLLM(prompt, undefined, { recordMemory: false })
    );
  }

  /**
   * Run 7 Levels Deep analysis on a verification failure.
   * Asks "why" iteratively, building on each prior level's findings.
   */
  async analyze(
    failure: {
      type: string;
      details: string;
      pdseScore?: number;
      violations?: string[];
    },
    context: {
      taskDescription: string;
      generatedCode: string;
      systemPrompt: string;
      modelId: string;
      providerId: string;
      waveState?: unknown;
      skillsUsed?: string[];
    },
  ): Promise<SevenLevelsResult> {
    const levels: LevelAnalysis[] = [];
    const codeSnippet = truncateCode(context.generatedCode ?? '');

    for (let level = 1; level <= this.maxDepth; level++) {
      const question = LEVEL_QUESTIONS[level] ?? `Level ${level} — Why?`;
      const prompt = this.buildLevelPrompt(level, levels, failure, context, codeSnippet);

      let raw: string;
      try {
        raw = await this.llmCaller(prompt);
      } catch (err) {
        logger.warn(`[7LD] Level ${level} LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
        raw = JSON.stringify({
          answer: `Level ${level} analysis unavailable due to LLM error.`,
          confidence: 0.3,
          actionable: false,
          suggestedFix: '',
        });
      }

      const parsed = this.parseAnalysisResponse(raw);
      const domain = this.classifyDomain(level);

      // Enforce: below-threshold confidence overrides actionable to false
      const actionable = parsed.confidence >= this.confidenceThreshold && parsed.actionable;

      const levelAnalysis: LevelAnalysis = {
        level,
        question,
        answer: parsed.answer,
        domain,
        confidence: parsed.confidence,
        actionable,
      };

      levels.push(levelAnalysis);
      logger.info(`[7LD] L${level} (${domain}): ${levelAnalysis.answer.slice(0, 80)}...`);

      // Early stop only after minDepth is reached
      if (level >= this.minDepth && this.shouldStopEarlyForLevel(levelAnalysis)) {
        logger.info(`[7LD] Early stop at level ${level} — actionable root cause found`);
        break;
      }
    }

    const deepest = levels[levels.length - 1]!;
    const suggestedFix = this.extractSuggestedFix(levels);
    const lessonForFuture = this.extractLesson(levels, failure.type);

    return {
      taskDescription: context.taskDescription,
      failureType: failure.type,
      failureDetails: failure.details,
      levels,
      rootCause: deepest.answer,
      rootCauseDomain: deepest.domain,
      suggestedFix,
      lessonForFuture,
      modelAttribution: context.modelId !== '' ? context.modelId : undefined,
      depthReached: levels.length,
    };
  }

  private buildLevelPrompt(
    level: number,
    previousLevels: LevelAnalysis[],
    failure: { type: string; details: string },
    context: { taskDescription: string; generatedCode: string },
    codeSnippet: string,
  ): string {
    const template = LEVEL_PROMPTS[level] ?? LEVEL_PROMPTS[7]!;

    const previousSummary = previousLevels
      .map(l => `Level ${l.level} (${l.domain}): ${l.answer}`)
      .join('\n');

    return template
      .replace('{taskDescription}', context.taskDescription || '(no task description provided)')
      .replace('{failureType}', failure.type)
      .replace('{failureDetails}', failure.details)
      .replace('{codeSnippet}', codeSnippet || '(no code provided)')
      .replace('{level1Answer}', previousLevels[0]?.answer ?? '(not yet analyzed)')
      .replace('{level2Answer}', previousLevels[1]?.answer ?? '(not yet analyzed)')
      .replace('{previousSummary}', previousSummary || '(no previous analysis)');
  }

  private parseAnalysisResponse(
    response: string,
  ): { answer: string; confidence: number; actionable: boolean; suggestedFix: string } {
    // Strip markdown code fences if present
    const stripped = response.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

    // Extract the first JSON object
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const answer = typeof parsed['answer'] === 'string' && parsed['answer'].length > 0
          ? parsed['answer']
          : stripped.slice(0, 600);
        const rawConf = parsed['confidence'];
        const confidence = typeof rawConf === 'number'
          ? Math.max(0, Math.min(1, rawConf))
          : 0.7;
        const actionable = typeof parsed['actionable'] === 'boolean'
          ? parsed['actionable']
          : confidence >= 0.7;
        const suggestedFix = typeof parsed['suggestedFix'] === 'string'
          ? parsed['suggestedFix']
          : '';
        return { answer, confidence, actionable, suggestedFix };
      } catch {
        // Fall through to plain text handling
      }
    }

    // Plain text fallback — treat whole response as the answer
    return {
      answer: stripped.slice(0, 800).trim() || '(empty response)',
      confidence: 0.7,
      actionable: false,
      suggestedFix: '',
    };
  }

  private classifyDomain(level: number): LevelDomain {
    return DOMAIN_MAP[level] ?? 'root_truth';
  }

  private shouldStopEarlyForLevel(level: LevelAnalysis): boolean {
    return this.earlyStop && level.actionable && level.confidence >= this.confidenceThreshold;
  }

  private extractSuggestedFix(levels: LevelAnalysis[]): string {
    // Walk from deepest to shallowest — find the deepest actionable level
    for (let i = levels.length - 1; i >= 0; i--) {
      const l = levels[i]!;
      if (l.actionable && l.confidence >= this.confidenceThreshold) {
        return `[${l.domain}] ${l.answer.slice(0, 400)}`;
      }
    }
    // Fallback: use deepest level regardless of actionable flag
    const deepest = levels[levels.length - 1];
    return deepest
      ? `[${deepest.domain}] ${deepest.answer.slice(0, 400)}`
      : 'No fix identified — check logs for LLM errors.';
  }

  private extractLesson(levels: LevelAnalysis[], failureType: string): string {
    const deepest = levels[levels.length - 1];
    if (!deepest) return `Verification failure (${failureType}) — investigate root cause.`;

    // Generalize: state the domain pattern, not the task-specific instance
    const domainLabel = deepest.domain.replace('_', ' ').toUpperCase();
    const insight = deepest.answer.length > 400
      ? deepest.answer.slice(0, 400) + '...'
      : deepest.answer;

    return `[${domainLabel}] ${failureType} class — ${insight}`;
  }
}
