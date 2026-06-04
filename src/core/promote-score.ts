// promote-score — the missing link between "an autonomous loop made a real, verified win" and "the
// matrix headline reflects it". autoresearch/harden-crusade run outcomes and lift `scores.derived`,
// but `overallSelfScore` is the weighted average of effectiveDimScore = min(self, derived) — so a
// derived gain is INVISIBLE until `self` is raised up to it. Nothing did that raise, so wins never
// showed (Codex's score-path gap). This promotes `self` to the evidence-justified value, but ONLY
// through the single sanctioned gate (writeVerifiedScore), so every Depth-Doctrine cap still holds:
//   - derived encodes the tier caps (T2≤5, T4≤7, …) — we never claim above what evidence computed;
//   - a self above 5.0 requires a proven capability_test (the gate's backstop enforces it);
//   - ceiling / market caps are applied by clampDimScore inside the gate;
//   - promote only ever RAISES self toward derived — it never lowers (calibration owns downgrades).

import type { CompeteMatrix } from './compete-matrix.js';
import { writeVerifiedScore } from './write-verified-score.js';

/** A passing capability_test with no declared outcomes is a T2 receipt — justifies at most 5.0. */
export const CAPABILITY_TEST_TIER_CAP = 5.0;

export interface PromoteResult {
  dimId: string;
  before: number;
  after: number;
  promoted: boolean;
  reason: string;
}

export interface PromoteOpts {
  /** Did the dimension's capability_test exit 0 this cycle? Required to promote self above 5.0. */
  capabilityTestPassed: boolean;
  agent?: string;
  rationale?: string;
}

/**
 * Promote a dimension's `self` score up to the evidence-justified level, through the gate.
 * Returns what happened (no IO — the caller persists with saveMatrix).
 */
export function promoteVerifiedScore(matrix: CompeteMatrix, dimId: string, opts: PromoteOpts): PromoteResult {
  const dim = matrix.dimensions.find(d => d.id === dimId);
  if (!dim) return { dimId, before: 0, after: 0, promoted: false, reason: 'dimension not found in matrix' };

  const before = dim.scores['self'] ?? 0;
  const derived = dim.scores['derived'];

  // The justified score: the evidence-computed derived value when present (it already encodes the tier
  // caps); otherwise a bare passing capability_test is a T2 receipt worth at most 5.0.
  let justified: number;
  if (derived !== undefined) {
    justified = derived;
  } else if (opts.capabilityTestPassed) {
    justified = CAPABILITY_TEST_TIER_CAP;
  } else {
    return { dimId, before, after: before, promoted: false, reason: 'no derived evidence and capability_test did not pass — nothing to promote' };
  }

  // Promote only raises. A lower derived than self is an integrity concern owned by calibration, not here.
  if (justified <= before) {
    return { dimId, before, after: before, promoted: false, reason: `self ${before} already at/above evidence-justified ${justified}` };
  }

  const after = writeVerifiedScore(matrix, dimId, justified, {
    agent: opts.agent ?? 'score-promote',
    rationale: opts.rationale ?? `promote self to evidence-justified ${justified} (capability_test ${opts.capabilityTestPassed ? 'passed' : 'not proven'})`,
    gatesPassed: { capability_test: opts.capabilityTestPassed },
  }, { gateBackstop: true });

  return {
    dimId, before, after,
    promoted: after > before,
    reason: after > before ? `promoted ${before} → ${after}` : `gate clamped to ${after} (ceiling/market cap or unproven capability_test)`,
  };
}
