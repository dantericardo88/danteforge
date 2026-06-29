// council-gap-review.ts — codifies the adversarial GAP-HUNT council as a first-class primitive. This is the
// loop we ran by hand to get the autonomy engine ready: convene N INDEPENDENT reviewers, each with a DISTINCT
// adversarial lens (builder-never-judges), each tasked to FIND THE HOLES that block readiness — not to score —
// and aggregate to a single READY / NOT_READY verdict plus a DEFINED gap worklist. It is the Self-Challenge
// Doctrine ("always look for the gaps... a DEFINED problem is a solvable one") mechanized.
//
// Pure orchestration: the per-lens reviewer is INJECTED, so the panel is provider-agnostic and unit-testable.
// Fail-closed: a reviewer that errors or abstains counts as NOT satisfied (an unproven lens is a blocking gap),
// so the panel can never be "ready by silence".

/** One adversarial perspective the panel reviews from. The mandate is the brief the reviewer is held to. */
export interface CouncilLens {
  id: string;
  mandate: string;
}

/** The default panel — the three lenses that found the real holes in the autonomy work. */
export const DEFAULT_LENSES: readonly CouncilLens[] = [
  { id: 'correctness', mandate: 'Find where the change is logically wrong, or where "wired" does not equal "works".' },
  { id: 'runtime-reliability', mandate: 'Find where an unattended run could burn cycles, stall, freeze, double-run, or corrupt state.' },
  { id: 'scoring-honesty', mandate: 'Find any path where the loop could claim done / a score WITHOUT a measured receipt proving it.' },
];

/** A DEFINED gap (matches the challenge-ledger shape so it can be recorded verbatim). */
export interface CouncilGap {
  lens: string;
  title: string;
  problem: string;
  evidence: string;
  opportunity: string;
  /** A blocking gap forces NOT_READY; a non-blocking gap is a recommended follow-up. */
  blocking: boolean;
}

export interface LensReview {
  lens: string;
  /** True only if this lens found NO blocking gap (the reviewer is satisfied readiness holds on this axis). */
  satisfied: boolean;
  gaps: CouncilGap[];
}

export interface CouncilGapVerdict {
  verdict: 'READY' | 'NOT_READY';
  /** All gaps, deduped across lenses. */
  gaps: CouncilGap[];
  blockingGaps: CouncilGap[];
  perLens: LensReview[];
}

export interface CouncilGapReviewDeps {
  /** Dispatch ONE independent reviewer for a lens (builder-never-judges — the reviewer is not the builder).
   *  Real driver: a council adapter / sub-agent. Tests: a fake. */
  review: (lens: CouncilLens) => Promise<LensReview>;
  log?: (msg: string) => void;
}

export interface CouncilGapReviewConfig {
  lenses?: readonly CouncilLens[];
}

function failClosedReview(lensId: string, detail: string): LensReview {
  return {
    lens: lensId,
    satisfied: false,
    gaps: [{
      lens: lensId,
      title: `${lensId} review did not complete`,
      problem: `the ${lensId} reviewer errored or abstained, so this axis is unverified`,
      evidence: detail,
      opportunity: 're-run the review once a reviewer is available so this axis is actually checked',
      blocking: true,
    }],
  };
}

/**
 * Convene the panel and return the aggregate verdict. READY iff EVERY lens is satisfied and there are no
 * blocking gaps. Gaps are deduped by (title, problem). Deterministic given a deterministic reviewer.
 */
export async function runCouncilGapReview(
  deps: CouncilGapReviewDeps, config: CouncilGapReviewConfig = {},
): Promise<CouncilGapVerdict> {
  const log = deps.log ?? (() => {});
  const lenses = config.lenses ?? DEFAULT_LENSES;

  const perLens = await Promise.all(lenses.map(async (l) => {
    try {
      const r = await deps.review(l);
      log(`[council] lens ${l.id}: ${r.satisfied ? 'satisfied' : `${r.gaps.filter(g => g.blocking).length} blocking gap(s)`}`);
      return r;
    } catch (e) {
      log(`[council] lens ${l.id}: reviewer FAILED — counted as a blocking gap (fail-closed)`);
      return failClosedReview(l.id, e instanceof Error ? e.message : String(e));
    }
  }));

  const seen = new Set<string>();
  const gaps: CouncilGap[] = [];
  for (const r of perLens) {
    for (const g of r.gaps) {
      const key = `${g.title}::${g.problem}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      gaps.push(g);
    }
  }
  const blockingGaps = gaps.filter((g) => g.blocking);
  const verdict: 'READY' | 'NOT_READY' = blockingGaps.length === 0 && perLens.every((r) => r.satisfied) ? 'READY' : 'NOT_READY';
  log(`[council] verdict: ${verdict} (${blockingGaps.length} blocking, ${gaps.length} total gap(s) across ${lenses.length} lens(es))`);
  return { verdict, gaps, blockingGaps, perLens };
}
