// derive-gated.ts — THE canonical "score this dimension now" function (council 2026-06-22, unanimous: "there
// is no single canonical scoring function; the gate chain is hand-re-implemented in three places and has
// measurably drifted"). loadMatrix, gap, and validate each re-implemented the chain and disagreed:
//   • loadMatrix's freshness pre-gate applied the UN-split TTL to capability tiers, so a BUILD-COMPLETE dim
//     read 8.0 in gap but collapsed to the 5.0 unverified floor in the headline a week later — contradicting
//     the ladder-split fix (f3ffb82).
//   • gap omitted `now` AND integrityCapFor, so it over-counted (the live "14 dims at 8.0 vs 9 at 7.0").
//
// This is the single source of truth. The chain, in order:
//   freshness pre-gate (LADDER-SPLIT-AWARE: T0–T5 SHA-stable, only T6+ decays)
//     → computeDerivedScoreWithBreakdown(…, now)
//     → applyLegacyReceiptCeiling (no-receipt dims cap at 7.0)
//     → integrityCapFor (seamed→6.0, shared-receipt/decoupled→7.0)
//     → applyFrontierGate (>8.0 needs a court-validated frontier_spec)
//     → applyGroundingGate (>7 needs a PASSING external receipt; default-off until the first one).

import { computeDerivedScoreWithBreakdown, type DimensionForScoring, type DerivedScoreBreakdown } from './derived-score.js';
import { applyLegacyReceiptCeiling } from '../matrix/engines/receipt-ceiling.js';
import { isEvidenceStale, type CapabilityTier } from '../matrix/types/capability-test.js';
import { makeEvidenceKey, type OutcomeEvidence } from '../matrix/types/outcome.js';
import type { IntegrityReport } from '../matrix/engines/outcome-integrity.js';

/** Operational (live) tiers — the only ones that decay with their TTL. T0–T5 are SHA-stable capability tiers. */
const OPERATIONAL_TIERS = new Set<CapabilityTier>(['T6', 'T7', 'T8']);

export interface GatedDerivation {
  /** The gated derived score, or null when there is no DERIVABLE evidence (caller drops to the unverified floor). */
  score: number | null;
  breakdown: DerivedScoreBreakdown | null;
}

type DimLike = {
  id: string;
  scores: Record<string, number>;
  outcomes?: Array<{ id: string; tier?: CapabilityTier }>;
  declared_ceiling?: CapabilityTier;
};

/**
 * Is there evidence we can derive a score from? LADDER-SPLIT-AWARE: a capability-tier (T0–T5) outcome with
 * evidence on disk is always derivable (SHA-eviction handles code change — elapsed time does not invalidate
 * "the code works"); an operational-tier (T6+) outcome must be fresh within its TTL.
 */
function hasDerivableEvidence(dim: DimLike, evidence: OutcomeEvidence, now: Date): boolean {
  const outcomes = dim.outcomes ?? [];
  return outcomes.some(o => {
    const entry = evidence.get(makeEvidenceKey(dim.id, o.id));
    if (!entry?.ranAt) return false;
    const tier = o.tier ?? 'T5';
    if (!OPERATIONAL_TIERS.has(tier)) return true;        // capability tier present → SHA-stable, derivable
    return !isEvidenceStale(tier, entry.ranAt, now);      // operational tier → must be fresh within TTL
  });
}

/**
 * The canonical gated derivation. Pass the SAME `now` and (optionally) a precomputed `integrityReport`
 * everywhere so every surface — loadMatrix headline, gap, validate — returns an identical number for the same
 * dim + evidence. Returns score=null when a dim declares outcomes but none are currently derivable (the caller
 * treats that as UNVERIFIED, not a numeric 0).
 */
export async function deriveDimScoreGated(
  dim: DimLike,
  evidence: OutcomeEvidence,
  now: Date,
  integrityReport: IntegrityReport | null,
): Promise<GatedDerivation> {
  const outcomes = dim.outcomes ?? [];
  if (outcomes.length > 0 && !hasDerivableEvidence(dim, evidence, now)) {
    return { score: null, breakdown: null };
  }

  const dfs: DimensionForScoring = {
    id: dim.id,
    outcomes: outcomes.length > 0 ? (outcomes as DimensionForScoring['outcomes']) : undefined,
    declared_ceiling: dim.declared_ceiling,
    legacy_score: dim.scores['self'],
    scores: dim.scores,
  };

  const breakdown = computeDerivedScoreWithBreakdown(dfs, evidence, now);
  let score = applyLegacyReceiptCeiling(breakdown.score, breakdown);

  if (integrityReport) {
    const { integrityCapFor } = await import('../matrix/engines/outcome-integrity.js');
    score = integrityCapFor(score, dim.id, integrityReport).cappedScore;
  }

  const { applyFrontierGate, applyGroundingGate } = await import('./frontier-spec.js');
  score = applyFrontierGate(score, dim).score;
  score = applyGroundingGate(score, dim, evidence).score;

  return { score, breakdown };
}
