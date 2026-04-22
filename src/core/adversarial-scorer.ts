// Adversarial Scorer — debate-style LLM evaluation.
// Two independent LLM calls per assessment: advocate finds improvements,
// adversary finds regressions. Final score = (advocate + adversary) / 2.
//
// Pattern derived from MT-Bench / LLM-as-judge research:
// single-evaluator scoring is biased toward the evaluator's training distribution.
// Debate-style evaluation (advocate + harsh adversary) produces scores with
// implicit error bars and catches gaming that a single call misses.
//
// The adversary prompt is explicitly instructed to be unforgiving:
// "Find every way this code is WORSE. Be specific. Do not look for positives."

import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DebateResult {
  /** Score from advocate perspective: what improved (0-10). */
  advocateScore: number;
  /** Score from adversary perspective: 10 = nothing got worse, 0 = everything got worse. */
  adversaryScore: number;
  /** Blended debate score: (advocate + adversary) / 2. */
  debateScore: number;
  advocateSummary: string;
  adversarySummary: string;
  /** true when |advocate - adversary| > 2.0 — scores are in genuine disagreement. */
  contested: boolean;
  /** Confidence: 1.0 - (|advocate - adversary| / 10). Lower = more contested. */
  confidence: number;
}

export interface AdversarialScorerOptions {
  /** Inject for testing — replaces real LLM calls. */
  _llmCaller?: (prompt: string) => Promise<string>;
  /** Inject for testing — controls whether LLM is attempted. */
  _isLLMAvailable?: () => Promise<boolean>;
  /** How wide a disagreement triggers "contested". Default 2.0. */
  contestThreshold?: number;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

/**
 * Advocate prompt: find genuine improvements, score optimistically.
 * Exported for testing.
 */
export function buildAdvocatePrompt(currentCode: string, previousCode: string): string {
  return `You are a senior software engineer reviewing a code change.
Your role is ADVOCATE: find genuine improvements in the new version.

PREVIOUS CODE:
${previousCode.slice(0, 3000)}

CURRENT CODE:
${currentCode.slice(0, 3000)}

Assess the CURRENT code on these dimensions (score each 0-10):
- Correctness: does the logic appear sound?
- Readability: is it easier to understand than before?
- Error handling: are edge cases better handled?
- Test quality: are tests more meaningful (not just more tests)?

Respond with a JSON object:
{
  "score": <overall 0-10 score for the current version>,
  "summary": "<2-3 sentences on what specifically improved>"
}

Only output valid JSON. No other text.`;
}

/**
 * Adversary prompt: find regressions and weaknesses, score pessimistically.
 * Exported for testing.
 */
export function buildAdversaryPrompt(currentCode: string, previousCode: string): string {
  return `You are a senior software engineer doing adversarial code review.
Your role is ADVERSARY: find every way the new version is WORSE than the previous.
Be specific and unforgiving. Do not look for positives — only regressions.

PREVIOUS CODE:
${previousCode.slice(0, 3000)}

CURRENT CODE:
${currentCode.slice(0, 3000)}

Look specifically for:
- Logic regressions (correct code made incorrect)
- Removed error handling or safety checks
- Tests that only test the happy path (never assert on failures)
- Tests written to pass rather than to catch bugs (trivially true assertions)
- Increased complexity without justification
- Metrics that improved by gaming (e.g. eslint disabled, type assertions added)

Respond with a JSON object where score 10 = nothing got worse, 0 = severe regression:
{
  "score": <0-10, where 10 = no regressions found>,
  "summary": "<2-3 sentences on specific regressions or weaknesses found>"
}

Only output valid JSON. No other text.`;
}

/**
 * Parse a 0-10 score from an LLM JSON response.
 * Exported for testing.
 */
export function parseScoreFromResponse(response: string): number {
  try {
    // Try direct JSON parse
    const parsed = JSON.parse(response.trim()) as { score?: unknown };
    const score = Number(parsed.score);
    if (!isNaN(score)) return Math.max(0, Math.min(10, score));
  } catch { /* fall through to regex */ }

  // Fallback: extract first number after "score":
  const match = /"score"\s*:\s*(\d+(?:\.\d+)?)/.exec(response);
  if (match) {
    const score = parseFloat(match[1]);
    if (!isNaN(score)) return Math.max(0, Math.min(10, score));
  }

  // Last resort: first standalone number 0-10
  const numMatch = /\b([0-9]|10)(?:\.\d+)?\b/.exec(response);
  if (numMatch) return Math.max(0, Math.min(10, parseFloat(numMatch[1])));

  return 5.0; // neutral fallback
}

/**
 * Parse summary string from LLM JSON response.
 */
function parseSummaryFromResponse(response: string): string {
  try {
    const parsed = JSON.parse(response.trim()) as { summary?: unknown };
    if (typeof parsed.summary === 'string') return parsed.summary;
  } catch { /* fall through */ }

  const match = /"summary"\s*:\s*"([^"]*)"/.exec(response);
  return match ? match[1] : '(no summary)';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run debate-style adversarial scoring on a code change.
 *
 * When LLM is unavailable, returns a neutral result (5.0/5.0) so the rest
 * of the pipeline is not blocked.
 */
export async function runDebateScore(
  currentCode: string,
  previousCode: string,
  opts: AdversarialScorerOptions = {},
): Promise<DebateResult> {
  const contestThreshold = opts.contestThreshold ?? 2.0;
  const isLLMAvailable = opts._isLLMAvailable ?? (async () => false);
  const llmCaller = opts._llmCaller;

  const available = await isLLMAvailable().catch(() => false);
  if (!available || !llmCaller) {
    logger.info('[adversarial-scorer] LLM unavailable — returning neutral debate result');
    return neutralResult(contestThreshold);
  }

  const advocatePrompt = buildAdvocatePrompt(currentCode, previousCode);
  const adversaryPrompt = buildAdversaryPrompt(currentCode, previousCode);

  // Run both calls — parallel when possible, sequential fallback
  const [advocateResponse, adversaryResponse] = await Promise.all([
    llmCaller(advocatePrompt).catch(() => '{"score": 5, "summary": "unavailable"}'),
    llmCaller(adversaryPrompt).catch(() => '{"score": 5, "summary": "unavailable"}'),
  ]);

  const advocateScore = parseScoreFromResponse(advocateResponse);
  const adversaryScore = parseScoreFromResponse(adversaryResponse);
  const debateScore = Math.round(((advocateScore + adversaryScore) / 2) * 100) / 100;
  const gap = Math.abs(advocateScore - adversaryScore);
  const contested = gap > contestThreshold;
  const confidence = Math.round((1 - gap / 10) * 100) / 100;

  if (contested) {
    logger.warn(`[adversarial-scorer] Contested result — advocate: ${advocateScore.toFixed(1)}, adversary: ${adversaryScore.toFixed(1)}, gap: ${gap.toFixed(1)}`);
  }

  return {
    advocateScore,
    adversaryScore,
    debateScore,
    advocateSummary: parseSummaryFromResponse(advocateResponse),
    adversarySummary: parseSummaryFromResponse(adversaryResponse),
    contested,
    confidence,
  };
}

function neutralResult(contestThreshold: number): DebateResult {
  return {
    advocateScore: 5.0,
    adversaryScore: 5.0,
    debateScore: 5.0,
    advocateSummary: 'LLM unavailable',
    adversarySummary: 'LLM unavailable',
    contested: false,
    confidence: 1.0,
  };
}

/**
 * Blend a debate score into an existing hybrid score.
 * debate contributes 50% when available, 0% when neutral (LLM unavailable).
 */
export function blendDebateScore(
  hybridScore: number,
  debate: DebateResult,
): number {
  if (debate.advocateSummary === 'LLM unavailable') return hybridScore;
  const blended = 0.5 * hybridScore + 0.5 * debate.debateScore;
  return Math.round(blended * 100) / 100;
}
