// harden-bridge — the 5→7 decision. A dim that reaches 5.0 via the surgical loop has a passing
// capability_test and a module + tests (T2). To climb toward 7 it needs a PRODUCTION callsite (T4,
// orphan-audit passes). The deterministic harden gate (orphan / recency / claim) tells us which:
//   - clean   → the dim is wired into production → eligible for the depth wave (validate → 5→7);
//   - dirty   → the failing check (usually orphan: only tests call it) means the dim needs real
//               integration work, NOT more surgical metric-tweaking → re-route to feature construction.
// This keeps the surgical loop from spinning forever on a dim whose real blocker is a missing callsite.
// Pure — no IO; the harden run is the caller's (seamed) job.

export interface HardenCheckResult {
  clean: boolean;
  failedChecks: string[];
}

export type HardenBridgeDecision = 'harden-ready' | 'needs-feature' | 'not-applicable';

export interface HardenBridgeVerdict {
  dimId: string;
  decision: HardenBridgeDecision;
  failedChecks: string[];
  note: string;
}

/** The 5→7 band where the harden gate decides depth-wave vs feature re-route. */
export function inBridgeBand(effectiveScore: number): boolean {
  return effectiveScore >= 5.0 && effectiveScore < 7.0;
}

export function decideHardenBridge(dimId: string, effectiveScore: number, harden: HardenCheckResult): HardenBridgeVerdict {
  if (!inBridgeBand(effectiveScore)) {
    return { dimId, decision: 'not-applicable', failedChecks: [], note: `score ${effectiveScore} is outside the 5→7 bridge band` };
  }
  if (harden.clean) {
    return { dimId, decision: 'harden-ready', failedChecks: [], note: 'harden gate clean — eligible for the depth wave (5→7)' };
  }
  return {
    dimId,
    decision: 'needs-feature',
    failedChecks: harden.failedChecks,
    note: `harden gate found [${harden.failedChecks.join(', ') || 'failures'}] — needs production wiring, re-routed to feature construction`,
  };
}
