// finish-ceiling.ts — resolve each dimension's HONEST target and report a project FINISHED at its honest ceiling.
//
// Council unanimous (Grok + Codex + Claude, 2026-06-23): the scoring lattice ALREADY encodes that 8.0 is terminal
// BUILD-COMPLETE and 8.5+ needs real external demand — but the autonomous loops still default their target to 9.0
// (MAX_AUTONOMOUS_TARGET), so honestly-finished 8.0 work is mislabeled "incomplete vs 9.0". That is a teleology bug,
// not a depth bug. This module is the thin "finish-to-honest-ceiling" resolver: it gives each dim its honest target
// by DEMAND POSTURE (not "internal vs product"), so a project can be reported FINISHED at its real ceiling instead
// of perpetually sub-9.
//
// The honest targets (council):
//   - market/adoption dim                    → 5.0  (needs real-world spend/adoption evidence; never autonomous)
//   - no artifact-aligned external demand     → 8.0  (BUILD-COMPLETE: wired + smoke-passing; terminal success)
//   - real artifact-aligned demand is bound   → 9.0  (8.5 demand-anchored → 9.0 demand-satisfied court)
//
// GUARDRAIL (Claude's sharpest risk): "no demand" must be an OBSERVED result (a harvest that RAN and found zero,
// like ecosystem_mcp), never a default assumption — else a dim dodges the 8.5 bar by claiming no demand. And the
// 8.0 stamp is a REPORT here; writing closingStrategy:'ceiling' must stay gated on harden-green + a validate
// receipt elsewhere, so 8.0 never becomes a ceiling of convenience.

import { MARKET_CAPPED_DIMS, MARKET_DIM_MAX_SCORE } from './market-dims.js';
import { BUILD_CEILING } from './score-bands.js';

export type FinishProfile = 'market-capped' | 'build-complete' | 'demand-frontier';

export interface HonestTarget {
  target: number;
  profile: FinishProfile;
  reason: string;
}

export interface DimFinishInput {
  id: string;
  score: number;
  /** True ONLY when a real, artifact-aligned, re-fetchable demand cluster is bound to this dim (the loop ran and
   *  bound it). Absent/false means "no demand bound" — which is honest ONLY if a harvest was attempted and empty. */
  demandBound?: boolean;
  /** Whether a demand HARVEST was actually attempted for this dim. "No demand" is only honest when this is true. */
  demandHarvestAttempted?: boolean;
}

export interface DimFinishStatus {
  dimId: string;
  score: number;
  target: number;
  profile: FinishProfile;
  finished: boolean;
  gap: number;
  /** True when the dim claims no demand but no harvest was attempted — an unobserved (gameable) "no demand". */
  unobservedNoDemand: boolean;
  reason: string;
}

/** Resolve a dim's honest target from its demand posture. */
export function resolveHonestTarget(dimId: string, opts: { demandBound?: boolean } = {}): HonestTarget {
  if (MARKET_CAPPED_DIMS.has(dimId)) {
    return { target: MARKET_DIM_MAX_SCORE, profile: 'market-capped', reason: 'market/adoption dim — honest ceiling is the market cap (needs real-world spend/adoption evidence; never autonomous)' };
  }
  if (opts.demandBound) {
    return { target: 9.0, profile: 'demand-frontier', reason: 'real artifact-aligned demand is bound — pursue 8.5 (demand-anchored) → 9.0 (demand-satisfied court)' };
  }
  return { target: BUILD_CEILING, profile: 'build-complete', reason: 'no artifact-aligned external demand — BUILD-COMPLETE (wired + smoke-passing) is the terminal honest ceiling' };
}

/** Per-dim finish status against its honest target. */
export function dimFinishStatus(input: DimFinishInput): DimFinishStatus {
  const t = resolveHonestTarget(input.id, { demandBound: input.demandBound });
  const finished = input.score >= t.target - 1e-9;
  const gap = Math.max(0, Math.round((t.target - input.score) * 10) / 10);
  // A dim that claims "no demand" (build-complete profile) without ever harvesting is an UNOBSERVED no-demand —
  // it may be dodging the 8.5 bar. Flag it so the operator runs the harvest before stamping 8.0 terminal.
  const unobservedNoDemand = t.profile === 'build-complete' && input.demandHarvestAttempted !== true;
  return { dimId: input.id, score: input.score, target: t.target, profile: t.profile, finished, gap, unobservedNoDemand, reason: t.reason };
}

export interface FleetFinishSummary {
  finished: boolean;
  doneCount: number;
  total: number;
  /** Dims that claim no demand but never harvested — must be resolved before the project is honestly FINISHED. */
  unobservedCount: number;
  perDim: DimFinishStatus[];
}

/** Whole-project finish report. FINISHED only when every dim is at its honest target AND no dim has an
 *  unobserved "no demand" claim (the harvest must have run, like ecosystem_mcp, not been assumed). */
export function fleetFinishSummary(dims: DimFinishInput[]): FleetFinishSummary {
  const perDim = dims.map(dimFinishStatus);
  const doneCount = perDim.filter(d => d.finished).length;
  const unobservedCount = perDim.filter(d => d.unobservedNoDemand).length;
  return {
    finished: doneCount === perDim.length && unobservedCount === 0,
    doneCount,
    total: perDim.length,
    unobservedCount,
    perDim,
  };
}
