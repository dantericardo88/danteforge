// Matrix Kernel — CouncilMemberHealth
//
// Tracks per-session health state for each council member so the parallel
// council can degrade gracefully when a member hits a quota/usage limit or
// fails too many times consecutively.
//
// Quota detection covers common patterns from Codex, Claude, Grok, and Gemini
// CLI error output. Once quota-exhausted, a member is removed from the active
// pool for the remainder of the session — no retry.
//
// Usage: create one MemberHealthTracker per council session; call recordSuccess
// or recordFailure after each build/judge attempt; call getActiveMembers before
// scheduling each round.

export type MemberStatus = 'active' | 'quota-exhausted' | 'timeout-exceeded' | 'degraded';

export interface MemberHealth {
  id: string;
  status: MemberStatus;
  failureCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  quotaExhaustedAt: number | null;
}

// Patterns found in CLI output from Codex / Claude / Grok / Gemini when limits hit.
const QUOTA_PATTERNS = [
  'rate limit',
  'rate-limit',
  'quota exceeded',
  'usage limit',
  'out of credits',
  'subscription',
  'billing',
  'payment required',
  'too many requests',
  'context length exceeded',
  'maximum context',
  'overloaded',
];

/**
 * Returns true when the error text or exit code indicates a usage / quota limit.
 * Safe to call with undefined exitCode (treated as "not a quota code").
 */
export function isQuotaError(exitCode: number | undefined, errorText: string): boolean {
  if (exitCode === 429) return true;
  const lower = errorText.toLowerCase();
  return QUOTA_PATTERNS.some(p => lower.includes(p));
}

/**
 * Cap the requested min-judges to what the live member pool can actually supply.
 *
 * Each candidate can be judged by at most (activeMemberCount - 1) cross-member
 * judges (builder-never-judges). When a member goes out of credits mid-session the
 * pool shrinks, but a fixed min-judges keeps demanding judges that no longer exist —
 * every candidate returns INSUFFICIENT (or can never reach minPasses) and the batch
 * merges nothing. Shrinking the quorum to the live pool lets a smaller council still
 * reach consensus instead of stalling the drive. Floor is 1 so a 2-member council
 * remains functional.
 */
export function resolveEffectiveMinJudges(activeMemberCount: number, requestedMinJudges: number): number {
  return Math.max(1, Math.min(requestedMinJudges, activeMemberCount - 1));
}

/**
 * Quorum-degradation provenance (self-challenge #4): when the live pool forced the judge quorum
 * below policy, every merge approved under the reduced quorum must CARRY that fact — one judge
 * approving a merge is a materially weaker gate, and silently passing it forward made degraded
 * merges indistinguishable from fully-judged ones in summaries, ledgers, and later courts.
 * Mutates each merged result's dissent log; returns how many merges were flagged.
 */
export function markDegradedQuorumMerges(
  results: Array<{ merged: boolean; memberId: string; slotId?: string; dissentLog: string[] }>,
  effectiveMinJudges: number,
  policyMinJudges: number,
  livePoolSize: number,
): number {
  if (effectiveMinJudges >= policyMinJudges) return 0;
  let flagged = 0;
  for (const r of results) {
    if (!r.merged) continue;
    r.dissentLog.push(
      `quorum-degraded: approved by ${effectiveMinJudges} judge(s) under a policy of ${policyMinJudges} (live pool ${livePoolSize}, builder excluded) — flag for the frontier court / human audit`,
    );
    flagged += 1;
  }
  return flagged;
}

export class MemberHealthTracker {
  private readonly health = new Map<string, MemberHealth>();

  private ensure(id: string): MemberHealth {
    if (!this.health.has(id)) {
      this.health.set(id, {
        id,
        status: 'active',
        failureCount: 0,
        consecutiveFailures: 0,
        lastError: null,
        quotaExhaustedAt: null,
      });
    }
    return this.health.get(id)!;
  }

  /** Call after a build or judge run completes without error. */
  recordSuccess(id: string): void {
    const h = this.ensure(id);
    h.consecutiveFailures = 0;
    if (h.status === 'degraded') h.status = 'active';
  }

  /**
   * Call after a build or judge run fails.
   * Quota-pattern errors immediately mark the member quota-exhausted.
   * Three consecutive generic failures mark the member degraded.
   */
  recordFailure(id: string, error: string, exitCode?: number): void {
    const h = this.ensure(id);
    h.failureCount++;
    h.consecutiveFailures++;
    h.lastError = error.slice(0, 500);

    if (isQuotaError(exitCode, error)) {
      this.markQuotaExhausted(id);
    } else if (h.consecutiveFailures >= 3) {
      h.status = 'degraded';
    }
  }

  /** Immediately mark a member as quota-exhausted (e.g. from a detected signal). */
  markQuotaExhausted(id: string): void {
    const h = this.ensure(id);
    h.status = 'quota-exhausted';
    h.quotaExhaustedAt = Date.now();
  }

  /** Immediately mark a member as timeout-exceeded (unresponsive). */
  markTimeout(id: string): void {
    const h = this.ensure(id);
    h.status = 'timeout-exceeded';
    h.failureCount++;
    h.consecutiveFailures++;
  }

  /** Returns true if the member can receive new work this session. */
  isAvailable(id: string): boolean {
    const h = this.health.get(id);
    if (!h) return true; // optimistic: unknown members are assumed available
    return h.status === 'active';
  }

  /**
   * Filter a candidate list to only those members that are currently active.
   * Returns a new array; does not mutate the input.
   */
  getActiveMembers<T extends string>(candidates: T[]): T[] {
    return candidates.filter(id => this.isAvailable(id));
  }

  /** Full health report for all tracked members (logging / progress artifacts). */
  getStatus(): MemberHealth[] {
    return [...this.health.values()];
  }

  /** Number of active (non-degraded, non-exhausted) members in the tracked set. */
  get activeCount(): number {
    return [...this.health.values()].filter(h => h.status === 'active').length;
  }
}
