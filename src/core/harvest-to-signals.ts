// harvest-to-signals.ts — the bridge (CH-031) from the already-built harvesters to the keystone
// bar-writer (harvested-bar.ts). The competitor dossier fetcher (src/dossier/) and the competitor
// intel fetcher (competitor-intel-fetcher.ts) both fetch REAL external facts today, then dead-end at
// a report. These pure transforms turn those facts into HarvestedSignal[] for seedLeaderTargetFromHarvest.
//
// Pure (no I/O) so it is unit-testable without on-disk fixtures: the disk loader + the dossier
// DIMENSIONS_28 <-> matrix-dim taxonomy reconciliation + a real leaderboard fetch are the caller's
// job (the next sub-increment of CH-031). Hybrid trust posture is preserved here by what we DON'T set:
// dossier capability + intel demand signals are SUBJECTIVE, so `ratified_by` is left unset (a human
// ratifies them); only benchmark signals carry `verified_live`, set by a real re-fetch upstream.

import type { Dossier } from '../dossier/types.js';
import type { IntelReport, WeaknessSignal } from './competitor-intel-fetcher.js';
import type { HarvestedSignal } from './harvested-bar.js';

/**
 * Capability signals from a competitor dossier's VERIFIED evidence for one rubric dimension.
 * Only evidence with a non-empty verbatim quote counts (the dossier's own verification bar — an
 * EvidenceItem comment states the quote "must be non-empty to count as verified"). `dimNumber` is
 * the dossier's rubric dimension key ("1".."28"); the caller resolves which matrix dim it grounds.
 * `ratified_by` is intentionally unset: a capability claim is subjective and needs human ratification.
 */
export function dossierToCapabilitySignals(dossier: Dossier, dimNumber: string): HarvestedSignal[] {
  const dim = dossier.dimensions[dimNumber];
  if (!dim || dim.unverified) return [];
  const verified = (dim.evidence ?? []).filter(e => e.quote && e.quote.trim().length > 0);
  const fetchedAt = dossier.lastBuilt;
  return verified.map(e => ({
    kind: 'capability' as const,
    source: e.source,
    fetched_at: fetchedAt,
    claim: `${dossier.displayName}: ${e.claim}`,
  }));
}

/**
 * Demand signals from competitor-intel weakness mentions (GitHub issues / HackerNews / Reddit) for
 * one matrix dimension. The intel fetcher already maps each WeaknessSignal.category to a matrix
 * dimension id, so no taxonomy reconciliation is needed here. Optionally filter low-demand noise.
 * `ratified_by` is unset: demand is subjective and needs human ratification (hybrid posture).
 */
export function intelToDemandSignals(
  report: IntelReport,
  dimensionId: string,
  opts: { minDemand?: number } = {},
): HarvestedSignal[] {
  const minDemand = opts.minDemand ?? 0;
  const matches = report.signals.filter(
    (s: WeaknessSignal) => s.category === dimensionId && s.demandScore >= minDemand,
  );
  return matches.map(s => ({
    kind: 'demand' as const,
    source: s.url,
    fetched_at: s.foundAt,
    claim: `[${s.source} ·${s.demandScore}] ${s.title}${s.snippet ? ` — ${s.snippet}` : ''}`,
  }));
}

/**
 * A benchmark signal from a registered-suite leaderboard. `verifiedLive` is the CALLER's to set after
 * a real re-fetch (never hardcoded true here) — the hybrid posture auto-accepts a benchmark bar only
 * when the published number was confirmed live.
 */
export function benchmarkSignal(args: {
  suite: string;
  numeric: number;
  sourceUrl: string;
  fetchedAt: string;
  verifiedLive: boolean;
  claim?: string;
}): HarvestedSignal {
  return {
    kind: 'benchmark',
    source: args.sourceUrl,
    fetched_at: args.fetchedAt,
    claim: args.claim ?? `published frontier score ${args.numeric} on ${args.suite}`,
    numeric: args.numeric,
    suite: args.suite,
    verified_live: args.verifiedLive,
  };
}

export interface CollectHarvestArgs {
  /** Competitor dossiers + the dossier rubric dim key ("1".."28") that grounds this matrix dim. */
  dossiers?: Dossier[];
  dossierDimNumber?: string;
  /** Competitor intel report + the matrix dimension id to pull demand signals for. */
  intel?: IntelReport;
  dimensionId?: string;
  /** Minimum demand score for an intel signal to count. */
  minDemand?: number;
  /** A pre-built benchmark signal (from a leaderboard fetch). */
  benchmark?: HarvestedSignal;
}

/** Collect every available harvested signal for one matrix dimension from the supplied artifacts. */
export function collectHarvestedSignals(args: CollectHarvestArgs): HarvestedSignal[] {
  const out: HarvestedSignal[] = [];
  if (args.benchmark) out.push(args.benchmark);
  if (args.dossiers && args.dossierDimNumber) {
    for (const d of args.dossiers) out.push(...dossierToCapabilitySignals(d, args.dossierDimNumber));
  }
  if (args.intel && args.dimensionId) {
    out.push(...intelToDemandSignals(args.intel, args.dimensionId, { minDemand: args.minDemand }));
  }
  return out;
}
