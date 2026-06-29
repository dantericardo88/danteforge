// council-gap-loop.ts — the codified "loop until the council says READY" cycle. This is exactly the process we
// ran by hand to harden the autonomy engine, now a reusable primitive: REVIEW (adversarial gap-hunt) → if
// NOT_READY, RECORD every blocking gap in the challenge ledger (a DEFINED problem is never lost) → FIX → REVIEW
// again → repeat until READY or the round budget is spent. It is the loop gate that ascend/crusade can run to
// push toward the frontier with builder-never-judges discipline instead of self-certification.
//
// All side effects are injected (review / fix / recordGap), so the control flow is fully unit-testable. The
// default recordGap writes to the real self-challenge ledger (deduped against open entries by title).

import {
  runCouncilGapReview, type CouncilGap, type CouncilGapVerdict,
  type CouncilGapReviewDeps, type CouncilGapReviewConfig,
} from './council-gap-review.js';

export interface CouncilGapLoopDeps extends CouncilGapReviewDeps {
  /** Apply fixes for this round's blocking gaps. Real driver: magic/forge/agents. Tests: an injected double. */
  fix: (gaps: CouncilGap[], round: number) => Promise<void>;
  /** Record a discovered gap in the ledger; returns its id (or null if skipped/duplicate). Default: addChallenge. */
  recordGap?: (gap: CouncilGap) => Promise<string | null>;
}

export interface CouncilGapLoopConfig extends CouncilGapReviewConfig {
  /** Max review→fix rounds before stopping un-cleared (never loops forever). Default 5. */
  maxRounds?: number;
  cwd?: string;
}

export interface CouncilGapLoopResult {
  cleared: boolean;
  rounds: number;
  finalVerdict: CouncilGapVerdict;
  /** Challenge-ledger ids recorded for the gaps found across all rounds. */
  recordedGapIds: string[];
}

/** Default ledger sink: record the gap as an open challenge, skipping if an open one with the same title exists. */
async function defaultRecordGap(cwd: string, gap: CouncilGap): Promise<string | null> {
  try {
    const { loadChallenges, addChallenge } = await import('./self-challenge.js');
    const open = (await loadChallenges(cwd)).filter((c) => c.status === 'open');
    if (open.some((c) => c.title.toLowerCase() === gap.title.toLowerCase())) return null; // already tracked
    const c = await addChallenge(cwd, { title: gap.title, problem: gap.problem, evidence: gap.evidence, opportunity: gap.opportunity });
    return c.id;
  } catch {
    return null; // best-effort — a ledger write must never crash the loop
  }
}

/**
 * Run the council-gated loop. Returns cleared=true the first round the panel returns READY; otherwise records
 * the round's blocking gaps in the ledger, runs the fixer, and re-reviews — up to maxRounds. Deterministic
 * given deterministic deps.
 */
export async function runCouncilGapLoop(
  deps: CouncilGapLoopDeps, config: CouncilGapLoopConfig = {},
): Promise<CouncilGapLoopResult> {
  const log = deps.log ?? (() => {});
  const maxRounds = Math.max(1, config.maxRounds ?? 5);
  const cwd = config.cwd ?? process.cwd();
  const recordGap = deps.recordGap ?? ((g: CouncilGap) => defaultRecordGap(cwd, g));
  const recordedGapIds: string[] = [];
  let finalVerdict: CouncilGapVerdict = { verdict: 'NOT_READY', gaps: [], blockingGaps: [], perLens: [] };
  const gapKey = (v: CouncilGapVerdict) => v.blockingGaps.map((g) => `${g.title}::${g.problem}`.toLowerCase()).sort().join('|');
  let prevKey = '';
  let stall = 0;
  const MAX_STALL = 2; // tolerate one "fix still landing" round; stop after 2 consecutive no-progress rounds

  for (let round = 1; round <= maxRounds; round++) {
    log(`[council-loop] round ${round}/${maxRounds}: convening the panel…`);
    finalVerdict = await runCouncilGapReview(deps, config);
    if (finalVerdict.verdict === 'READY') {
      log(`[council-loop] READY after ${round} round(s) — the council cleared it.`);
      return { cleared: true, rounds: round, finalVerdict, recordedGapIds };
    }
    // No-progress breaker: if the blocking-gap set is unchanged for MAX_STALL consecutive rounds, the fixer
    // isn't moving the needle — stop burning provider budget re-discovering the same gaps (still tracked).
    const key = gapKey(finalVerdict);
    if (round > 1 && key === prevKey) {
      if (++stall >= MAX_STALL) {
        log(`[council-loop] no progress for ${stall} rounds (same ${finalVerdict.blockingGaps.length} blocking gap(s)) — stopping early; gaps remain tracked.`);
        return { cleared: false, rounds: round, finalVerdict, recordedGapIds };
      }
    } else {
      stall = 0;
    }
    prevKey = key;
    // Never lose a defined problem: record each blocking gap before attempting a fix.
    for (const g of finalVerdict.blockingGaps) {
      const id = await recordGap(g);
      if (id) recordedGapIds.push(id);
    }
    log(`[council-loop] round ${round}: ${finalVerdict.blockingGaps.length} blocking gap(s) — recorded ${recordedGapIds.length} to ledger; applying fixes…`);
    await deps.fix(finalVerdict.blockingGaps, round);
  }

  log(`[council-loop] NOT cleared after ${maxRounds} round(s) — ${finalVerdict.blockingGaps.length} blocking gap(s) remain (tracked in the ledger).`);
  return { cleared: false, rounds: maxRounds, finalVerdict, recordedGapIds };
}
