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
//      (or scores.self) clamped by the market-dim cap. Migration-friendly.
//   7. Demote, never annihilate — an outcome declared above what its evidence
//      kind can support (classifyOutcomeKind) is re-bucketed to the highest tier
//      its quality cap fits, not dropped. A passing T5 test-runner earns T4/7.0,
//      never T5/8.0 and never 0.0 (the fleet-wide "derived-stuck-0" bug).
//
// This is the function that replaces "agent writes a score" as the source of truth.

import { TIER_SCORE_CAPS, isEvidenceStale, type CapabilityTier } from '../matrix/types/capability-test.js';
import { isOutcomePassing, makeEvidenceKey, type Outcome, type OutcomeEvidence } from '../matrix/types/outcome.js';
import { classifyOutcomeKind } from '../matrix/engines/outcome-quality.js';
import { extractTestFiles } from '../matrix/engines/test-file-patterns.js';
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

/** Extract test-receipt identifiers from a command string. Used for cross-dim sharing
 *  detection and the T7 distinct-receipt veto. Delegates to the ONE canonical polyglot
 *  recognizer (test-file-patterns.ts): JS test files (historical regex, unchanged —
 *  includes directory separators so `tests/a/x.test.ts` ≠ `tests/b/x.test.ts`), plus
 *  Python/Rust/Go test files and cargo/go-test target pseudo-identifiers, so a polyglot
 *  repo's shared receipts are visible to the same vetoes as JS ones.
 *  Lockstep: scripts/evidence-rescore.mjs mirrors this for the crusade rescore;
 *  tests/evidence-rescore-drift.test.ts pins the two together.
 */
export { extractTestFiles as extractPrimaryTestFiles } from '../matrix/engines/test-file-patterns.js';

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
  /** Over-declared outcomes re-bucketed to the tier their evidence kind supports.
   *  Surfaced by validate/gap so the operator sees WHY a T5 declaration only
   *  earned T4 credit — the honest remedy is a real product run, not a relabel. */
  demotions: Array<{ outcomeId: string; from: CapabilityTier; to: CapabilityTier; reason: string }>;
}

/**
 * Highest tier whose score cap fits under a quality maxScore, or null when the
 * cap sits below every tier floor (only then may an outcome be excluded).
 * A test-runner's 7.0 quality cap maps to T4 (cap 7.0) — the demotion target.
 */
function highestTierWithinCap(maxScore: number): CapabilityTier | null {
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    const tier = TIER_ORDER[i]!;
    if (TIER_SCORE_CAPS[tier] <= maxScore) return tier;
  }
  return null;
}

// ── Main pure function ───────────────────────────────────────────────────────

/**
 * Compute the score a dimension currently merits.
 *
 * Algorithm:
 *   1. If no outcomes declared, return legacy_score (or scores.self) clamped by
 *      the market-dim cap — migration path.
 *   2. Demote over-declared outcomes to the highest tier their quality cap fits
 *      (classifyOutcomeKind); group outcomes by effective tier; T0..T8.
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
    // Market dims must be capped on the legacy path too. This return used to
    // bypass the MARKET_DIMS clamp below entirely, so a market dim with no
    // outcomes echoed its self-written legacy score uncapped (the token_economy
    // 7.0-despite-5.0-cap leak). Internal claims never exceed the market cap.
    let legacy = dim.legacy_score ?? dim.scores?.self ?? 0;
    if (MARKET_DIMS.has(dim.id) && legacy > MARKET_DIM_IMPLEMENTATION_CAP) {
      legacy = MARKET_DIM_IMPLEMENTATION_CAP;
    }
    return {
      dimensionId: dim.id,
      score: legacy,
      highestFullPassedTier: null,
      perTier: [],
      usedLegacyFallback: true,
      legacyScoreUsed: legacy,
      demotions: [],
    };
  }

  // Quality-cap demotion (the "derived-stuck-0" fix). An outcome declared above
  // what its evidence kind supports — e.g. a test-runner command declared T5 when
  // classifyOutcomeKind caps it at 7.0 — used to be EXCLUDED from scoring. When
  // every outcome of a dim was over-declared, exclusion annihilated the dim to
  // 0.0 even with all receipts passing (the operator's outcome_verification dim
  // read 0.0 with 4/4 green). Demotion keeps the honesty invariant — a test-runner
  // still never unlocks T5/8.0 — while crediting the evidence at the tier it
  // actually supports: re-bucket into the highest tier whose cap fits under the
  // quality maxScore (T5 test-runner → T4/7.0). Only a quality cap below every
  // tier floor still excludes. Demotion depends solely on the outcome's static
  // shape, so purity/monotonicity/boundedness are preserved.
  const demotions: DerivedScoreBreakdown['demotions'] = [];
  const effective: Array<{ outcome: Outcome; tier: CapabilityTier }> = [];
  for (const outcome of outcomes) {
    const { maxScore, reason } = classifyOutcomeKind(outcome);
    if (maxScore >= TIER_SCORE_CAPS[outcome.tier]) {
      effective.push({ outcome, tier: outcome.tier });
      continue;
    }
    const demoted = highestTierWithinCap(maxScore);
    if (demoted === null) continue; // cap below every tier floor — excluded
    demotions.push({ outcomeId: outcome.id, from: outcome.tier, to: demoted, reason });
    effective.push({ outcome, tier: demoted });
  }

  // Group by EFFECTIVE tier (declared tier after any quality-cap demotion).
  const tierBuckets = new Map<CapabilityTier, Outcome[]>();
  for (const { outcome, tier } of effective) {
    const bucket = tierBuckets.get(tier) ?? [];
    bucket.push(outcome);
    tierBuckets.set(tier, bucket);
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
      // Over-declared outcomes were already demoted into this bucket above, so
      // every outcome here is scored — and freshness-checked — at the tier its
      // evidence kind genuinely supports (`tier` is the effective bucket tier).
      const entry = evidence.get(makeEvidenceKey(dim.id, outcome.id));
      if (now && entry && isEvidenceStale(tier, entry.ranAt, now)) {
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
      // file is one receipt dressed as many — not genuine multi-receipt. Filters by
      // EFFECTIVE tier — a demoted (T4-quality) outcome is not a T5+ receipt and
      // must not add file diversity toward the T7 consensus.
      if (allPassing) {
        const highTierOuts = effective
          .filter(e => TIER_INDEX[e.tier] >= TIER_INDEX.T5)
          .map(e => e.outcome);
        const testFiles = highTierOuts.flatMap(
          o => extractTestFiles((o as { command?: string }).command ?? ''),
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
        const highTierOuts = effective
          .filter(e => TIER_INDEX[e.tier] >= TIER_INDEX.T5)
          .map(e => e.outcome);
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
    demotions,
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
