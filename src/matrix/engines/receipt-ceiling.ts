// Matrix Kernel — Receipt Ceiling (Depth Doctrine).
//
// Enforces the fundamental rule: a dimension score above 7.0 requires
// observable execution evidence. Code without a receipt is a hypothesis,
// not a feature.
//
// This is the structural twin of the no-stub-scanner: stubs are rejected
// at merge time; unexecuted code is capped at score-read time.
//
// Score tiers enforced here:
//   ≤5.0  — code exists, unit tests pass (no outcomes declared)
//   ≤7.0  — production callsite wired (no passing receipt yet)
//   ≤8.5  — receipt on disk, passed=true, fresh ≤ 30 days (T6 cap)
//   ≤9.5  — receipt fresh ≤ 7 days (above T6 multi-receipt tier)
//   ≤10.0 — multi-receipt + live verify (handled by the full outcome system)
//
// For dims that HAVE outcomes declared, the tier-based derived-score system
// (derived-score.ts + outcome-runner.ts) already enforces the correct caps.
// This module handles only the LEGACY FALLBACK — dims that declare no outcomes.
// Those dims cannot claim scores above 7.0 because there is no receipt to
// substantiate the claim. An agent writing scores.self = 9.5 on a dim with
// no outcomes will have that score capped at 7.0 on every loadMatrix call.

import type { DerivedScoreBreakdown } from '../../core/derived-score.js';

// Re-exported here so callers that want the ceiling value don't need to
// import from capability-test.ts directly.
export const LEGACY_NO_RECEIPT_CEILING = 7.0;

/**
 * Apply the legacy receipt ceiling.
 *
 * When a dimension has no outcomes declared (usedLegacyFallback=true in the
 * derived-score breakdown), its score cannot exceed 7.0 — there is no
 * execution receipt to substantiate a higher claim.
 *
 * When a dimension HAS outcomes, the tier-based scoring in derived-score.ts
 * already handles all caps correctly; pass the breakdown score through unchanged.
 *
 * @param score   The score computed by computeDerivedScore (or the legacy value).
 * @param breakdown  The DerivedScoreBreakdown returned by computeDerivedScoreWithBreakdown.
 * @returns  The score after applying the legacy ceiling (unchanged for dims with outcomes).
 */
export function applyLegacyReceiptCeiling(
  score: number,
  breakdown: Pick<DerivedScoreBreakdown, 'usedLegacyFallback'>,
): number {
  if (!breakdown.usedLegacyFallback) return score;
  return Math.min(score, LEGACY_NO_RECEIPT_CEILING);
}

/**
 * Explain why a score was capped, for display in CLI output.
 * Returns null when no ceiling was applied.
 */
export function explainLegacyCeiling(
  originalScore: number,
  breakdown: Pick<DerivedScoreBreakdown, 'usedLegacyFallback'>,
): string | null {
  if (!breakdown.usedLegacyFallback) return null;
  if (originalScore <= LEGACY_NO_RECEIPT_CEILING) return null;
  return (
    `Score capped at ${LEGACY_NO_RECEIPT_CEILING} (depth doctrine): ` +
    `no outcomes declared — add outcomes + run \`danteforge validate <dim>\` ` +
    `to unlock scores above ${LEGACY_NO_RECEIPT_CEILING}.`
  );
}
