// measured-completion-gate.ts — the firewall the council found missing. The autonomous loop used to declare
// "COMPLETE / target reached" from a SOFT score (PDSE text-patterns + phase counters + self-reported flags),
// with the only receipt-style gate (_harshScore) being dead code in production. Per the Depth Doctrine, "code
// without a receipt is a hypothesis" — so soft completion is necessary but NOT sufficient.
//
// This gate reads the MEASURED truth: outcome-evidence receipts for the CURRENT git commit (loadOutcomeEvidence
// keys by SHA, so staleness is structural). The loop may only finish if at least one fresh T5+ (BUILD-COMPLETE,
// smoke-passing) receipt PASSED for this commit. Without one, the gate withholds completion and the loop routes
// to a depth/validate cycle that actually runs the product and writes a receipt — or it honestly fails to
// complete rather than self-certifying. No soft score can satisfy this gate.

import { loadOutcomeEvidence } from '../matrix/engines/outcome-runner.js';
import { isHighTierOutcome } from '../matrix/types/outcome.js';

export interface MeasuredGateResult {
  passed: boolean;
  /** Count of fresh T5+ receipts that PASSED for the current commit. */
  passingHighTier: number;
  reason: string;
}

export interface MeasuredGateDeps {
  /** Injection seam: load outcome evidence for the current SHA. Defaults to loadOutcomeEvidence. */
  _loadEvidence?: typeof loadOutcomeEvidence;
}

/**
 * The measured completion firewall. Returns passed=true only when >=1 fresh T5+ outcome receipt PASSED for the
 * current commit — i.e. the build was actually run and proven, not merely described. Pure given the injected
 * loader. Never throws (a load failure = unproven = gate fails closed).
 */
export async function measuredReceiptGate(cwd: string, deps: MeasuredGateDeps = {}): Promise<MeasuredGateResult> {
  const load = deps._loadEvidence ?? loadOutcomeEvidence;
  let evidence;
  try {
    evidence = await load(cwd);
  } catch {
    return { passed: false, passingHighTier: 0, reason: 'could not read outcome evidence — treating build as unproven (fail-closed)' };
  }

  let passingHighTier = 0;
  for (const entry of evidence.values()) {
    if (entry.passed && isHighTierOutcome(entry.tier)) passingHighTier++;
  }

  const passed = passingHighTier >= 1;
  return {
    passed,
    passingHighTier,
    reason: passed
      ? `${passingHighTier} fresh T5+ passing receipt(s) for the current commit — build is proven`
      : 'no fresh T5+ (BUILD-COMPLETE) passing receipt for the current commit — the build is unproven; run `danteforge validate` to mint one',
  };
}
