// council-review.ts — `danteforge council-review`: the mechanized /askcouncil gap-hunt. Convenes the
// multi-lens adversarial panel (council-gap-review), prints a READY / NOT_READY verdict + the DEFINED gaps,
// and records every blocking gap in the self-challenge ledger so it is owned, not lost. This is the loop we
// ran by hand to harden the autonomy engine, now a first-class command the problem-solving process and the
// ascend/crusade frontier loops can call.
//
// Each lens is reviewed by an independent LLM pass (builder-never-judges: the reviewer is not the builder).
// Fail-closed: with no provider, or on any reviewer error, the lens counts as a blocking gap — the panel is
// never "ready by silence".

import { logger } from '../../core/logger.js';
import {
  runCouncilGapReview, DEFAULT_LENSES, type CouncilLens, type LensReview, type CouncilGap,
} from '../../core/council-gap-review.js';

export interface CouncilReviewOptions {
  cwd?: string;
  json?: boolean;
  /** Continuous mode: review → record gaps → fix → re-review, until READY or --rounds. */
  loop?: boolean;
  /** Max review→fix rounds in --loop mode (default 5). */
  rounds?: number;
  /** Injection seam: replaces the per-lens LLM reviewer (tests / alternative dispatch). */
  _review?: (lens: CouncilLens) => Promise<LensReview>;
  /** Injection seam: replaces the ledger sink. */
  _recordGap?: (gap: CouncilGap) => Promise<string | null>;
  /** Injection seam: replaces the --loop fixer (tests / alternative driver). */
  _fix?: (gaps: CouncilGap[], round: number) => Promise<void>;
}

/** Pull the first JSON object out of an LLM response (handles ```json fences and surrounding prose). */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON object in reviewer response');
  return JSON.parse(body.slice(start, end + 1));
}

function toGaps(lensId: string, raw: unknown): CouncilGap[] {
  const arr = (raw as { gaps?: unknown[] })?.gaps;
  if (!Array.isArray(arr)) return [];
  return arr.map((g) => {
    const o = g as Record<string, unknown>;
    return {
      lens: lensId,
      title: String(o.title ?? 'untitled gap'),
      problem: String(o.problem ?? ''),
      evidence: String(o.evidence ?? ''),
      opportunity: String(o.opportunity ?? ''),
      blocking: o.blocking !== false, // default to blocking unless explicitly false
    };
  });
}

/** Real per-lens reviewer: one independent LLM pass per lens, asked to find blocking gaps as JSON. */
function llmLensReviewer(cwd: string): (lens: CouncilLens) => Promise<LensReview> {
  return async (lens) => {
    const { callLLM } = await import('../../core/llm.js');
    const prompt = `You are an INDEPENDENT adversarial reviewer (builder-never-judges) for this project. You did NOT build it.\n`
      + `LENS: ${lens.mandate}\n`
      + `Find concrete, DEFINED gaps that block readiness on this axis. A defined gap has a title, an observable problem, evidence, and the opportunity solving it unlocks. Do not praise.\n`
      + `Respond ONLY with JSON: {"satisfied": boolean, "gaps": [{"title","problem","evidence","opportunity","blocking"}]}. satisfied=true ONLY if there is no blocking gap.`;
    const res = await callLLM(prompt, undefined, { enrichContext: true, cwd });
    const parsed = extractJson(res) as { satisfied?: boolean };
    const gaps = toGaps(lens.id, parsed);
    const satisfied = parsed.satisfied === true && gaps.every((g) => !g.blocking);
    return { lens: lens.id, satisfied, gaps };
  };
}

/** The --loop fixer: spawn `danteforge autoforge --auto` with the blocking gaps as the goal, so each round
 *  actually attempts the fixes the council named. Provider-dependent (autoforge needs an LLM); the spawn itself
 *  is real and bounded by autoforge's own loop controls. */
function autoforgeFixer(cwd: string): (gaps: CouncilGap[], round: number) => Promise<void> {
  return async (gaps, round) => {
    const { spawn } = await import('node:child_process');
    const goal = `Address council-found gaps (round ${round}): ${gaps.map((g) => g.title).slice(0, 6).join('; ')}`;
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [process.argv[1]!, 'autoforge', goal, '--auto'], { cwd, env: process.env });
      child.stdout?.on('data', (b: Buffer) => process.stdout.write(b));
      child.stderr?.on('data', (b: Buffer) => process.stdout.write(b));
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });
  };
}

export async function councilReview(options: CouncilReviewOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const review = options._review ?? llmLensReviewer(cwd);

  // ── Continuous mode: the codified "loop until the council says READY" ──────────
  if (options.loop) {
    const { runCouncilGapLoop } = await import('../../core/council-gap-loop.js');
    const res = await runCouncilGapLoop(
      { review, fix: options._fix ?? autoforgeFixer(cwd), recordGap: options._recordGap, log: (m) => logger.info(m) },
      { maxRounds: options.rounds ?? 5, cwd },
    );
    if (options.json) { logger.info(JSON.stringify({ cleared: res.cleared, rounds: res.rounds, verdict: res.finalVerdict.verdict, recorded: res.recordedGapIds }, null, 2)); }
    else {
      logger.info(`\n  Council loop: ${res.cleared ? '🟢 READY' : '🔴 NOT cleared'} after ${res.rounds} round(s).`);
      if (!res.cleared) logger.info(`  ${res.finalVerdict.blockingGaps.length} blocking gap(s) remain — tracked in the ledger (${res.recordedGapIds.join(', ') || 'none new'}).`);
    }
    if (!res.cleared) process.exitCode = 2;
    return;
  }
  const verdict = await runCouncilGapReview({ review, log: (m) => logger.verbose(m) }, {});

  // Record every blocking gap in the ledger (deduped) — a defined problem is owned, never lost.
  const recordGap = options._recordGap ?? (async (g: CouncilGap) => {
    try {
      const { loadChallenges, addChallenge } = await import('../../core/self-challenge.js');
      const open = (await loadChallenges(cwd)).filter((c) => c.status === 'open');
      if (open.some((c) => c.title.toLowerCase() === g.title.toLowerCase())) return null;
      return (await addChallenge(cwd, { title: g.title, problem: g.problem, evidence: g.evidence, opportunity: g.opportunity })).id;
    } catch { return null; }
  });
  const recorded: string[] = [];
  for (const g of verdict.blockingGaps) { const id = await recordGap(g); if (id) recorded.push(id); }

  if (verdict.verdict !== 'READY') process.exitCode = 2;

  if (options.json) { logger.info(JSON.stringify({ verdict: verdict.verdict, blocking: verdict.blockingGaps.length, gaps: verdict.gaps, recorded }, null, 2)); return; }

  logger.info(`\n  Council verdict: ${verdict.verdict === 'READY' ? '🟢 READY' : '🔴 NOT_READY'}  (${verdict.blockingGaps.length} blocking, ${verdict.gaps.length} total gap(s))`);
  for (const r of verdict.perLens) {
    logger.info(`  • ${r.lens}: ${r.satisfied ? 'satisfied' : `${r.gaps.filter((g) => g.blocking).length} blocking`}`);
  }
  for (const g of verdict.gaps) {
    logger.info(`    ${g.blocking ? '⛔' : '○'} [${g.lens}] ${g.title} — ${g.problem}`);
  }
  if (recorded.length) logger.info(`  Recorded ${recorded.length} blocking gap(s) to the challenge ledger: ${recorded.join(', ')}`);
}
