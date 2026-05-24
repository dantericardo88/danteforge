// wave-alternation.ts — Shared breadth/depth wave guard.
//
// Depth Doctrine: every orchestration loop must alternate between breadth
// waves (write new code, ceiling 6) and depth waves (run outcomes, unlock 7-9+).
// This module provides the shared logic so all command surfaces enforce the
// same rhythm.
//
// Used by: ascend-engine, autoforge-loop, wave-executor, compete, goal-loop,
// harden-crusade.

// ── Types ─────────────────────────────────────────────────────────────────────

export type WaveType = 'breadth' | 'depth';

export interface WaveGuard {
  /** The wave type for this index. */
  type: WaveType;
  /** Maximum score that can be proposed in this wave. breadth=6.0, depth=Infinity. */
  scoreCeiling: number;
  /** Whether new production code should be written in this wave. */
  allowNewCode: boolean;
  /** Whether outcome validation should run in this wave. */
  allowOutcomeRun: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Breadth wave score ceiling — code exists + tests pass, no more. */
export const BREADTH_SCORE_CEILING = 6.0;

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Compute the wave type and guard for a given wave index.
 *
 * Convention: wave 0 is breadth (first wave writes code), wave 1 is depth
 * (validate what was written), wave 2 is breadth again, etc.
 *
 * This matches harden-crusade.ts which uses `pass % 2 === 0 ? 'depth' : 'breadth'`
 * but with pass starting at 1 (so pass 1 = breadth = index 0).
 */
export function getWaveGuard(waveIndex: number): WaveGuard {
  const type: WaveType = waveIndex % 2 === 0 ? 'breadth' : 'depth';
  return {
    type,
    scoreCeiling: type === 'breadth' ? BREADTH_SCORE_CEILING : Infinity,
    allowNewCode: type === 'breadth',
    allowOutcomeRun: type === 'depth',
  };
}

/**
 * Convenience: compute wave type from index.
 */
export function computeWaveType(waveIndex: number): WaveType {
  return getWaveGuard(waveIndex).type;
}
