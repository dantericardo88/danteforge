// gate-readiness.ts — preflight for the two autonomy gates so the operator can't STALL the loop by flipping
// them in the wrong order (the Phase-2 footgun in the maximal-autonomy plan).
//
// DANTEFORGE_GROUNDING_GATE=1 makes any score >7.0 require a PASSING external-benchmark receipt. If flipped
// before even one dim is grounded, EVERY dim caps at 7.0 and the climb loop stalls (frontier-spec.ts:384-398
// says exactly this). DANTEFORGE_REQUIRE_SIGNED_EVIDENCE=1 rejects unsigned receipts — flipped before the
// corpus is re-signed, dims drop to 0. This computes whether each flip is SAFE NOW, from real state.

export interface GroundingGateAssessment {
  safeToEnable: boolean;
  groundedDims: number;
  groundedDimIds: string[];
  reason: string;
}

/** Safe to enable the grounding gate iff ≥1 dim already carries a passing external receipt — otherwise the
 *  gate caps everything at 7.0 with no path up. */
export function assessGroundingGate(groundedDimIds: readonly string[]): GroundingGateAssessment {
  const groundedDims = groundedDimIds.length;
  if (groundedDims > 0) {
    return {
      safeToEnable: true,
      groundedDims,
      groundedDimIds: [...groundedDimIds],
      reason: `${groundedDims} dim(s) carry a passing external-benchmark receipt (${groundedDimIds.join(', ')}). ` +
        `Flipping caps un-grounded dims at 7.0 but the grounded one(s) can still climb — SAFE.`,
    };
  }
  return {
    safeToEnable: false,
    groundedDims: 0,
    groundedDimIds: [],
    reason: `0 dims have a passing external-benchmark receipt. Flipping DANTEFORGE_GROUNDING_GATE=1 now caps ` +
      `EVERY dim at 7.0 and STALLS the climb loop. Ground ≥1 dim first (run an external benchmark + validate).`,
  };
}

export interface SignedEvidenceAssessment {
  safeToEnable: boolean;
  totalReceipts: number;
  unsignedReceipts: number;
  reason: string;
}

/** Safe to enable signed-evidence enforcement iff there are no unsigned receipts that would be rejected
 *  (which would drop those dims' derived scores). Re-sign the corpus first if any are unsigned. */
export function assessSignedEvidence(receipts: ReadonlyArray<{ sig?: unknown }>): SignedEvidenceAssessment {
  const totalReceipts = receipts.length;
  const unsignedReceipts = receipts.filter(r => typeof r.sig !== 'string' || (r.sig as string).length === 0).length;
  if (unsignedReceipts === 0) {
    return {
      safeToEnable: true, totalReceipts, unsignedReceipts: 0,
      reason: totalReceipts === 0
        ? 'No receipts yet — enforcement is a no-op until receipts exist.'
        : `All ${totalReceipts} receipt(s) are signed — enforcement rejects nothing. SAFE.`,
    };
  }
  return {
    safeToEnable: false, totalReceipts, unsignedReceipts,
    reason: `${unsignedReceipts}/${totalReceipts} receipt(s) are UNSIGNED — flipping ` +
      `DANTEFORGE_REQUIRE_SIGNED_EVIDENCE=1 now rejects them and drops those dims' derived scores. ` +
      `Re-sign first: node scripts/sign-outcome-evidence.mjs`,
  };
}
