// Matrix Orchestration — Current State Scorer (PRD §5.5)
//
// Scores the user's project against every dimension in the
// OrchestrationDimensionMatrix using the locked rubric. Re-uses
// `src/core/compete-matrix.ts` for the underlying gap math and optionally
// `src/core/adversarial-scorer-dim.ts` when `strict === true`.

import type {
  OrchestrationDimension,
  OrchestrationDimensionMatrix,
} from '../types.js';
import { saveOrch, appendAudit } from '../state-io.js';

// ── Options ─────────────────────────────────────────────────────────────────

export interface CurrentStateScorerOptions {
  cwd: string;
  mode?: 'llm' | 'prompt' | 'local';
  strict?: boolean;
  runId?: string;
  /** LLM caller seam for per-dimension scoring. */
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  /** Harsh scorer seam — not invoked directly in v1 but reserved for §5.5 calibration. */
  _harshScore?: (...args: unknown[]) => Promise<unknown>;
  /** Adversarial seam, used when strict===true. Receives `{ dimension, currentScore }`. */
  _adversarialScore?: (input: {
    dimension: OrchestrationDimension;
    currentScore: number;
  }) => Promise<{ adversarialScore: number; verdict: 'inflated' | 'trusted' | 'watch' | 'underestimated' }>;
  _now?: () => string;
}

export interface CurrentStateScoreReport {
  generatedAt: string;
  scores: Record<string, number>; // dimensionId → score
  overall: number;
  strictMode: boolean;
  adversarialDowngrades?: Array<{ dimensionId: string; before: number; after: number }>;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function scoreCurrentState(
  matrix: OrchestrationDimensionMatrix,
  options: CurrentStateScorerOptions,
): Promise<OrchestrationDimensionMatrix> {
  const now = options._now ?? (() => new Date().toISOString());
  const mode = options.mode ?? 'llm';
  const strict = options.strict === true;

  const llmAvailable = options._isLLMAvailable
    ? await options._isLLMAvailable()
    : false;

  const downgrades: Array<{ dimensionId: string; before: number; after: number }> = [];
  const updated: OrchestrationDimension[] = [];

  for (const dim of matrix.dimensions) {
    let score = 0;
    if (mode !== 'local' && llmAvailable && options._llmCaller) {
      const raw = await safeLLM(options._llmCaller, buildScorePrompt(dim));
      score = parseScore(raw, /*fallback*/ 0);
    } else {
      // Local-mode fallback: optimistic baseline at 0 — caller is expected to
      // hydrate from compete-matrix downstream.
      score = 0;
    }

    let finalScore = clampScore(score);

    if (strict && options._adversarialScore) {
      try {
        const adv = await options._adversarialScore({
          dimension: dim,
          currentScore: finalScore,
        });
        if (adv.verdict === 'inflated' && adv.adversarialScore < finalScore) {
          downgrades.push({
            dimensionId: dim.dimensionId,
            before: finalScore,
            after: adv.adversarialScore,
          });
          finalScore = clampScore(adv.adversarialScore);
        }
      } catch {
        /* best-effort */
      }
    }

    const ossFrontierScore = dim.ossFrontierScore;
    const closedFrontierScore = dim.closedFrontierScore;
    updated.push({
      ...dim,
      currentScore: finalScore,
      gapToOssFrontier: Math.max(0, ossFrontierScore - finalScore),
      gapToClosedFrontier: Math.max(0, closedFrontierScore - finalScore),
    });
  }

  const overall = weightedAverage(updated, 'currentScore');
  const updatedMatrix: OrchestrationDimensionMatrix = {
    ...matrix,
    dimensions: updated,
    overallCurrentScore: overall,
    overallOssFrontierScore: weightedAverage(updated, 'ossFrontierScore'),
    overallClosedFrontierScore: weightedAverage(updated, 'closedFrontierScore'),
    generatedAt: now(),
  };

  await saveOrch(options.cwd, 'dimensionMatrix', updatedMatrix);

  const scoresMap: Record<string, number> = {};
  for (const d of updated) scoresMap[d.dimensionId] = d.currentScore;

  const report: CurrentStateScoreReport = {
    generatedAt: now(),
    scores: scoresMap,
    overall,
    strictMode: strict,
    ...(downgrades.length > 0 ? { adversarialDowngrades: downgrades } : {}),
  };
  await saveOrch(options.cwd, 'currentStateScore', report);

  await safeAudit(options, {
    component: 'current-state-scorer',
    dimensionsScored: updated.length,
    overall,
    strict,
    downgrades: downgrades.length,
  });

  return updatedMatrix;
}

// ── Internals ───────────────────────────────────────────────────────────────

function buildScorePrompt(dim: OrchestrationDimension): string {
  return `You are scoring the user's project against this rubric.

Dimension: ${dim.name}
Category: ${dim.category}

Rubric:
  5 — ${dim.rubric.score5}
  7 — ${dim.rubric.score7}
  9 — ${dim.rubric.score9}

Evidence required for a 9: ${(dim.evidenceRequired ?? []).join('; ') || 'unspecified'}

Score the project from 0.0 to 10.0. Return STRICT JSON (no markdown fences):
{ "score": <number>, "rationale": "<one-sentence>" }
`;
}

async function safeLLM(
  caller: (prompt: string) => Promise<string>,
  prompt: string,
): Promise<string | null> {
  try {
    return await caller(prompt);
  } catch {
    return null;
  }
}

function parseScore(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const body = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.score === 'number') return obj.score;
    }
  } catch {
    // try bare-number parsing
    const n = Number(body);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 10) return 10;
  return Math.round(n * 10) / 10;
}

function weightedAverage(
  dims: OrchestrationDimension[],
  field: 'currentScore' | 'ossFrontierScore' | 'closedFrontierScore',
): number {
  const totalW = dims.reduce((s, d) => s + d.weight, 0);
  if (totalW <= 0) return 0;
  const sum = dims.reduce((s, d) => s + d.weight * d[field], 0);
  return Math.round((sum / totalW) * 10) / 10;
}

async function safeAudit(
  options: CurrentStateScorerOptions,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await appendAudit(options.cwd, {
      ts: options._now ? options._now() : new Date().toISOString(),
      runId: options.runId ?? 'current-state-scorer',
      kind: 'stage_completed',
      stage: 'scoring_current_state',
      payload,
    });
  } catch {
    /* best-effort */
  }
}
