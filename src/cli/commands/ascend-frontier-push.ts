// ascend-frontier-push.ts — the production push runners for the ascend-frontier orchestrator.
//
// Split from ascend-frontier.ts (file-size standard): the sequential one-dim depth pass
// (defaultPushTo9) and the parallel-round helpers (defaultBuildAll / defaultPromoteOne /
// defaultDiscoverMembers). The orchestrator imports these as its seam defaults; tests can
// still inject replacements through AscendFrontierOptions.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { effectiveStatus, resolveRunCommand, checkFrontierSpec, type FrontierSpec } from '../../core/frontier-spec.js';
import { loadDimRubric } from '../../core/rubric-ladder.js';
import type { CeilingCause } from '../../core/ceiling-receipt.js';
import type { AttemptFingerprint } from '../../core/evidence-novelty.js';
import type { PushOutcome } from '../../core/ascend-frontier-parallel.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';
import { runCli, parseCourtOutput, type CliResult } from './ascend-frontier-runner.js';
import { composeBuildGoal, loadCourtFeedback, parseCourtFeedback, recordCourtFeedback, repeatedObjection } from '../../core/court-feedback.js';
import { logger } from '../../core/logger.js';

const execFileAsync = promisify(execFile);

/**
 * A push runner reports the court verdict and the fingerprint of the evidence it produced.
 * `courtRan` is the honesty boundary: it is TRUE only when the frontier-review court actually
 * executed over real evidence and returned a verdict. When the build/evidence/court sub-commands
 * fail to run (crash, no evidence), `courtRan` is FALSE — and the loop must NOT record that as a
 * court rejection (which would fabricate "the court rejected N times" generator-ceiling provenance).
 */
export interface PushResult {
  verdict: 'VALIDATED' | 'REJECTED';
  courtRan: boolean;
  fingerprint: AttemptFingerprint;
  /** Present when this attempt advanced the dim's BUILD PLAN instead of convening the court
   *  (CH-014): the court only convenes on plan-complete. flipped>0 = genuine progress (the
   *  orchestrator must NOT count it as a build failure); flipped=0 = a stuck plan attempt. */
  planProgress?: { done: number; total: number; flipped: number };
  /** Present when the dim cannot honestly reach 9 yet because its frontier_spec is INCOMPLETE — the
   *  genuinely-human real-user-path fields (observed_capability / category_delta / observable artifact)
   *  are unfilled. The orchestrator writes this as an ACTIONABLE ceiling that names the exact work,
   *  distinct from a build failure (the court could not even be reached, but nothing is broken). */
  ceiling?: { cause: CeilingCause; detail: string };
}

/** Run a CLI sub-command. Returns a typed result (exit code captured + ledger-recorded);
 *  the orchestrator still re-reads state to decide progress, but a swallowed failure is now
 *  visible in the run bundle instead of being silently inferred away. */
export async function df(cwd: string, args: string[]): Promise<CliResult> {
  return runCli(cwd, args);
}

// ── Production push runner (one dim, full depth pass) ─────────────────────────────

export function specOf(dim: unknown): FrontierSpec | undefined {
  return (dim as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
}
export function competitorsOf(matrix: CompeteMatrix | null): string[] {
  const m = matrix as unknown as { competitors_closed_source?: string[]; competitors_oss?: string[] } | null;
  return [...(m?.competitors_closed_source ?? []), ...(m?.competitors_oss ?? [])];
}

/**
 * Ladder remediation for a check-failed spec: when the ONLY structural blocker is the unresearched
 * competitive bar (leader_target is ladder-seeded; with zero rubric rows the seeder no-ops and
 * observed_capability stays an unauthored sentinel), run the SAME single-dim council research,
 * then re-init (init re-seeds leader_target VERBATIM from the new ladder — the deterministic
 * anti-laundering gate is untouched) and hand back the refreshed spec for a re-check.
 * Returns null when remediation does not apply or research failed (the honest ceiling stands).
 */
/** Pure routing predicate (exported for the pin): remediation applies ONLY when the bar was never
 *  researched — zero rubric rows AND the check names the ladder-seeded field. A spec failing on
 *  artifacts/inputs/run_command is authoring work, not research work, and must NOT trigger a
 *  ~10-minute council research. */
export function isLadderBlocked(checkErrors: string[], rubricRows: number): boolean {
  return rubricRows === 0 && checkErrors.some(e => e.includes('observed_capability'));
}

export async function remediateLadderIfBlocked(
  cwd: string,
  dimId: string,
  checkErrors: string[],
  researchLadder?: (cwd: string, dimId: string) => Promise<{ ok: boolean; reason: string }>,
): Promise<FrontierSpec | null> {
  const rubric = await loadDimRubric(cwd, dimId);
  if (!isLadderBlocked(checkErrors, rubric.length)) return null;
  const research = researchLadder ?? (async (c: string, d: string) => {
    const { researchDimLadder } = await import('../../matrix/engines/ladder-research.js');
    return researchDimLadder({ cwd: c, dimId: d });
  });
  const r = await research(cwd, dimId);
  if (!r.ok) return null;
  // Re-init re-seeds the leader_target fields from the freshly researched ladder rows.
  await df(cwd, ['frontier-spec', 'init', dimId, '--write']);
  return specOf((await loadMatrix(cwd))?.dimensions.find(d => d.id === dimId)) ?? null;
}

export async function defaultPushTo9(
  cwd: string,
  dimId: string,
  deps?: { _researchLadder?: (cwd: string, dimId: string) => Promise<{ ok: boolean; reason: string }> },
): Promise<PushResult> {
  // 0. Ensure a frontier_spec EXISTS before freeze. The autonomous loop never authored one — `freeze`
  //    used to throw "has no frontier_spec", so every push misrecorded as build-failed and NO dim could
  //    ever reach the court. init auto-derives the real tracked competitor + a real-product run_command
  //    / callsite; the genuinely-human fields stay honest TODOs.
  const m0 = await loadMatrix(cwd);
  let spec0 = specOf(m0?.dimensions.find(d => d.id === dimId));
  if (!spec0) {
    await df(cwd, ['frontier-spec', 'init', dimId, '--write']);
    spec0 = specOf((await loadMatrix(cwd))?.dimensions.find(d => d.id === dimId));
  }

  // 1. Honesty guardrails, in-process so we surface the EXACT unfilled fields. A spec that still
  //    carries un-authored real-user-path fields cannot honestly reach 9.0 — record an ACTIONABLE
  //    ceiling naming the specific work, NOT a silent build-failure. This is the loop telling the
  //    truth about the frontier (the council's holy-grail "truthful build list") instead of churning.
  if (!spec0) {
    return { verdict: 'REJECTED', courtRan: false, fingerprint: { dimId, command: '', artifactPath: '', gitSha: await headSha(cwd) } };
  }
  let check = checkFrontierSpec(spec0, competitorsOf(m0), await loadDimRubric(cwd, dimId));
  if (!check.ok) {
    // Ladder remediation (the last permanently-human 8→9 step made autonomous): a row-less Score
    // Ladder means the bar was never RESEARCHED — research it, re-seed, re-check, one attempt.
    const remediated = await remediateLadderIfBlocked(cwd, dimId, check.errors, deps?._researchLadder);
    if (remediated) {
      spec0 = remediated;
      check = checkFrontierSpec(spec0, competitorsOf(await loadMatrix(cwd)), await loadDimRubric(cwd, dimId));
    }
  }
  if (!check.ok) {
    return {
      verdict: 'REJECTED', courtRan: false,
      ceiling: { cause: 'spec-incomplete',
        detail: `${dimId} is honestly held below 9.0 until its frontier_spec real-user-path is authored — ${check.errors.join(' | ')}` },
      fingerprint: { dimId, command: spec0.real_user_path.run_command, artifactPath: spec0.real_user_path.observable_artifacts[0]?.path ?? '', gitSha: await headSha(cwd) },
    };
  }

  // 2. Spec passes the guardrails → freeze it, build to it, capture evidence, convene the court.
  // The build goal carries THE BAR the judges judge against + the court's last reasons for this
  // dim (verdict→builder feedback) — every rejection becomes a course correction, never roulette.
  await df(cwd, ['frontier-spec', 'freeze', dimId, '--write']);
  const feedback = await loadCourtFeedback(cwd, dimId);
  // CH-014 BUILD PLAN: decompose the frozen bar ONCE into deterministic-gated checklist items;
  // attempts execute the next OPEN items; the expensive frontier court convenes ONLY when
  // the plan is complete. Item completion = its capability_test exits 0, never builder assertion.
  // No usable plan (no bar / malformed decomposition / audit FAIL) → legacy single-build path.
  const planMod = await import('../../core/frontier-plan.js');
  const planLog = (msg: string) => logger.info(`[frontier-plan] ${msg}`);
  let plan = await planMod.loadFrontierPlan(cwd, dimId);
  if (plan && spec0.frozen_hash && plan.barHash !== spec0.frozen_hash) {
    planLog(`${dimId}: existing plan invalidated — spec was re-frozen (barHash ${plan.barHash.slice(0, 8)} ≠ ${spec0.frozen_hash.slice(0, 8)})`);
    plan = null; // the spec was re-frozen — goalposts and plans move together or not at all
  }
  if (!plan) {
    const members = await defaultDiscoverMembers().catch((err: unknown) => {
      planLog(`${dimId}: member discovery threw (${err instanceof Error ? err.message : String(err)})`);
      return [] as CouncilMemberId[];
    });
    plan = await planMod.decomposeFrontierPlan(cwd, dimId, spec0, members as string[],
      async (memberId, prompt) => {
        const { makeAdapter, makeLease } = await import('./council.js');
        const { runAdapter } = await import('../../matrix/adapters/adapter-interface.js');
        const adapter = makeAdapter(memberId as CouncilMemberId, await makePlanConsultPacket(prompt, cwd), true);
        const r = await runAdapter(adapter, { lease: makeLease(cwd), cwd }) as { finalMessage?: string; status?: string; errorReason?: string };
        // A failed/killed consult must surface as a NAMED failure (run 3j/3k: timeout
        // tree-kills came back as completed-with-garbage and read as "unusable plan").
        if (r.status === 'failed') throw new Error(r.errorReason ?? 'adapter run failed');
        return r.finalMessage ?? '';
      }, planLog).catch((err: unknown) => {
      planLog(`${dimId}: plan decomposition THREW (${err instanceof Error ? err.message : String(err)}) — legacy path`);
      return null;
    });
  }

  if (plan) {
    await planMod.refreshPlanItems(cwd, plan); // pre-build: pick up items completed out-of-band
    if (!planMod.planComplete(plan)) {
      const items = planMod.nextItems(plan, 2);
      planLog(`${dimId}: plan ${plan.items.filter(i => i.status === 'done').length}/${plan.items.length} done — dispatching ${items.map(i => i.id).join(', ')}`);
      const itemGoal = [
        composeBuildGoal(dimId, spec0, feedback),
        ``,
        `BUILD PLAN — execute EXACTLY these next items (the rest of the plan is done or queued):`,
        ...items.map(i => `- ${i.id} ${i.title}: ${i.what}\n  DONE when this exits 0: ${i.capability_test.command}`),
        `Run each item's gate command yourself before finishing — an item is complete only when its gate passes.`,
      ].join('\n');
      for (const i of items) i.attempts += 1;
      await planMod.saveFrontierPlan(cwd, plan);
      await df(cwd, ['council-crusade', '--focus-dims', dimId, '--goal', itemGoal]);
      const { flipped } = await planMod.refreshPlanItems(cwd, plan);
      const done = plan.items.filter(i => i.status === 'done').length;
      planLog(`${dimId}: post-build refresh — ${flipped.length} item(s) flipped (${flipped.join(', ') || 'none'}), ${done}/${plan.items.length} done`);
      if (!planMod.planComplete(plan)) {
        // Plan still open: report honest progress — NOT a court attempt, NOT a build failure
        // when items genuinely flipped.
        return {
          verdict: 'REJECTED', courtRan: false,
          planProgress: { done, total: plan.items.length, flipped: flipped.length },
          fingerprint: { dimId, command: spec0.real_user_path.run_command, artifactPath: spec0.real_user_path.observable_artifacts[0]?.path ?? '', gitSha: await headSha(cwd) },
        };
      }
      // Plan just completed → fall through to evidence + court below.
    }
  } else {
    // Repeated-objection tripwire (council lever 3) — LEGACY path only: the last TWO courts
    // raised the same core objection, so another blind single-build is guaranteed waste. A
    // plan IS this tripwire's named remedy — when one exists above, we execute it instead of
    // stopping (the original ordering had the tripwire BEFORE decomposition, permanently
    // deadlocking exactly the dims whose repeated rejections most needed a plan).
    if (repeatedObjection(feedback)) {
      return {
        verdict: 'REJECTED', courtRan: false,
        ceiling: { cause: 'court-rejected' as CeilingCause,
          detail: `${dimId}: the frontier court raised the SAME objection in consecutive attempts ("${(feedback!.dissent[0] ?? feedback!.summary).slice(0, 200)}…") — further blind builds cannot fix this; upgrade the evidence design (real_user_path run_command/artifacts must actually exercise the 9-row) or fix plan decomposition (no plan could be installed for this dim — see [frontier-plan] log lines), then re-push.` },
        fingerprint: { dimId, command: spec0.real_user_path.run_command, artifactPath: spec0.real_user_path.observable_artifacts[0]?.path ?? '', gitSha: await headSha(cwd) },
      };
    }
    const buildGoal = composeBuildGoal(dimId, spec0, feedback);
    await df(cwd, ['council-crusade', '--focus-dims', dimId, '--goal', buildGoal]);
  }

  const specBefore = (await loadMatrix(cwd))?.dimensions.find(d => d.id === dimId);
  spec0 = specOf(specBefore);
  let evidenceOk = false;
  if (spec0) {
    const callsite = spec0.real_user_path.required_callsite;
    const artifact = spec0.real_user_path.observable_artifacts[0]?.path ?? '';
    // Run enough sessions to satisfy BOTH receipt requirements at once: >=min_distinct_sessions
    // distinct process-sessions AND >=min_t5_plus_outcomes total T5+ receipts (each session-record
    // appends exactly one). Looping only over min_distinct_sessions produced too few outcomes to
    // satisfy the T7 multi-receipt consensus. (Codex finding.)
    const sessions = Math.max(2, spec0.required_receipts.min_distinct_sessions, spec0.required_receipts.min_t5_plus_outcomes);
    let okSessions = 0;
    for (let s = 0; s < sessions; s++) {
      // Each session runs a DIFFERENT realistic input (variant rotation) so one prepared fixture
      // cannot satisfy the whole multi-session proof — the anti-circular defense.
      const cmd = resolveRunCommand(spec0, s);
      const rec = await df(cwd, ['session-record', dimId, '--run', cmd, '--callsite', callsite, '--artifact', artifact, '--write']);
      // --preserve-sessions (forceCold=FALSE): run ONLY the newly-recorded outcome (no cache yet) and
      // serve every prior session's evidence from cache UNCHANGED, so each session keeps its own
      // session_id. validate DEFAULTS to forceCold=TRUE, which re-runs EVERY outcome and re-stamps them
      // all with the LAST process's session_id — collapsing the multi-session proof to ONE distinct
      // session, which derived-score structurally vetoes at T7. That default is what made autonomous
      // 9.0 unreachable; --preserve-sessions is what produces the >=2 distinct sessions the frontier needs.
      const val = await df(cwd, ['validate', dimId, '--preserve-sessions']);
      if (rec.ok && val.ok) okSessions++;
    }
    // Require ALL required distinct sessions to succeed — not just one. A single passing session is
    // NOT enough evidence to convene the court (it would violate min_distinct_sessions); treat a
    // partial run as a build failure, not a court attempt. (Council/Codex: evidenceOk was too permissive.)
    evidenceOk = okSessions >= sessions;
  }

  // The honesty boundary: the court only "ran" if there's a frozen spec, the evidence pipeline
  // actually produced something (rec+val exit 0), AND frontier-review emitted a complete verdict.
  // NOTE (live pilot finding): frontier-review exits 1 on an honest REJECTED by design, so the
  // exit code alone cannot distinguish "court rejected" from "court crashed" — parse the --json
  // verdict (parseCourtOutput) exactly like the parallel path. A crash/no-JSON stays a failed
  // build (courtRan=false); a clean REJECTED is a real court attempt and feeds the ledger.
  let courtRan = false;
  let verdict: PushResult['verdict'] = 'REJECTED';
  if (spec0 && evidenceOk) {
    const review = await runCli(cwd, ['frontier-review', dimId, '--write', '--json']);
    const parsed = parseCourtOutput(review);
    if (!parsed.parseError) {
      courtRan = true;
      // VALIDATED is confirmed against the PERSISTED spec status (the stronger source — the
      // verdict only counts if --write actually landed it on disk).
      const matrix = await loadMatrix(cwd);
      const dim = matrix?.dimensions.find(d => d.id === dimId);
      const spec = (dim as unknown as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
      verdict = spec && effectiveStatus(spec) === 'validated' ? 'VALIDATED' : 'REJECTED';
      // Persist the judges' reasons so the NEXT attempt's build goal addresses them verbatim
      // (best-effort: feedback failing to record must never fail a court that ran).
      await recordCourtFeedback(cwd, parseCourtFeedback(review.stdout, dimId, verdict)).catch(() => { /* best-effort */ });
    }
  }

  let gitSha: string | null = null;
  try { gitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim(); } catch { /* none */ }
  return {
    verdict, courtRan,
    fingerprint: {
      dimId,
      command: spec0?.real_user_path.run_command ?? '',
      artifactPath: spec0?.real_user_path.observable_artifacts[0]?.path ?? '',
      gitSha,
    },
  };
}

// ── Parallel production helpers ──────────────────────────────────────────────────

export async function headSha(cwd: string): Promise<string | null> {
  try { return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim(); } catch { return null; }
}

export async function defaultDiscoverMembers(): Promise<CouncilMemberId[]> {
  const { discoverCouncil } = await import('./council.js');
  return (await discoverCouncil()).filter(m => m.available).map(m => m.id as CouncilMemberId);
}

/** Build the work packet for a plan decomposition/audit consultation. dimensionId MUST be
 *  'council-consultation': every adapter's judge prompt builder passes consultation objectives
 *  through RAW; anything else gets wrapped in code-reviewer VERDICT boilerplate — run 3j's
 *  decomposer answered as a judge (~345-char verdict, no JSON plan) for exactly this reason. */
export async function makePlanConsultPacket(prompt: string, cwd: string): Promise<import('../../matrix/types/work-graph.js').WorkPacket> {
  const { makeWorkPacket } = await import('./council.js');
  const packet = makeWorkPacket(prompt, cwd);
  (packet as unknown as { dimensionId: string }).dimensionId = 'council-consultation';
  return packet;
}

/** CONCURRENT build: freeze each dim's spec, then council --parallel builds them in isolated
 *  worktrees with the cross-member merge court, merging approved work to main. */
export async function defaultBuildAll(cwd: string, assignments: { memberId: CouncilMemberId; dimId: string }[], members: CouncilMemberId[]): Promise<void> {
  const dims = assignments.map(a => a.dimId);
  // init BEFORE freeze (same missing-init root cause as the sequential path): freeze throws on a dim
  // with no spec. init is a no-op when a spec already exists. (Parallel promote still runs the court
  // even on an incomplete spec — a noted follow-up; the court honestly rejects an unvalidated spec.)
  for (const d of dims) { await df(cwd, ['frontier-spec', 'init', d, '--write']); await df(cwd, ['frontier-spec', 'freeze', d, '--write']); }
  if (members.length >= 2) {
    await df(cwd, ['council', '--parallel', '--members', members.join(','), '--focus-dims', dims.join(','), '--rounds', '1']);
  } else {
    for (const a of assignments) await df(cwd, ['council-crusade', '--focus-dims', a.dimId, '--goal', `Close frontier_spec for ${a.dimId}`]);
  }
}

/** SERIAL promote of one dim: capture real-user-path evidence (variant-rotated), validate across
 *  sessions, then run the court with the assigned owner EXCLUDED (builder-never-judges). Writes
 *  matrix.json — runParallelRound guarantees this runs one dim at a time, so no write races. */
export async function defaultPromoteOne(cwd: string, a: { memberId: CouncilMemberId; dimId: string }): Promise<PushOutcome> {
  // Mirror the sequential push's honesty guardrails (the parallel path used to skip them, so an
  // incomplete spec churned through evidence capture instead of emitting the ACTIONABLE
  // spec-incomplete ceiling): ensure a spec exists, then check it in-process before any evidence run.
  const m0 = await loadMatrix(cwd);
  let spec0 = specOf(m0?.dimensions.find(d => d.id === a.dimId));
  if (!spec0) {
    await df(cwd, ['frontier-spec', 'init', a.dimId, '--write']);
    spec0 = specOf((await loadMatrix(cwd))?.dimensions.find(d => d.id === a.dimId));
  }
  if (!spec0) {
    return { dimId: a.dimId, builderId: a.memberId, verdict: 'REJECTED', passedByJudges: [], courtRan: false };
  }
  let check = checkFrontierSpec(spec0, competitorsOf(m0), await loadDimRubric(cwd, a.dimId));
  if (!check.ok) {
    // Same ladder remediation as the sequential push (parity — the parallel path must never be
    // the weaker honesty boundary). runParallelRound serializes promoteOne, so no research races.
    const remediated = await remediateLadderIfBlocked(cwd, a.dimId, check.errors);
    if (remediated) {
      spec0 = remediated;
      check = checkFrontierSpec(spec0, competitorsOf(await loadMatrix(cwd)), await loadDimRubric(cwd, a.dimId));
    }
  }
  if (!check.ok) {
    return {
      dimId: a.dimId, builderId: a.memberId, verdict: 'REJECTED', passedByJudges: [], courtRan: false,
      ceiling: { cause: 'spec-incomplete',
        detail: `${a.dimId} is honestly held below 9.0 until its frontier_spec real-user-path is authored — ${check.errors.join(' | ')}` },
    };
  }
  let evidenceOk = false;
  {
    const callsite = spec0.real_user_path.required_callsite;
    const artifact = spec0.real_user_path.observable_artifacts[0]?.path ?? '';
    const sessions = Math.max(2, spec0.required_receipts.min_distinct_sessions, spec0.required_receipts.min_t5_plus_outcomes);
    let okSessions = 0;
    for (let s = 0; s < sessions; s++) {
      const rec = await df(cwd, ['session-record', a.dimId, '--run', resolveRunCommand(spec0, s), '--callsite', callsite, '--artifact', artifact, '--write']);
      // --preserve-sessions (see defaultPushTo9): validate defaults to forceCold=TRUE which collapses
      // the per-session session_ids into one; --preserve-sessions serves cache and keeps them distinct.
      const val = await df(cwd, ['validate', a.dimId, '--preserve-sessions']);
      if (rec.ok && val.ok) okSessions++;
    }
    evidenceOk = okSessions >= sessions;
  }
  // Hard-block the court on incomplete evidence: convening judges on a failed/partial evidence run
  // would let the court "VALIDATE" a dim whose receipts don't actually back it. Not all sessions
  // captured → BUILD failure (courtRan:false), never a court rejection.
  if (!evidenceOk) {
    return { dimId: a.dimId, builderId: a.memberId, verdict: 'REJECTED', passedByJudges: [], courtRan: false };
  }
  // Distinguish a real court REJECT from "we couldn't read the court's answer" (non-zero exit or
  // no JSON): parseCourtOutput flags the latter so the orchestrator records uncertainty, not a clean no.
  const res = await runCli(cwd, ['frontier-review', a.dimId, '--builder', a.memberId, '--min-judges', '2', '--json', '--write']);
  const parsed = parseCourtOutput(res);
  return {
    dimId: a.dimId, builderId: a.memberId,
    verdict: parsed.verdict, passedByJudges: parsed.passedByJudges as CouncilMemberId[],
    courtRan: !parsed.parseError,
    ...(parsed.parseError ? { parseError: true } : {}),
  };
}
