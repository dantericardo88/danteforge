// adversarial-critique.ts — Generates an adversarial critique of work done toward
// a competitive dimension target using a separate LLM (scorerProvider).
//
// Key insight (validated empirically): LLMs scrutinize other models' work more
// harshly than their own output. A different provider as "critic" surfaces blind
// spots the forge provider would overlook. The framing "you are NOT the author"
// activates adversarial evaluation instead of confirmation bias.

import { callLLM } from './llm.js';
import type { LLMProvider } from './config.js';
import type { MatrixDimension } from './compete-matrix.js';
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AdversarialCritique {
  satisfied: boolean;
  currentScore: number;
  targetScore: number;
  gapAnalysis: string;
  concreteActions: string[];
  /** Pre-formatted for direct injection into next forge cycle goal */
  critiquePrompt: string;
  scorerProvider?: string;
  generatedAt: string;
}

export interface AdversarialCritiqueOptions {
  scorerProvider?: string;
  cwd?: string;
  /** Injection seam: replaces callLLM for testing. Same signature as callLLM. */
  _callLLM?: (prompt: string, provider?: LLMProvider) => Promise<string>;
}

// ── Prompt template ───────────────────────────────────────────────────────────
// "competitive position not code existence" is the key phrase that prevents
// the score-inflation pattern seen in single-LLM ascend sessions.

function buildCritiquePrompt(
  dimensionLabel: string,
  currentScore: number,
  targetScore: number,
  recentWorkSummary: string,
): string {
  return `You are a skeptical senior engineer reviewing code written by SOMEONE ELSE.
Your task: evaluate whether the work genuinely improves "${dimensionLabel}" from ${currentScore.toFixed(1)}/10 toward ${targetScore.toFixed(1)}/10.
You are NOT the author. Find what is STILL missing or unconvincing.

RECENT WORK SUMMARY:
${recentWorkSummary}

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{
  "satisfied": boolean,
  "gapAnalysis": "string — what is STILL missing or unconvincing",
  "concreteActions": ["action1", "action2", "action3"]
}

Be harsh. "satisfied" should be true ONLY if the work is genuinely close to ${targetScore.toFixed(1)}/10.
Score COMPETITIVE POSITION, not code existence. Does this beat leading alternatives at this dimension?
Code that exists but is not wired into the execution path does NOT count.`;
}

// ── Safe JSON parse ───────────────────────────────────────────────────────────

interface CritiqueRaw {
  satisfied?: unknown;
  gapAnalysis?: unknown;
  concreteActions?: unknown;
}

function parseCritiqueResponse(raw: string): CritiqueRaw | null {
  // Try to extract JSON from response (model may wrap in markdown)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as CritiqueRaw;
  } catch {
    return null;
  }
}

function buildCritiquePromptText(
  dimension: MatrixDimension,
  gapAnalysis: string,
  concreteActions: string[],
): string {
  const actionLines = concreteActions
    .slice(0, 5)
    .map((a, i) => `${i + 1}. ${a}`)
    .join('\n');

  return `ADVERSARIAL CRITIQUE (${dimension.label}):
${gapAnalysis}

REQUIRED ACTIONS FOR NEXT CYCLE:
${actionLines || '(no specific actions provided)'}`;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateAdversarialCritique(
  dimension: MatrixDimension,
  currentScore: number,
  targetScore: number,
  recentWorkSummary: string,
  options: AdversarialCritiqueOptions = {},
): Promise<AdversarialCritique> {
  const callLLMFn = options._callLLM ?? callLLM;
  const scorerProvider = options.scorerProvider as LLMProvider | undefined;

  const prompt = buildCritiquePrompt(
    dimension.label,
    currentScore,
    targetScore,
    recentWorkSummary,
  );

  let rawResponse: string;
  try {
    rawResponse = await callLLMFn(prompt, scorerProvider);
  } catch (err) {
    logger.warn(`[AdversarialCritique] LLM call failed: ${String(err)} — using conservative fallback`);
    return buildFallback(dimension, currentScore, targetScore, scorerProvider);
  }

  const parsed = parseCritiqueResponse(rawResponse);
  if (!parsed) {
    logger.warn(`[AdversarialCritique] Could not parse LLM response as JSON — using conservative fallback`);
    return buildFallback(dimension, currentScore, targetScore, scorerProvider);
  }

  const satisfied = typeof parsed.satisfied === 'boolean' ? parsed.satisfied : false;
  const gapAnalysis = typeof parsed.gapAnalysis === 'string' && parsed.gapAnalysis.length > 0
    ? parsed.gapAnalysis
    : `No gap analysis provided. Score ${currentScore.toFixed(1)} has not convincingly reached ${targetScore.toFixed(1)}.`;
  const concreteActions = Array.isArray(parsed.concreteActions)
    ? (parsed.concreteActions as unknown[]).filter((a): a is string => typeof a === 'string')
    : [];

  return {
    satisfied,
    currentScore,
    targetScore,
    gapAnalysis,
    concreteActions,
    critiquePrompt: buildCritiquePromptText(dimension, gapAnalysis, concreteActions),
    scorerProvider: options.scorerProvider,
    generatedAt: new Date().toISOString(),
  };
}

function buildFallback(
  dimension: MatrixDimension,
  currentScore: number,
  targetScore: number,
  scorerProvider?: LLMProvider,
): AdversarialCritique {
  const gapAnalysis = `Unable to generate critique. Score ${currentScore.toFixed(1)}/10 has not reached target ${targetScore.toFixed(1)}/10 for ${dimension.label}.`;
  return {
    satisfied: false,
    currentScore,
    targetScore,
    gapAnalysis,
    concreteActions: [],
    critiquePrompt: buildCritiquePromptText(
      dimension,
      gapAnalysis,
      [],
    ),
    scorerProvider: scorerProvider as string | undefined,
    generatedAt: new Date().toISOString(),
  };
}
