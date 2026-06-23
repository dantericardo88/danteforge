// dim-band — normalize each competitive dimension into a score-band state. The pure substrate the
// sweep orchestrator schedules over: which band is a dim in (below5 / fiveToSeven / sevenToNine /
// done), is it at a ceiling, does it carry a capability_test and declared outcomes. No IO.

import { decisionDimScore, MARKET_DIMS_SCORE_CAP, MARKET_DIM_MAX_SCORE } from './compete-matrix-score.js';
import { MAX_AUTONOMOUS_TARGET } from './autonomy-cap.js';
import type { MatrixDimension, CompeteMatrix } from './compete-matrix.js';

export type DimScoreBucket = 'below5' | 'fiveToSeven' | 'sevenToNine' | 'done';

export interface DimBandState {
  id: string;
  effectiveScore: number;
  ceiling?: number;
  hasCapabilityTest: boolean;
  hasOutcomes: boolean;
  /** At an honest maximum — the autonomous 9.0 ceiling, an operator/market ceiling, or a human-closing strategy. */
  atCeiling: boolean;
  band: DimScoreBucket;
}

type BandDim = MatrixDimension & {
  capability_test?: { command?: string };
  no_capability_test?: boolean;
  outcomes?: unknown[];
};

/** The score band, ignoring ceilings (autonomy tops out at 9.0 → 'done'). */
export function bandFor(score: number): DimScoreBucket {
  if (score >= MAX_AUTONOMOUS_TARGET) return 'done';
  if (score >= 7.0) return 'sevenToNine';
  if (score >= 5.0) return 'fiveToSeven';
  return 'below5';
}

export function dimBandState(dim: BandDim): DimBandState {
  // decisionDimScore — the SINGLE canonical work-decision score (council/Codex): it's the effective
  // score (min self/derived) when fresh evidence exists, but caps a dim that DECLARES outcomes yet has
  // no derived evidence at 5.0 (unverified ≠ done). classifyMatrixDims must filter on the SAME score,
  // or the orchestrator's band plan and the dispatcher's eligibility disagree (the reported mismatch).
  const effectiveScore = decisionDimScore(dim);
  const ceiling = dim.ceiling;
  const atCeiling =
    effectiveScore >= MAX_AUTONOMOUS_TARGET
    || (ceiling !== undefined && effectiveScore >= ceiling)
    || (MARKET_DIMS_SCORE_CAP.has(dim.id) && effectiveScore >= MARKET_DIM_MAX_SCORE)
    || dim.closingStrategy === 'human'
    || dim.closingStrategy === 'ceiling';
  return {
    id: dim.id,
    effectiveScore,
    ceiling,
    hasCapabilityTest: !!dim.capability_test?.command,
    hasOutcomes: Array.isArray(dim.outcomes) && dim.outcomes.length > 0,
    atCeiling,
    band: atCeiling ? 'done' : bandFor(effectiveScore),
  };
}

export function snapshotBands(matrix: CompeteMatrix): DimBandState[] {
  return (matrix.dimensions as BandDim[]).map(dimBandState);
}

/** Count of dims in each band — the campaign dashboard. */
export function bandCounts(states: DimBandState[]): Record<DimScoreBucket, number> {
  const counts: Record<DimScoreBucket, number> = { below5: 0, fiveToSeven: 0, sevenToNine: 0, done: 0 };
  for (const s of states) counts[s.band]++;
  return counts;
}
