// Bundle Trust — Bayesian shrinkage + implausibility quarantine for pattern federation.
//
// Problem: pattern bundles are imported on assertion. A project with inflated scores
// or bad methodology can export "circuit-breaker improved score by 4.0" and it gets
// imported at 0.5× weight regardless of plausibility.
//
// Solution (from empirical Bayes / James-Stein shrinkage literature):
//   Pull small-sample claims toward the category prior mean.
//   shrunk = (observed × n + prior × k) / (n + k)
//   where k = prior strength (default 5 equivalent prior samples).
//
// Additionally: quarantine patterns whose claims are statistically implausible
// given their sample count (high delta, tiny sample = quarantined).

import type { SharedPatternBundle, SharedPatternStats } from '../cli/commands/share-patterns.js';
import type { PatternLibraryIndex } from './global-pattern-library.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuarantineReason =
  | 'implausible-delta'   // delta too high for sample count
  | 'tiny-sample'         // fewer than minSamples
  | 'low-verify-rate'     // more failures than passes
  | 'zero-delta';         // no positive impact claimed

export interface QuarantinedPattern {
  patternName: string;
  reason: QuarantineReason;
  originalDelta: number;
  threshold: number;
}

export interface TrustVerificationResult {
  /** Patterns that passed verification (delta may be shrunk). */
  approved: SharedPatternStats[];
  /** Patterns that were quarantined and should not be imported. */
  quarantined: QuarantinedPattern[];
  /** 0-1 overall bundle credibility based on approval rate. */
  trustScore: number;
  /** Count of patterns whose delta was shrunk toward the prior. */
  shrinkageApplied: number;
}

export interface ImplausibilityThresholds {
  /** Max delta allowed for sampleCount < 3. Default 3.5. */
  maxDeltaTinyN: number;
  /** Minimum samples to trust a claim. Default 1. */
  minSamples: number;
  /** Minimum verify pass rate (0-1). Default 0.3. */
  minVerifyRate: number;
}

export interface BundleTrustOptions {
  thresholds?: Partial<ImplausibilityThresholds>;
  /** Prior mean delta (from local library avg or default). Default 0.8. */
  priorMean?: number;
  /** Equivalent prior sample strength. Default 5. */
  priorStrength?: number;
}

// ── Bayesian shrinkage ────────────────────────────────────────────────────────

/**
 * Shrink an observed delta toward the prior mean using Bayesian pooling.
 * Small-sample claims are pulled strongly toward the prior.
 * Large-sample claims remain close to observed.
 *
 * Formula: shrunk = (observed × n + priorMean × k) / (n + k)
 * Exported for testing.
 */
export function shrinkClaim(
  observedDelta: number,
  sampleCount: number,
  priorMean: number,
  priorStrength = 5,
): number {
  if (sampleCount <= 0) return priorMean;
  const shrunk = (observedDelta * sampleCount + priorMean * priorStrength) / (sampleCount + priorStrength);
  return Math.round(shrunk * 1000) / 1000;
}

// ── Implausibility gate ───────────────────────────────────────────────────────

/**
 * Determine whether a pattern's claim is implausible enough to quarantine.
 * Returns null if the pattern passes, or a QuarantineReason if it fails.
 * Exported for testing.
 */
export function implausibilityCheck(
  pattern: SharedPatternStats,
  thresholds: ImplausibilityThresholds,
): QuarantineReason | null {
  if (pattern.sampleCount < thresholds.minSamples) {
    return 'tiny-sample';
  }

  if (pattern.avgScoreDelta <= 0) {
    return 'zero-delta';
  }

  // High delta with tiny sample = implausible
  if (pattern.sampleCount < 3 && pattern.avgScoreDelta > thresholds.maxDeltaTinyN) {
    return 'implausible-delta';
  }

  if (pattern.verifyPassRate < thresholds.minVerifyRate) {
    return 'low-verify-rate';
  }

  return null;
}

// ── Prior estimation ──────────────────────────────────────────────────────────

/**
 * Estimate a reasonable prior mean from the local pattern library.
 * Falls back to a conservative default if library is empty.
 */
export function estimatePriorMean(library: PatternLibraryIndex): number {
  if (library.entries.length === 0) return 0.8;
  const sum = library.entries.reduce((acc, e) => acc + (e.avgRoi ?? 0), 0);
  return Math.round((sum / library.entries.length) * 1000) / 1000;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Verify a shared pattern bundle before import.
 * Returns approved (possibly shrunk) patterns and quarantined ones.
 *
 * Steps:
 *   1. For each pattern: run implausibility gate
 *   2. For approved: apply Bayesian shrinkage to delta
 *   3. Compute overall trust score = approved / total
 */
export function verifyBundle(
  bundle: SharedPatternBundle,
  localLibrary: PatternLibraryIndex,
  opts: BundleTrustOptions = {},
): TrustVerificationResult {
  const thresholds: ImplausibilityThresholds = {
    maxDeltaTinyN: opts.thresholds?.maxDeltaTinyN ?? 3.5,
    minSamples: opts.thresholds?.minSamples ?? 1,
    minVerifyRate: opts.thresholds?.minVerifyRate ?? 0.3,
  };
  const priorMean = opts.priorMean ?? estimatePriorMean(localLibrary);
  const priorStrength = opts.priorStrength ?? 5;

  const approved: SharedPatternStats[] = [];
  const quarantined: QuarantinedPattern[] = [];
  let shrinkageApplied = 0;

  for (const pattern of bundle.patterns) {
    const quarantineReason = implausibilityCheck(pattern, thresholds);

    if (quarantineReason !== null) {
      quarantined.push({
        patternName: pattern.patternName,
        reason: quarantineReason,
        originalDelta: pattern.avgScoreDelta,
        threshold: quarantineReason === 'implausible-delta'
          ? thresholds.maxDeltaTinyN
          : quarantineReason === 'low-verify-rate'
            ? thresholds.minVerifyRate
            : thresholds.minSamples,
      });
      continue;
    }

    // Apply Bayesian shrinkage to delta
    const shrunkDelta = shrinkClaim(pattern.avgScoreDelta, pattern.sampleCount, priorMean, priorStrength);
    const wasShrunk = Math.abs(shrunkDelta - pattern.avgScoreDelta) > 0.001;
    if (wasShrunk) shrinkageApplied++;

    approved.push({ ...pattern, avgScoreDelta: shrunkDelta });
  }

  const total = bundle.patterns.length;
  const trustScore = total > 0
    ? Math.round((approved.length / total) * 100) / 100
    : 1.0;

  return { approved, quarantined, trustScore, shrinkageApplied };
}
