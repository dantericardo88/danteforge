// Matrix Kernel — Derived score computation (Phase F).
//
// The pure function at the heart of outcome-derived scoring. Given a
// dimension (with its declared outcomes) and a snapshot of outcome evidence,
// returns the score the dimension currently merits.
//
// Properties (asserted by tests):
//   1. Pure — same inputs always produce the same output.
//   2. Monotonic — more outcomes passing never lowers the score.
//   3. Bounded — score is at most TIER_SCORE_CAPS[declared_ceiling].
//   4. Tier-gated — a tier's cap is unlocked only when ALL of its outcomes pass.
//   5. Continuous within tiers — partial outcome passes give partial credit
//      between the previous tier's cap and the current tier's cap.
//   6. Legacy fallback — when a dim declares no outcomes, returns dim.legacy_score
//      (or scores.self) unchanged. Migration-friendly.
//
// This is the function that replaces "agent writes a score" as the source of truth.

import { TIER_SCORE_CAPS, isEvidenceStale, type CapabilityTier } from '../matrix/types/capability-test.js';
import { isOutcomePassing, makeEvidenceKey, type Outcome, type OutcomeEvidence } from '../matrix/types/outcome.js';
import { classifyOutcomeKind } from '../matrix/engines/outcome-quality.js';
import { MARKET_CAPPED_DIMS, MARKET_DIM_MAX_SCORE } from './market-dims.js';

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface DimensionForScoring {
  id: string;
  outcomes?: Outcome[];
  declared_ceiling?: CapabilityTier;
  legacy_score?: number;
  scores?: { self?: number };
}

const TIER_ORDER: CapabilityTier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];

const TIER_INDEX: Record<CapabilityTier, number> = {
  T0: 0, T1: 1, T2: 2, T3: 3, T4: 4, T5: 5, T6: 6, T7: 7, T8: 8,
};

/**
 * T7 (multi-receipt consensus) requires 3+ outcomes at T5+ all passing.
 * If dim has fewer than MIN_T7_OUTCOMES at T5+, T7 outcomes are treated as
 * not-all-passing even if the T7 outcome itself passes. This prevents a
 * single T7 outcome from unlocking 9.0 — the dim must demonstrate breadth
 * of depth evidence first.
 */
const MIN_T7_HIGH_TIER_OUTCOMES = 3;

/**
 * Dims bounded by external/market signals, not internal tests.
 * Internal evidence cannot exceed the market cap. Canonical set: market-dims.ts.
 */
const MARKET_DIMS = MARKET_CAPPED_DIMS;
const MARKET_DIM_IMPLEMENTATION_CAP = MARKET_DIM_MAX_SCORE;

/** Extract test file paths from a command string. Used for cross-dim sharing detection.
 *  Includes directory separators so `tests/a/x.test.ts` and `tests/b/x.test.ts` are distinct.
 */
export function extractPrimaryTestFiles(command: string): string[] {
  const matches = command.match(/[\w./-]+\.test\.[jt]sx?/g);
  return matches ? [...new Set(matches)] : [];
}

// ── Breakdown for diagnostics ────────────────────────────────────────────────

export interface DerivedScoreBreakdown {
  dimensionId: string;
  /** The score we computed. */
  score: number;
  /** Highest tier where ALL declared outcomes pass. */
  highestFullPassedTier: CapabilityTier | null;
  /** Per-tier counts of declared + passing outcomes. */
  perTier: Array<{
    tier: CapabilityTier;
    declared: number;
    passing: number;
    /** Outcomes that had evidence but it was older than TIER_FRESHNESS_MS. */
    stale: number;
    allPassing: boolean;
    /** True if ANY outcome in this tier has evidenceQuality INFERRED or AMBIGUOUS.
     *  INFERRED tiers cannot contribute to the T7 multi-receipt consensus minimum. */
    anyInferred: boolean;
  }>;
  /** True if the dim has no outcomes declared (legacy fallback). */
  usedLegacyFallback: boolean;
  /** When usedLegacyFallback, the legacy score we returned. */
  legacyScoreUsed?: number;
}

// ── Main pure function ───────────────────────────────────────────────────────

/**
 * Compute the score a dimension currently merits.
 *
 * Algorithm:
 *   1. If no outcomes declared, return legacy_score (or scores.self) — migration path.
 *   2. Group outcomes by tier; T0..T6.
 *   3. Walk tiers low to high. While ALL outcomes in a tier pass, "claim" that tier.
 *   4. The first tier where outcomes don't all pass is the "next tier" — partial credit.
 *   5. Score = TIER_SCORE_CAPS[claimed] + (TIER_SCORE_CAPS[next] - TIER_SCORE_CAPS[claimed]) * progress.
 *   6. Apply declared_ceiling as a hard cap.
 *   7. Round to 1 decimal place.
 */
export function computeDerivedScore(
  dim: DimensionForScoring,
  evidence: OutcomeEvidence,
  now?: Date,
): number {
  return computeDerivedScoreWithBreakdown(dim, evidence, now).score;
}

/**
 * Same as computeDerivedScore but returns the full breakdown for diagnostics.
 *
 * @param now — When provided, evidence older than TIER_FRESHNESS_MS[tier] is
 *   treated as not-passing (score decay). Omit to disable staleness checking
 *   (backward-compatible — all existing callers that don't pass `now` are unaffected).
 */
export function computeDerivedScoreWithBreakdown(
  dim: DimensionForScoring,
  evidence: OutcomeEvidence,
  now?: Date,
): DerivedScoreBreakdown {
  const outcomes = dim.outcomes ?? [];
  if (outcomes.length === 0) {
    const legacy = dim.legacy_score ?? dim.scores?.self ?? 0;
    return {
      dimensionId: dim.id,
      score: legacy,
      highestFullPassedTier: null,
      perTier: [],
      usedLegacyFallback: true,
      legacyScoreUsed: legacy,
    };
  }

  // Group by tier.
  const tierBuckets = new Map<CapabilityTier, Outcome[]>();
  for (const outcome of outcomes) {
    const bucket = tierBuckets.get(outcome.tier) ?? [];
    bucket.push(outcome);
    tierBuckets.set(outcome.tier, bucket);
  }

  const perTier: DerivedScoreBreakdown['perTier'] = [];
  let highestFullPassedTier: CapabilityTier | null = null;
  let nextTier: CapabilityTier | null = null;
  let nextTierProgress = 0;

  for (const tier of TIER_ORDER) {
    const tierOutcomes = tierBuckets.get(tier) ?? [];
    if (tierOutcomes.length === 0) {
      // Tier not declared — implicit pass under monotonicity (a higher tier passing
      // implies all lower tiers also pass; missing intermediate tiers are credit-free).
      continue;
    }

    let passing = 0;
    let stale = 0;
    for (const outcome of tierOutcomes) {
      // Quality cap: T5+ outcomes whose kind cannot support the declared tier
      // are excluded. Prevents shell npm-test outcomes from claiming T5+ credit.
      if (TIER_INDEX[outcome.tier] >= TIER_INDEX.T5) {
        const { maxScore } = classifyOutcomeKind(outcome);
        if (maxScore < TIER_SCORE_CAPS[outcome.tier]) continue;
      }
      const entry = evidence.get(makeEvidenceKey(dim.id, outcome.id));
      if (now && entry && isEvidenceStale(outcome.tier, entry.ranAt, now)) {
        stale++;
        continue; // treat stale evidence as not-passing
      }
      if (isOutcomePassing(outcome, entry)) passing++;
    }

    let allPassing = passing === tierOutcomes.length;

    // INFERRED evidence quality check: a tier where any outcome has INFERRED or AMBIGUOUS
    // evidence cannot contribute to the T7 multi-receipt consensus minimum. INFERRED
    // evidence still earns normal pass/partial credit for lower tiers — it simply cannot
    // be used to self-certify at the highest trust level.
    const anyInferred = tierOutcomes.some(o => {
      const e = evidence.get(makeEvidenceKey(dim.id, o.id));
      const q = e?.evidenceQuality;
      return q === 'INFERRED' || q === 'AMBIGUOUS';
    });

    // T7 multi-receipt consensus: even if this tier's outcomes pass, the dim
    // must have 3+ outcomes at T5+ all passing AND all EXTRACTED to claim T7.
    // Without broad depth evidence from clean sources, a lone T7 outcome cannot unlock 9.0.
    if (allPassing && tier === 'T7') {
      const highTierPassCount = perTier
        .filter(pt => TIER_INDEX[pt.tier] >= TIER_INDEX.T5 && pt.allPassing && !pt.anyInferred)
        .reduce((sum, pt) => sum + pt.declared, 0);
      // T7 tier itself is also excluded from the count when anyInferred.
      const currentTierContrib = anyInferred ? 0 : tierOutcomes.length;
      if (highTierPassCount + currentTierContrib < MIN_T7_HIGH_TIER_OUTCOMES) {
        allPassing = false;
        passing = 0; // structural veto — partial credit must not reach T7 cap
      }
      // Distinct test-file check: all T5+ outcomes pointing to the same single test
      // file is one receipt dressed as many — not genuine multi-receipt.
      if (allPassing) {
        const highTierOuts = outcomes.filter(o => TIER_INDEX[o.tier] >= TIER_INDEX.T5);
        const testFiles = highTierOuts.flatMap(
          o => extractPrimaryTestFiles((o as { command?: string }).command ?? ''),
        );
        const uniqueFiles = new Set(testFiles);
        if (testFiles.length > 0 && uniqueFiles.size < 2) {
          allPassing = false;
          passing = 0; // structural veto — partial credit must not reach T7 cap
        }
      }

      // Session-ID temporal separation: T7 evidence must span ≥2 distinct
      // validate sessions. A single `danteforge validate` run stamps the same
      // PROCESS_SESSION_ID on all entries it writes — so evidence written in
      // one session cannot self-certify at T7 regardless of file diversity.
      // Backward-compatible: old evidence without session_id skips this check.
      if (allPassing) {
        const highTierOuts = outcomes.filter(o => TIER_INDEX[o.tier] >= TIER_INDEX.T5);
        const sessionIds = highTierOuts
          .map(o => evidence.get(makeEvidenceKey(dim.id, o.id))?.session_id)
          .filter((s): s is string => typeof s === 'string');
        if (sessionIds.length >= 2) {
          const uniqueSessions = new Set(sessionIds);
          if (uniqueSessions.size < 2) {
            allPassing = false;
            passing = 0; // structural veto — single-session self-certification cannot reach T7
          }
        }
      }
    }

    perTier.push({ tier, declared: tierOutcomes.length, passing, stale, allPassing, anyInferred });

    if (allPassing) {
      highestFullPassedTier = tier;
    } else {
      nextTier = tier;
      nextTierProgress = passing / tierOutcomes.length;
      break;
    }
  }

  // Compute the raw score.
  let score: number;
  if (highestFullPassedTier === null && nextTier === null) {
    score = 0;
  } else if (highestFullPassedTier === null) {
    // No tier fully passed; partial credit toward the lowest declared tier.
    score = TIER_SCORE_CAPS[nextTier!] * nextTierProgress;
  } else if (nextTier === null) {
    score = TIER_SCORE_CAPS[highestFullPassedTier];
  } else {
    const lower = TIER_SCORE_CAPS[highestFullPassedTier];
    const upper = TIER_SCORE_CAPS[nextTier];
    score = lower + (upper - lower) * nextTierProgress;
  }

  // Apply declared_ceiling cap.
  if (dim.declared_ceiling) {
    const ceilingCap = TIER_SCORE_CAPS[dim.declared_ceiling];
    if (score > ceilingCap) score = ceilingCap;
  }

  // Market dims: internal evidence cannot exceed MARKET_DIM_IMPLEMENTATION_CAP.
  if (MARKET_DIMS.has(dim.id) && score > MARKET_DIM_IMPLEMENTATION_CAP) {
    score = MARKET_DIM_IMPLEMENTATION_CAP;
  }

  return {
    dimensionId: dim.id,
    score: roundToOneDecimal(score),
    highestFullPassedTier,
    perTier,
    usedLegacyFallback: false,
  };
}

function roundToOneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Helpers used by other modules ────────────────────────────────────────────

/** True iff a dim has any outcome declared. */
export function hasOutcomes(dim: DimensionForScoring): boolean {
  return (dim.outcomes?.length ?? 0) > 0;
}

/**
 * Tier of the next outcome whose pass would raise the score, or null if the
 * dim is at its declared_ceiling. Used by crusade to identify what to work on.
 */
export function nextTierToUnlock(
  dim: DimensionForScoring,
  evidence: OutcomeEvidence,
): CapabilityTier | null {
  const breakdown = computeDerivedScoreWithBreakdown(dim, evidence);
  if (breakdown.usedLegacyFallback) return null;
  for (const row of breakdown.perTier) {
    if (!row.allPassing) return row.tier;
  }
  // All declared tiers fully pass. If a higher tier exists in TIER_ORDER, it's not yet declared.
  const highestIdx = breakdown.highestFullPassedTier
    ? TIER_INDEX[breakdown.highestFullPassedTier]
    : -1;
  const ceilingIdx = dim.declared_ceiling ? TIER_INDEX[dim.declared_ceiling] : 6;
  if (highestIdx >= ceilingIdx) return null;
  return null; // dim has more potential but no outcomes declared at the next tier
}
