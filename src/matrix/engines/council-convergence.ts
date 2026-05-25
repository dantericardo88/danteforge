// Matrix Kernel — CouncilConvergence
//
// Tracks per-dimension attempt and approval history across parallel council
// rounds. A dimension is "stuck" when it has been attempted N times without
// a single approved merge — surfaced as a signal for human review or a
// different strategy rather than endless retries.
//
// The tracker is stateful across rounds; create one per council session.

export interface DimRecord {
  dimensionId: string;
  attempts: number;
  approvals: number;
  lastAttemptRound: number;
  lastApprovedRound: number | null;
}

export interface ConvergenceSummary {
  totalDims: number;
  converged: number;
  stuck: number;
  inProgress: number;
  stuckDims: DimRecord[];
}

export class ConvergenceTracker {
  private readonly records = new Map<string, DimRecord>();
  private readonly stuckThreshold: number;

  constructor(stuckThreshold = 3) {
    this.stuckThreshold = stuckThreshold;
  }

  /** Record an attempt for a dimension (approved = true if council merged it). */
  record(dimensionId: string, approved: boolean, round: number): void {
    const existing = this.records.get(dimensionId) ?? {
      dimensionId,
      attempts: 0,
      approvals: 0,
      lastAttemptRound: round,
      lastApprovedRound: null,
    };
    existing.attempts++;
    existing.lastAttemptRound = round;
    if (approved) {
      existing.approvals++;
      existing.lastApprovedRound = round;
    }
    this.records.set(dimensionId, existing);
  }

  /** Returns true when a dimension has hit the stuck threshold with no approvals. */
  isStuck(dimensionId: string): boolean {
    const r = this.records.get(dimensionId);
    if (!r) return false;
    return r.attempts >= this.stuckThreshold && r.approvals === 0;
  }

  /** Returns all dimensions that are stuck. */
  getStuckDims(): DimRecord[] {
    return [...this.records.values()].filter(r => this.isStuck(r.dimensionId));
  }

  /** Returns all dimensions that have at least one approval. */
  getConvergedDims(): DimRecord[] {
    return [...this.records.values()].filter(r => r.approvals > 0);
  }

  /**
   * Returns a dimension list filtered to exclude stuck dims.
   * Use this to prune the scheduler's candidate list after each round so
   * stuck dims are not retried indefinitely.
   */
  pruneStuck<T extends { dimensionId: string }>(dims: T[]): T[] {
    return dims.filter(d => !this.isStuck(d.dimensionId));
  }

  /** Summary for logging and progress artifacts. */
  summarize(): ConvergenceSummary {
    const all = [...this.records.values()];
    const stuckDims = all.filter(r => this.isStuck(r.dimensionId));
    const converged = all.filter(r => r.approvals > 0).length;
    return {
      totalDims: all.length,
      converged,
      stuck: stuckDims.length,
      inProgress: all.length - converged - stuckDims.length,
      stuckDims,
    };
  }

  /** True when every tracked dim has at least one approval or is stuck (no more work to do). */
  isDone(): boolean {
    if (this.records.size === 0) return false;
    return [...this.records.values()].every(r => r.approvals > 0 || this.isStuck(r.dimensionId));
  }
}
