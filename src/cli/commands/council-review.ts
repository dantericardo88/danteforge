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
  /** Provider the reviewer runs on — MUST differ from the builder/default provider to satisfy
   *  builder-never-judges. Without a distinct reviewer, the panel cannot certify READY. */
  reviewerProvider?: string;
  /** Extra lenses as "id:mandate" — extend the panel beyond the 3 defaults for domain-specific gaps. */
  lenses?: { id: string; mandate: string }[];
  /** Report-only: record gaps + print the verdict but do NOT mutate process.exitCode (used by ascend's gate
   *  so a converged run is not marked failed merely because the council found a follow-up gap). */
  reportOnly?: boolean;
  /** Injection seam: replaces the per-lens LLM reviewer (tests / alternative dispatch). */
  _review?: (lens: CouncilLens) => Promise<LensReview>;
  /** Injection seam: replaces the ledger sink. */
  _recordGap?: (gap: CouncilGap) => Promise<string | null>;
  /** Injection seam: replaces the --loop fixer (tests / alternative driver). */
  _fix?: (gaps: CouncilGap[], round: number) => Promise<void>;
  /** Test seam: force the non-independent path (builder-never-judges enforcement) with an injected reviewer. */
  _forceNonIndependent?: boolean;
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
    // Backfill empty fields with defensible defaults: addChallenge rejects fields < 8 chars, and a silently
    // dropped gap would violate the "a defined problem is never lost" guarantee. Better a flagged-incomplete
    // entry than no entry.
    const nonEmpty = (v: unknown, fallback: string): string => { const s = String(v ?? '').trim(); return s.length >= 8 ? s : fallback; };
    return {
      lens: lensId,
      title: nonEmpty(o.title, `${lensId} gap (reviewer omitted title)`),
      problem: nonEmpty(o.problem, `${lensId} reviewer flagged a gap without a stated problem`),
      evidence: nonEmpty(o.evidence, 'reviewer omitted evidence — re-review to substantiate'),
      opportunity: nonEmpty(o.opportunity, 'define and close this gap to restore readiness'),
      blocking: o.blocking !== false, // default to blocking unless explicitly false
    };
  });
}

/** Real per-lens reviewer: one independent LLM pass per lens, asked to find blocking gaps as JSON. */
function llmLensReviewer(cwd: string, reviewerProvider: string): (lens: CouncilLens) => Promise<LensReview> {
  return async (lens) => {
    const { callLLM } = await import('../../core/llm.js');
    const prompt = `You are an INDEPENDENT adversarial reviewer (builder-never-judges) for this project. You did NOT build it.\n`
      + `LENS: ${lens.mandate}\n`
      + `Find concrete, DEFINED gaps that block readiness on this axis. A defined gap has a title, an observable problem, evidence, and the opportunity solving it unlocks. Do not praise.\n`
      + `Respond ONLY with JSON: {"satisfied": boolean, "gaps": [{"title","problem","evidence","opportunity","blocking"}]}. satisfied=true ONLY if there is no blocking gap.`;
    // Reviewer runs on a provider DISTINCT from the builder — builder-never-judges is structural, not a prompt.
    const res = await callLLM(prompt, reviewerProvider as Parameters<typeof callLLM>[1], { enrichContext: true, cwd });
    const parsed = extractJson(res) as { satisfied?: boolean };
    const gaps = toGaps(lens.id, parsed);
    const satisfied = parsed.satisfied === true && gaps.every((g) => !g.blocking);
    return { lens: lens.id, satisfied, gaps };
  };
}

/** The independence gap emitted when no reviewer distinct from the builder is available — a READY cannot be
 *  honestly issued without builder-never-judges, so this forces NOT_READY. */
function independenceGap(builder: string, reviewer: string | undefined): LensReview {
  return {
    lens: 'independence',
    satisfied: false,
    gaps: [{
      lens: 'independence',
      title: 'no independent reviewer (builder-never-judges not satisfied)',
      problem: `the reviewer provider (${reviewer ?? 'default=' + builder}) is not distinct from the builder provider (${builder}); a model cannot independently judge its own work`,
      evidence: 'council-review resolved no reviewer provider distinct from the configured/build provider',
      opportunity: 'pass --reviewer <a different provider> so an independent panel can certify readiness',
      blocking: true,
    }],
  };
}

/** Resolve the reviewer + whether it is INDEPENDENT of the builder. An injected reviewer is the caller's
 *  responsibility (independent=true). Otherwise independence holds only when --reviewer names a provider
 *  distinct from the builder/default provider. The review still RUNS when not independent (gaps are useful) —
 *  but the caller forces NOT_READY + appends the independence gap so a non-independent panel can never certify. */
async function resolveReviewer(
  options: CouncilReviewOptions, cwd: string,
): Promise<{ review: (l: CouncilLens) => Promise<LensReview>; independent: boolean; builder: string; reviewer?: string }> {
  if (options._review) return { review: options._review, independent: true, builder: 'injected' };
  let builder = 'unknown';
  try { builder = (await (await import('../../core/config.js')).resolveProvider()).provider; } catch { builder = 'unknown'; }
  const reviewer = options.reviewerProvider;
  const independent = !!reviewer && reviewer !== builder;
  return { review: llmLensReviewer(cwd, reviewer ?? builder), independent, builder, reviewer };
}

/** The --loop fixer: spawn `danteforge magic "<gaps>"` — `magic [goal]` is the goal-driven hero command (forge
 *  takes a PHASE, and autoforge's positional goal is advisory-only; magic actually builds toward the goal). So
 *  each round genuinely attempts the fixes the council named. The no-progress breaker stops the loop if the
 *  blocking-gap set doesn't move, so a fixer that can't act never burns the full round budget. */
function goalFixer(cwd: string): (gaps: CouncilGap[], round: number) => Promise<void> {
  return async (gaps) => {
    const { spawn } = await import('node:child_process');
    const goal = 'Address these council-found gaps:\n'
      + gaps.slice(0, 6).map((g) => `- ${g.title}: ${g.problem} (outcome: ${g.opportunity})`).join('\n');
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [process.argv[1]!, 'magic', goal], { cwd, env: process.env });
      child.stdout?.on('data', (b: Buffer) => process.stdout.write(b));
      child.stderr?.on('data', (b: Buffer) => process.stdout.write(b));
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });
  };
}

/** Default ledger sink: record a blocking gap as an open challenge, skipping if an open one shares its title. */
function defaultLedgerRecorder(cwd: string): (g: CouncilGap) => Promise<string | null> {
  return async (g) => {
    try {
      const { loadChallenges, addChallenge } = await import('../../core/self-challenge.js');
      const open = (await loadChallenges(cwd)).filter((c) => c.status === 'open');
      if (open.some((c) => c.title.toLowerCase() === g.title.toLowerCase())) return null;
      return (await addChallenge(cwd, { title: g.title, problem: g.problem, evidence: g.evidence, opportunity: g.opportunity })).id;
    } catch { return null; }
  };
}

async function recordAndReport(
  verdict: Awaited<ReturnType<typeof runCouncilGapReview>>, options: CouncilReviewOptions,
  recordGap: (g: CouncilGap) => Promise<string | null>,
): Promise<void> {
  const recorded: string[] = [];
  for (const g of verdict.blockingGaps) { const id = await recordGap(g); if (id) recorded.push(id); }
  if (verdict.verdict !== 'READY' && !options.reportOnly) process.exitCode = 2;
  if (options.json) { logger.info(JSON.stringify({ verdict: verdict.verdict, blocking: verdict.blockingGaps.length, gaps: verdict.gaps, recorded }, null, 2)); return; }
  logger.info(`\n  Council verdict: ${verdict.verdict === 'READY' ? '🟢 READY' : '🔴 NOT_READY'}  (${verdict.blockingGaps.length} blocking, ${verdict.gaps.length} total gap(s))`);
  for (const r of verdict.perLens) logger.info(`  • ${r.lens}: ${r.satisfied ? 'satisfied' : `${r.gaps.filter((g) => g.blocking).length} blocking`}`);
  for (const g of verdict.gaps) logger.info(`    ${g.blocking ? '⛔' : '○'} [${g.lens}] ${g.title} — ${g.problem}`);
  if (recorded.length) logger.info(`  Recorded ${recorded.length} blocking gap(s) to the challenge ledger: ${recorded.join(', ')}`);
}

export async function councilReview(options: CouncilReviewOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const reviewConfig = options.lenses && options.lenses.length ? { lenses: options.lenses } : {};
  const recordGap = options._recordGap ?? defaultLedgerRecorder(cwd);

  const resolved = await resolveReviewer(options, cwd);
  const review = resolved.review;
  const independent = options._forceNonIndependent ? false : resolved.independent;
  const { builder, reviewer } = resolved;

  // builder-never-judges: a non-independent panel still surfaces gaps (useful) but can NEVER certify READY —
  // append the independence gap and force NOT_READY. (Looping a non-independent reviewer can't certify either,
  // so we skip --loop in that case.)
  if (!independent) {
    logger.warn('[council] reviewer is NOT independent of the builder — verdict cannot be READY. Pass --reviewer <a distinct provider> to certify.');
    const base = await runCouncilGapReview({ review, log: (m) => logger.verbose(m) }, reviewConfig)
      .catch(() => ({ verdict: 'NOT_READY' as const, gaps: [], blockingGaps: [], perLens: [] }));
    const indep = independenceGap(builder, reviewer);
    await recordAndReport({
      verdict: 'NOT_READY', gaps: [...base.gaps, ...indep.gaps], blockingGaps: [...base.blockingGaps, ...indep.gaps], perLens: [...base.perLens, indep],
    }, options, recordGap);
    return;
  }

  // ── Continuous mode: the codified "loop until the council says READY" ──────────
  if (options.loop) {
    const { runCouncilGapLoop } = await import('../../core/council-gap-loop.js');
    const res = await runCouncilGapLoop(
      { review, fix: options._fix ?? goalFixer(cwd), recordGap, log: (m) => logger.info(m) },
      { maxRounds: options.rounds ?? 5, cwd, ...reviewConfig },
    );
    if (options.json) { logger.info(JSON.stringify({ cleared: res.cleared, rounds: res.rounds, verdict: res.finalVerdict.verdict, recorded: res.recordedGapIds }, null, 2)); }
    else {
      logger.info(`\n  Council loop: ${res.cleared ? '🟢 READY' : '🔴 NOT cleared'} after ${res.rounds} round(s).`);
      if (!res.cleared) logger.info(`  ${res.finalVerdict.blockingGaps.length} blocking gap(s) remain — tracked in the ledger (${res.recordedGapIds.join(', ') || 'none new'}).`);
    }
    if (!res.cleared && !options.reportOnly) process.exitCode = 2;
    return;
  }

  const verdict = await runCouncilGapReview({ review, log: (m) => logger.verbose(m) }, reviewConfig);
  await recordAndReport(verdict, options, recordGap);
}
