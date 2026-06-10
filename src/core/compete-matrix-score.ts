// compete-matrix-score.ts — Scoring and calibration functions for the CompeteMatrix.
// Split from compete-matrix.ts to keep files under the 750-LOC hard cap.
import type {
  MatrixDimension,
  CompeteMatrix,
  AdversarialCalibration,
} from './compete-matrix.js';
// The single sanctioned score-write gate. updateDimensionScore + applyAdversarialCalibration
// delegate to it so this file no longer assigns `scores.self` directly (grep-guard enforced).
// Runtime-only circular import: writeVerifiedScore is called inside function bodies, never at
// module load, so the binding is always resolved by the time it runs.
import { writeVerifiedScore } from './write-verified-score.js';
import { MARKET_CAPPED_DIMS, MARKET_DIM_MAX_SCORE } from './market-dims.js';

// ── Priority Constants ────────────────────────────────────────────────────────

export const FREQUENCY_MULTIPLIERS: Record<string, number> = {
  high: 1.5,
  medium: 1.0,
  low: 0.5,
};

// ── Scoring ───────────────────────────────────────────────────────────────────

export function computeGapPriority(dim: MatrixDimension): number {
  const freq = FREQUENCY_MULTIPLIERS[dim.frequency] ?? 1.0;
  // A real project's matrix can carry a null/undefined gap (unscored dim). Treat it as 0 (lowest
  // priority) rather than coercing to NaN/0 implicitly — keeps the reduce in getNextSprintDimension
  // total and deterministic instead of NaN-poisoned.
  const weight = Number.isFinite(dim.weight) ? dim.weight : 1;
  const gap = Number.isFinite(dim.gap_to_leader) ? dim.gap_to_leader : 0;
  return weight * gap * freq;
}

export function getNextSprintDimension(matrix: CompeteMatrix, target = 9.0): MatrixDimension | null {
  const excluded = new Set(matrix.excludedDimensions ?? []);
  const eligible = matrix.dimensions.filter(d =>
    !excluded.has(d.id) &&
    d.status !== 'closed' &&
    decisionDimScore(d) < target &&
    (d.ceiling === undefined || (d.ceiling >= target && decisionDimScore(d) < d.ceiling)),
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, d) =>
    computeGapPriority(d) > computeGapPriority(best) ? d : best,
  );
}

export function classifyDimensions(matrix: CompeteMatrix, target = 9.0): {
  achievable: MatrixDimension[];
  atCeiling: MatrixDimension[];
} {
  const excluded = new Set(matrix.excludedDimensions ?? []);
  const atCeiling = matrix.dimensions.filter(d =>
    !excluded.has(d.id) &&
    d.status !== 'closed' &&
    d.ceiling !== undefined &&
    (d.ceiling < target || decisionDimScore(d) >= d.ceiling),
  );
  const atCeilingIds = new Set(atCeiling.map(d => d.id));
  const achievable = matrix.dimensions.filter(d =>
    !excluded.has(d.id) && d.status !== 'closed' && !atCeilingIds.has(d.id),
  );
  return { achievable, atCeiling };
}

export function effectiveDimScore(dim: { scores: Record<string, number> }): number {
  const self = dim.scores['self'] ?? 0;
  const derived = dim.scores['derived'];
  return derived !== undefined ? Math.min(self, derived) : self;
}

/**
 * Decision cap for a dim that declares outcomes but has NO fresh evidence to back them.
 * Depth doctrine: code without a fresh receipt is a hypothesis, not a feature — so go/no-go
 * WORK decisions must not trust such a dim's self-claim. Capping it here keeps it eligible
 * for work (re-validate or improve) instead of being skipped as "already met, nothing to do".
 */
export const UNVERIFIED_DECISION_CAP = 5.0;

function dimDeclaresOutcomes(dim: unknown): boolean {
  const o = (dim as { outcomes?: unknown }).outcomes;
  return Array.isArray(o) && o.length > 0;
}

/**
 * Score used for go/no-go WORK decisions (crusade / sprint selection / harden / all-nine gate),
 * as distinct from effectiveDimScore (display + overall). Closes the first-run inflation hole:
 * loadMatrix leaves scores.derived UNSET for a dim whose outcomes have stale/no evidence, so
 * effectiveDimScore would fall back to the raw (inflatable) self-score. Here, a dim that DECLARES
 * outcomes but lacks a derived score is treated as UNVERIFIED and capped — so crusade can't be
 * fooled into skipping inflated-but-unproven dimensions. Dims with no outcome mechanism at all
 * fall back to the effective score (legacy/market dims are bounded by other caps).
 */
export function decisionDimScore(dim: { scores: Record<string, number>; outcomes?: unknown }): number {
  if (dim.scores['derived'] !== undefined) return effectiveDimScore(dim); // fresh evidence → honest already
  if (dimDeclaresOutcomes(dim)) return Math.min(dim.scores['self'] ?? 0, UNVERIFIED_DECISION_CAP);
  return effectiveDimScore(dim); // no outcome mechanism → self is the only signal
}

export function computeOverallScore(matrix: CompeteMatrix): number {
  if (matrix.dimensions.length === 0) return 0;
  const totalWeight = matrix.dimensions.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return 0;
  // The headline ranks on decisionDimScore, NOT effectiveDimScore — so a dim that DECLARES outcomes but
  // has no fresh evidence is treated as unverified (capped at 5), never coasting on its agent-written
  // self-claim. effectiveDimScore = min(self, derived) silently falls back to self when derived is unset
  // (un-run outcomes), which is exactly how 22/24 dims showed 9.0 on zero evidence (council). A dim with
  // no outcome mechanism at all is unaffected (decisionDimScore == effectiveDimScore there).
  const weightedSum = matrix.dimensions.reduce(
    (s, d) => s + d.weight * decisionDimScore(d),
    0,
  );
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

export function computeTwoGaps(
  dim: { scores: Record<string, number> },
  closedSourceNames: string[],
  ossNames: string[],
): {
  gap_to_closed_source_leader: number;
  closed_source_leader: string;
  gap_to_oss_leader: number;
  oss_leader: string;
} {
  const selfScore = dim.scores['self'] ?? 0;

  const findBest = (names: string[]): [string, number] => {
    let bestName = '';
    let bestScore = 0;
    for (const name of names) {
      const s = dim.scores[name] ?? 0;
      if (s > bestScore) { bestScore = s; bestName = name; }
    }
    return [bestName, bestScore];
  };

  const [csLeader, csScore] = findBest(closedSourceNames);
  const [ossLeader, ossScore] = findBest(ossNames);

  return {
    gap_to_closed_source_leader: Math.max(0, csScore - selfScore),
    closed_source_leader: csLeader || 'unknown',
    gap_to_oss_leader: Math.max(0, ossScore - selfScore),
    oss_leader: ossLeader || 'unknown',
  };
}

/** Market dims: internal evidence cannot certify adoption/enterprise/token-spend scores above 5.0.
 *  Canonical set lives in market-dims.ts — re-exported here under the legacy names. */
export const MARKET_DIMS_SCORE_CAP = MARKET_CAPPED_DIMS;
export { MARKET_DIM_MAX_SCORE };

/**
 * The single canonical clamp every `scores.self` write must pass through.
 *
 * Enforces two caps in priority order: the per-dim `ceiling` (if declared) and
 * the hard market-dim cap (community_adoption / enterprise_readiness ≤ 5.0).
 * The market cap is applied last so it always wins — internal evidence can never
 * certify a market dim above 5.0 regardless of ceiling.
 *
 * Do not trust prompts or warnings as enforcement: ALL writers
 * (updateDimensionScore, applyAdversarialCalibration, ascend-engine, score-audit)
 * funnel through here so the invariant lives in exactly one place.
 */
export function clampDimScore(dimensionId: string, score: number, ceiling?: number): number {
  let clamped = ceiling !== undefined ? Math.min(score, ceiling) : score;
  if (MARKET_DIMS_SCORE_CAP.has(dimensionId)) {
    clamped = Math.min(clamped, MARKET_DIM_MAX_SCORE);
  }
  return clamped;
}

/**
 * Canonical entry point for a clamped, history-tracked self-score write.
 * Now a thin wrapper over `writeVerifiedScore` (the single gate) — its signature
 * is preserved so `mergeScoreProposals` and `score-audit` are untouched.
 */
export function updateDimensionScore(
  matrix: CompeteMatrix,
  dimensionId: string,
  newScore: number,
  commit?: string,
  harvestSource?: string,
): void {
  writeVerifiedScore(matrix, dimensionId, newScore, { agent: 'matrix-update', commit, harvestSource });
}

export async function applyIntelLeaderScores(
  matrix: CompeteMatrix,
  intelPath: string,
): Promise<number> {
  let adjustmentsApplied = 0;
  let intelData: { signals: Array<{ tool: string; category: string }> } | null = null;

  try {
    const raw = await (await import('fs/promises')).readFile(intelPath, 'utf-8');
    intelData = JSON.parse(raw) as { signals: Array<{ tool: string; category: string }> };
  } catch {
    return 0;
  }

  for (const signal of intelData.signals ?? []) {
    const key = signal.tool + '::' + signal.category;
    void key;
  }

  for (const dim of matrix.dimensions) {
    const competitors = Object.keys(dim.scores).filter(k => k !== 'self');
    for (const competitor of competitors) {
      const dimSignals = (intelData.signals ?? []).filter(
        s => s.tool === competitor && matchesDimension(s.category, dim.id),
      );
      if (dimSignals.length < 10) continue;

      const reduction = Math.min(2.0, Math.floor(dimSignals.length / 10) * 0.5);
      const currentScore = dim.scores[competitor] ?? 0;
      const adjusted = Math.max(0, currentScore - reduction);

      if (adjusted !== currentScore) {
        dim.scores[competitor] = adjusted;
        if (!dim.leaderScoreSource) dim.leaderScoreSource = {};
        dim.leaderScoreSource[competitor] = 'github-evidence';
        adjustmentsApplied++;
      }
    }

    if (adjustmentsApplied > 0) {
      const competitorEntries = Object.entries(dim.scores).filter(([k]) => k !== 'self');
      const maxEntry = competitorEntries.reduce(
        (best, [k, v]) => v > best[1] ? [k, v] : best,
        ['', 0] as [string, number],
      );
      const selfScore = dim.scores['self'] ?? 0;
      dim.gap_to_leader = Math.max(0, maxEntry[1] - selfScore);
      if (maxEntry[0]) dim.leader = maxEntry[0];
      const twoGaps = computeTwoGaps(dim, matrix.competitors_closed_source ?? [], matrix.competitors_oss ?? []);
      dim.gap_to_closed_source_leader = twoGaps.gap_to_closed_source_leader;
      dim.closed_source_leader = twoGaps.closed_source_leader;
      dim.gap_to_oss_leader = twoGaps.gap_to_oss_leader;
      dim.oss_leader = twoGaps.oss_leader;
    }
  }

  if (adjustmentsApplied > 0) {
    matrix.lastUpdated = new Date().toISOString();
    matrix.overallSelfScore = computeOverallScore(matrix);
  }

  return adjustmentsApplied;
}

function matchesDimension(categoryLabel: string, dimensionId: string): boolean {
  const label = categoryLabel.toLowerCase().replace(/[^a-z]/g, '');
  const id = dimensionId.toLowerCase().replace(/[^a-z]/g, '');
  if (label.includes(id) || id.includes(label)) return true;
  const LABEL_MAP: Record<string, string> = {
    windowssupport: 'developerexperience',
    performance: 'performance',
    testquality: 'testing',
    documentation: 'documentation',
    autonomy: 'autonomy',
    multiagent: 'multiagentorchestration',
    security: 'security',
    uxclipolish: 'uxpolish',
    tokencontextmanagement: 'tokeneconomy',
    enterprisefeatures: 'enterprisereadiness',
    specplanningpipeline: 'specdrivenpipeline',
    errorhandling: 'errorhandling',
  };
  const mappedId = LABEL_MAP[label];
  return mappedId !== undefined && (mappedId.includes(id) || id.includes(mappedId));
}

export function applyAdversarialCalibration(
  matrix: CompeteMatrix,
  dimensionId: string,
  harshScore: number,
  adversarialScore: number,
  verdict: AdversarialCalibration['verdict'],
  rationale: string,
): boolean {
  if (verdict !== 'inflated') return false;

  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) return false;

  const before = dim.scores['self'] ?? 0;
  const consensus = (harshScore + adversarialScore) / 2;
  // Route through the single gate: clamp (round to 1 dp), no sprint_history / status
  // change (calibration manages its own record), market-dim cap never bypassed.
  const after = writeVerifiedScore(
    matrix,
    dimensionId,
    consensus,
    { agent: 'daemon-calibration', rationale },
    { round1: true, skipHistory: true, skipStatus: true },
  );

  const calibration: AdversarialCalibration = {
    dimensionId,
    beforeScore: before,
    afterScore: after,
    adversarialScore,
    verdict,
    rationale,
    date: new Date().toISOString(),
  };
  matrix.adversarialCalibrations ??= [];
  matrix.adversarialCalibrations.push(calibration);
  // writeVerifiedScore already refreshed lastUpdated + overallSelfScore.
  return true;
}
