// convergence-tracker.ts — Pure tracking of convergence progress across forging cycles.
// No I/O — all functions are pure and fully testable.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConvergenceSnapshot {
  /** Monotonically increasing cycle number (1-based). */
  cycle: number;
  /** Score at end of this cycle (0–10). */
  score: number;
  /** Dimension being tracked. */
  dimension: string;
  /** ISO timestamp of snapshot creation. */
  timestamp: string;
  /** True when score improved vs. previous cycle. */
  improved: boolean;
  /** Score delta from previous cycle (positive = improvement). */
  delta: number;
}

export interface ConvergenceState {
  /** Dimension being tracked (e.g. "autonomy", "convergence"). */
  dimension: string;
  /** Score at the start of tracking. */
  startScore: number;
  /** Most recent score. */
  currentScore: number;
  /** Goal score to declare convergence. */
  targetScore: number;
  /** Ordered list of snapshots, oldest first. */
  snapshots: ConvergenceSnapshot[];
  /** Consecutive cycles where |delta| < PLATEAU_DELTA_THRESHOLD (0.1). */
  plateauCount: number;
  /** True when currentScore >= targetScore. */
  isConverged: boolean;
  /** True when plateauCount >= DEFAULT_PLATEAU_THRESHOLD (3). */
  isPlateaued: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATEAU_DELTA_THRESHOLD = 0.1;
const DEFAULT_PLATEAU_THRESHOLD = 3;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a fresh ConvergenceState for a dimension.
 *
 * @param dimension  Name of the quality dimension being tracked.
 * @param startScore Starting score (0–10).
 * @param target     Score required to declare convergence.
 */
export function createConvergenceState(
  dimension: string,
  startScore: number,
  target: number,
): ConvergenceState {
  return {
    dimension,
    startScore,
    currentScore: startScore,
    targetScore: target,
    snapshots: [],
    plateauCount: 0,
    isConverged: startScore >= target,
    isPlateaued: false,
  };
}

// ── Mutations (pure — always return new state) ────────────────────────────────

/**
 * Record a new score observation and return updated state.
 * All fields are recomputed from the snapshot history — no mutation.
 *
 * @param state Current ConvergenceState.
 * @param score New observed score (0–10).
 * @param timestamp Optional ISO string; defaults to now.
 */
export function recordConvergenceSnapshot(
  state: ConvergenceState,
  score: number,
  timestamp?: string,
): ConvergenceState {
  const ts = timestamp ?? new Date().toISOString();
  const previousScore = state.currentScore;
  const delta = score - previousScore;
  const improved = delta > 0;

  const snapshot: ConvergenceSnapshot = {
    cycle: state.snapshots.length + 1,
    score,
    dimension: state.dimension,
    timestamp: ts,
    improved,
    delta,
  };

  const snapshots = [...state.snapshots, snapshot];

  // Recompute plateau count: count trailing cycles where |delta| < threshold.
  let plateauCount = 0;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (Math.abs(snapshots[i]!.delta) < PLATEAU_DELTA_THRESHOLD) {
      plateauCount++;
    } else {
      break;
    }
  }

  const isConverged = score >= state.targetScore;
  const isPlateaued = plateauCount >= DEFAULT_PLATEAU_THRESHOLD;

  return {
    ...state,
    currentScore: score,
    snapshots,
    plateauCount,
    isConverged,
    isPlateaued,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Return true when the convergence loop appears stuck.
 *
 * A state is "stuck" when it is both plateaued and not yet converged.
 *
 * @param state      Current ConvergenceState.
 * @param maxPlateaus Override the plateau threshold (default: DEFAULT_PLATEAU_THRESHOLD).
 */
export function isConvergenceStuck(
  state: ConvergenceState,
  maxPlateaus: number = DEFAULT_PLATEAU_THRESHOLD,
): boolean {
  if (state.isConverged) {
    return false;
  }
  return state.plateauCount >= maxPlateaus;
}

/**
 * Compute average score delta per cycle across the full snapshot history.
 * Returns 0 when fewer than 2 snapshots are recorded.
 */
export function computeConvergenceVelocity(state: ConvergenceState): number {
  if (state.snapshots.length < 2) {
    return 0;
  }
  const totalDelta = state.currentScore - state.startScore;
  return totalDelta / state.snapshots.length;
}

/**
 * Produce a Markdown summary of the current convergence state.
 */
export function formatConvergenceReport(state: ConvergenceState): string {
  const velocity = computeConvergenceVelocity(state);
  const status = state.isConverged
    ? 'CONVERGED'
    : state.isPlateaued
      ? 'PLATEAUED'
      : 'IN PROGRESS';

  const rows = state.snapshots
    .map(
      (s) =>
        `| ${s.cycle} | ${s.score.toFixed(2)} | ${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(2)} | ${s.improved ? 'yes' : 'no'} |`,
    )
    .join('\n');

  const table =
    state.snapshots.length > 0
      ? `| Cycle | Score | Delta | Improved |\n|-------|-------|-------|----------|\n${rows}`
      : '_No cycles recorded yet._';

  return [
    `## Convergence Report — ${state.dimension}`,
    '',
    `**Status:** ${status}`,
    `**Start:** ${state.startScore.toFixed(2)}  **Current:** ${state.currentScore.toFixed(2)}  **Target:** ${state.targetScore.toFixed(2)}`,
    `**Velocity:** ${velocity.toFixed(3)} pts/cycle  **Plateau streak:** ${state.plateauCount}`,
    '',
    table,
  ].join('\n');
}
