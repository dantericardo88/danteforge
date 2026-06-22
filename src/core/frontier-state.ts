// frontier-state.ts — Phase H Slice 4.
//
// Replaces the numerical "score >= target" check with a conjunction of observable
// conditions. The crusade's win condition becomes a boolean state, never a
// number. See docs/CAPABILITY-TIERS.md for the contracts.
//
// A dim is at frontier iff:
//   1. All outcomes at its declared_ceiling pass
//   2. No active dispensation against the dim
//   3. Either declared_ceiling < T3, OR a production-usage-fresh outcome passes
//
// A whole-project frontier state is one of:
//   - frontier-reached       — every eligible dim is at frontier
//   - stuck-on-dims          — at least one dim has gone N waves without progress
//   - blocked-by-dispensations — operator-approved overrides outstanding (autonomy paused)

import { computeDerivedScoreWithBreakdown, type DimensionForScoring } from './derived-score.js';
import type { CapabilityTier } from '../matrix/types/capability-test.js';
import type { OutcomeEvidence, Outcome } from '../matrix/types/outcome.js';
import { isOutcomePassing, makeEvidenceKey } from '../matrix/types/outcome.js';
import { verifyValidation, type FrontierSpec } from './frontier-spec.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type DimensionFrontierStatus =
  | 'at-frontier'           // all 3 conjunction conditions hold
  | 'progressing'           // some outcomes pass, more to do, not stuck
  | 'stuck'                 // N waves without a new passing outcome
  | 'blocked-by-dispensation' // operator dispensation against this dim
  | 'no-outcomes-declared'; // dim has not migrated to outcomes yet

export interface DimensionFrontierResult {
  dimensionId: string;
  status: DimensionFrontierStatus;
  derivedScore: number;
  highestPassedTier: CapabilityTier | null;
  declaredCeiling: CapabilityTier | null;
  /** Per-condition booleans for diagnostics. */
  conditions: {
    allCeilingOutcomesPass: boolean;
    noActiveDispensation: boolean;
    productionUsageFreshOrLowTier: boolean;
    /** PRE-launch: the dim is court-VALIDATED (signed receipt). Distinguishes a self-consistent frontier
     *  from a world-grounded (production-usage-fresh) one in the report. */
    courtValidated: boolean;
  };
  /** Number of crusade waves since this dim last gained a new passing outcome. */
  wavesSinceProgress?: number;
  /** Human-readable reason for the status. */
  reason: string;
}

export type ProjectFrontierTerminal =
  | 'frontier-reached'
  | 'stuck-on-dims'
  | 'blocked-by-dispensations'
  | 'progressing';

export interface ProjectFrontierState {
  terminal: ProjectFrontierTerminal;
  perDimension: DimensionFrontierResult[];
  /** Dims that are stuck (status === 'stuck'). */
  stuckDims: string[];
  /** Dispensations blocking autonomy. */
  blockingDispensations: string[];
  /** Summary message for the operator. */
  summary: string;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ProjectFrontierInputs {
  dimensions: Array<{
    id: string;
    outcomes?: Outcome[];
    declared_ceiling?: CapabilityTier;
    scores?: { self?: number };
    legacy_score?: number;
    /** The dim's frontier_spec — needed so the terminal can accept a COURT-VALIDATED dim (signed receipt)
     *  as at-frontier, not ONLY a production-usage-fresh outcome. The caller must thread this through. */
    frontier_spec?: FrontierSpec;
  }>;
  evidence: OutcomeEvidence;
  /** Map of dimId → wavesSinceProgress, from DanteState. */
  wavesSinceProgress?: Record<string, number>;
  /** Map of dimId → list of dispensation receipt ids. Empty/missing means no dispensation. */
  dispensations?: Record<string, string[]>;
  /** Threshold for marking a dim as stuck. Default 3. */
  stuckThreshold?: number;
  /** Launch posture (default 'pre-launch'). PRE-launch, a court-validated dim counts as at-frontier (the
   *  self-consistent frontier — court is the independent authority). POST-launch, the stricter
   *  production-usage-fresh outcome is REQUIRED — court-validation alone no longer suffices. This keeps
   *  the two distinct (self-consistent vs world-grounded) and re-tightenable once the project ships. */
  launchStatus?: 'pre-launch' | 'post-launch';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIER_ORDER: Record<CapabilityTier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4, T5: 5, T6: 6, T7: 7, T8: 8 };

function tierAtLeast(a: CapabilityTier, b: CapabilityTier): boolean {
  return TIER_ORDER[a] >= TIER_ORDER[b];
}

function dispensationsFor(dimId: string, table: Record<string, string[]> | undefined): string[] {
  if (!table) return [];
  return table[dimId] ?? [];
}

// ── Per-dimension status ─────────────────────────────────────────────────────

export function computeDimensionFrontierStatus(
  dim: ProjectFrontierInputs['dimensions'][0],
  evidence: OutcomeEvidence,
  options: {
    wavesSinceProgress?: number;
    dispensations?: string[];
    stuckThreshold?: number;
    launchStatus?: 'pre-launch' | 'post-launch';
  } = {},
): DimensionFrontierResult {
  const dfs: DimensionForScoring = {
    id: dim.id,
    outcomes: dim.outcomes,
    declared_ceiling: dim.declared_ceiling,
    legacy_score: dim.legacy_score,
    scores: dim.scores,
  };
  const breakdown = computeDerivedScoreWithBreakdown(dfs, evidence);

  // Status 1: no outcomes → can't be at frontier under this substrate.
  if (breakdown.usedLegacyFallback || !dim.outcomes || dim.outcomes.length === 0) {
    return {
      dimensionId: dim.id,
      status: 'no-outcomes-declared',
      derivedScore: breakdown.score,
      highestPassedTier: null,
      declaredCeiling: dim.declared_ceiling ?? null,
      conditions: {
        allCeilingOutcomesPass: false,
        noActiveDispensation: dispensationsFor(dim.id, options.dispensations ? { [dim.id]: options.dispensations } : undefined).length === 0,
        productionUsageFreshOrLowTier: false,
        courtValidated: false,
      },
      wavesSinceProgress: options.wavesSinceProgress,
      reason: 'dimension has not declared outcomes — run `danteforge outcomes migrate`',
    };
  }

  // Condition 1: all outcomes at declared_ceiling (or current highest) pass
  const ceiling = dim.declared_ceiling ?? 'T6';
  const ceilingOutcomes = dim.outcomes.filter(o => o.tier === ceiling);
  let allCeilingPass: boolean;
  if (ceilingOutcomes.length > 0) {
    allCeilingPass = ceilingOutcomes.every(o => {
      const entry = evidence.get(makeEvidenceKey(dim.id, o.id));
      return isOutcomePassing(o, entry);
    });
  } else {
    // No outcomes declared AT the ceiling — fall back to highest-fully-passed-tier == ceiling.
    allCeilingPass = breakdown.highestFullPassedTier !== null
      && TIER_ORDER[breakdown.highestFullPassedTier] >= TIER_ORDER[ceiling];
  }

  // Condition 2: no active dispensation
  const dispList = options.dispensations ?? [];
  const noDispensation = dispList.length === 0;

  // Condition 3: terminal product proof. Lower tiers (<T3) auto-pass. For T3+, at-frontier requires EITHER
  //   (a) a passing production-usage-fresh outcome (the stricter wiring-freshness tier — REQUIRED post-launch), OR
  //   (b) PRE-LAUNCH only: a COURT-VALIDATED spec — frontier_spec.status==='validated' AND verifyValidation()
  //       confirms the SIGNED receipt (the independent semantic-parity gate; the same authority ascend-frontier's
  //       isDimDone already treats as terminal). Reading the SIGNED receipt (NOT a dim-writable flag) keeps this
  //       kernel-owned (CLAUDE.md Fix B). This resolves the deadlock where a court-validated 9.0 never counted as
  //       at-frontier and the crusade loop could spin forever / refuse to expand.
  let prodUsageOk: boolean;
  let courtValidated = false;
  if (!tierAtLeast(ceiling, 'T3')) {
    prodUsageOk = true; // Lower tiers don't require production-reach.
  } else {
    const freshOutcome = dim.outcomes?.find(o => o.kind === 'production-usage-fresh');
    const freshOk = freshOutcome
      ? isOutcomePassing(freshOutcome, evidence.get(makeEvidenceKey(dim.id, freshOutcome.id)))
      : false;
    courtValidated = !!(dim.frontier_spec?.status === 'validated' && verifyValidation(dim.id, dim.frontier_spec));
    const preLaunch = (options.launchStatus ?? 'pre-launch') === 'pre-launch';
    prodUsageOk = freshOk || (preLaunch && courtValidated);
  }

  const atFrontier = allCeilingPass && noDispensation && prodUsageOk;
  const stuckThreshold = options.stuckThreshold ?? 3;
  const waves = options.wavesSinceProgress ?? 0;

  let status: DimensionFrontierStatus;
  let reason: string;
  if (!noDispensation) {
    status = 'blocked-by-dispensation';
    reason = `dispensation outstanding: ${dispList.join(', ')}`;
  } else if (atFrontier) {
    status = 'at-frontier';
    // LABEL the grounding so a self-consistent (court) frontier is NEVER mistaken for world-grounded usage.
    reason = courtValidated
      ? `all ${ceiling} outcomes pass AND court-VALIDATED (signed receipt) — self-consistent frontier (pre-launch); production-usage-fresh not yet required`
      : `all ${ceiling} outcomes pass AND production-usage-fresh passes AND no dispensations — world-grounded`;
  } else if (waves >= stuckThreshold) {
    status = 'stuck';
    reason = `${waves} crusade waves without a new passing outcome at ${ceiling}; halt for operator review`;
  } else {
    status = 'progressing';
    const missing: string[] = [];
    if (!allCeilingPass) missing.push(`outcomes at ${ceiling} not all passing`);
    if (!prodUsageOk) missing.push(`needs a court-VALIDATED spec (pre-launch) OR a passing production-usage-fresh outcome (T3+)`);
    reason = `progressing — ${missing.join('; ')}`;
  }

  return {
    dimensionId: dim.id,
    status,
    derivedScore: breakdown.score,
    highestPassedTier: breakdown.highestFullPassedTier,
    declaredCeiling: dim.declared_ceiling ?? null,
    conditions: {
      allCeilingOutcomesPass: allCeilingPass,
      noActiveDispensation: noDispensation,
      productionUsageFreshOrLowTier: prodUsageOk,
      courtValidated,
    },
    wavesSinceProgress: options.wavesSinceProgress,
    reason,
  };
}

// ── Project-level state ──────────────────────────────────────────────────────

export function computeProjectFrontierState(input: ProjectFrontierInputs): ProjectFrontierState {
  const perDim: DimensionFrontierResult[] = [];
  for (const dim of input.dimensions) {
    perDim.push(computeDimensionFrontierStatus(dim, input.evidence, {
      wavesSinceProgress: input.wavesSinceProgress?.[dim.id],
      dispensations: input.dispensations?.[dim.id],
      stuckThreshold: input.stuckThreshold,
      launchStatus: input.launchStatus,
    }));
  }

  const stuck = perDim.filter(r => r.status === 'stuck');
  const blocked = perDim.filter(r => r.status === 'blocked-by-dispensation');
  const declaredDims = perDim.filter(r => r.status !== 'no-outcomes-declared');
  const allAtFrontier = declaredDims.length > 0 && declaredDims.every(r => r.status === 'at-frontier');

  let terminal: ProjectFrontierTerminal;
  let summary: string;
  if (blocked.length > 0) {
    terminal = 'blocked-by-dispensations';
    summary = `${blocked.length} dim(s) have active dispensations — autonomy paused globally. Clear them with \`danteforge dispensation clear\`.`;
  } else if (allAtFrontier) {
    terminal = 'frontier-reached';
    summary = `every eligible dim (${declaredDims.length}) is at frontier`;
  } else if (stuck.length > 0) {
    terminal = 'stuck-on-dims';
    summary = `${stuck.length} dim(s) stuck for operator review: ${stuck.map(s => s.dimensionId).join(', ')}`;
  } else {
    terminal = 'progressing';
    const progressing = perDim.filter(r => r.status === 'progressing').length;
    summary = `${progressing} dim(s) progressing toward frontier; ${perDim.filter(r => r.status === 'no-outcomes-declared').length} not yet migrated`;
  }

  return {
    terminal,
    perDimension: perDim,
    stuckDims: stuck.map(s => s.dimensionId),
    blockingDispensations: blocked.flatMap(b => dispensationsFor(b.dimensionId, input.dispensations)),
    summary,
  };
}
