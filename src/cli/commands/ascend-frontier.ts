// ascend-frontier.ts — the unattended autonomous frontier orchestrator (M2).
//
//   danteforge ascend-frontier [--dry-run] [--max-cycles N] [--max-attempts N]
//
// Chains the whole campaign with NO interactive prompts: Phase A (define) → Phase B (build-to-7) →
// Phase C (push each dim to a court-validated 9.0, one at a time). It loops planNextAction →
// dispatch → re-read state until every dim is at the validated frontier OR carries an honest
// ceiling. Anti-grind: the evidence-novelty ledger (a push that changed nothing real is ceilinged
// immediately) plus a global --max-cycles stop. The heavy phase work is delegated to existing
// commands (crusade/council-crusade/session-record/validate/frontier-review); all are seam-injectable.

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { effectiveDimScore } from '../../core/compete-matrix-score.js';
import { effectiveStatus, resolveRunCommand, type FrontierSpec } from '../../core/frontier-spec.js';
import { loadCeilingReceipt, writeCeilingReceipt } from '../../core/ceiling-receipt.js';
import { loadAttemptLedger, recordAttempt, isNovelAttempt, type AttemptFingerprint } from '../../core/evidence-novelty.js';
import { planNextAction, type DimState, type AscendAction } from '../../core/ascend-frontier-engine.js';
import { assignRound, runParallelRound, type PushOutcome } from '../../core/ascend-frontier-parallel.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';
import { RunLedger } from '../../core/run-ledger.js';
import { runCli, parseCourtOutput, setActiveLedger, type CliResult } from './ascend-frontier-runner.js';

const execFileAsync = promisify(execFile);
const MARKET_DIMS = new Set(['community_adoption', 'enterprise_readiness']);

/**
 * A push runner reports the court verdict and the fingerprint of the evidence it produced.
 * `courtRan` is the honesty boundary: it is TRUE only when the frontier-review court actually
 * executed over real evidence and returned a verdict. When the build/evidence/court sub-commands
 * fail to run (crash, no evidence), `courtRan` is FALSE — and the loop must NOT record that as a
 * court rejection (which would fabricate "the court rejected N times" generator-ceiling provenance).
 */
export interface PushResult { verdict: 'VALIDATED' | 'REJECTED'; courtRan: boolean; fingerprint: AttemptFingerprint; }

export interface AscendFrontierOptions {
  cwd?: string;
  dryRun?: boolean;
  /** Parallel fan-out: each live council member owns a different dim and pushes concurrently. */
  parallel?: boolean;
  maxCycles?: number;
  maxAttemptsPerDim?: number;
  /** No-progress setup/build cycles before a stuck dim is ceilinged (default = maxAttemptsPerDim). */
  maxBuildAttempts?: number;
  json?: boolean;
  // Seams (production defaults shell out to the real commands).
  _buildState?: (cwd: string) => Promise<DimState[]>;
  _runSetup?: (cwd: string, dims: string[]) => Promise<void>;
  _runBuildTo7?: (cwd: string, dims: string[]) => Promise<void>;
  _runPushTo9?: (cwd: string, dimId: string) => Promise<PushResult>;
  /** Parallel mode: discover live council members. */
  _discoverMembers?: () => Promise<CouncilMemberId[]>;
  /** Parallel mode: concurrent worktree-isolated build of the round's dims, merged to main. */
  _buildAll?: (cwd: string, assignments: { memberId: CouncilMemberId; dimId: string }[]) => Promise<void>;
  /** Parallel mode: SERIAL promote of one dim — capture evidence + run the court. */
  _promoteOne?: (cwd: string, a: { memberId: CouncilMemberId; dimId: string }) => Promise<PushOutcome>;
  _now?: () => string;
}

export interface AscendFrontierResult {
  terminal: 'done' | 'stalled' | 'max-cycles' | 'dry-run' | 'failed';
  cycles: number;
  actions: string[];
  summary: string;
  /** The run-ledger id (.danteforge/runs/<runId>/) — present for any run that executed ≥1 cycle. */
  runId?: string;
}

// ── Production state builder ────────────────────────────────────────────────────

async function defaultBuildState(cwd: string): Promise<DimState[]> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found. (Phase A define has not run.)');
  const ledger = await loadAttemptLedger(cwd);
  const out: DimState[] = [];
  for (const dim of matrix.dimensions) {
    const spec = (dim as unknown as { frontier_spec?: FrontierSpec }).frontier_spec;
    const ceiling = await loadCeilingReceipt(cwd, dim.id);
    const d = dim as unknown as { capability_test?: unknown; outcomes?: unknown[] };
    out.push({
      id: dim.id,
      effectiveScore: effectiveDimScore(dim as Parameters<typeof effectiveDimScore>[0]),
      frontierStatus: spec ? effectiveStatus(spec) : 'none',
      ceiling,
      attempts: ledger.filter(a => a.dimId === dim.id).length,
      isMarketCapped: MARKET_DIMS.has(dim.id),
      needsSetup: d.capability_test === undefined || !Array.isArray(d.outcomes) || d.outcomes.length === 0,
    });
  }
  return out;
}

/** Run a CLI sub-command. Returns a typed result (exit code captured + ledger-recorded);
 *  the orchestrator still re-reads state to decide progress, but a swallowed failure is now
 *  visible in the run bundle instead of being silently inferred away. */
async function df(cwd: string, args: string[]): Promise<CliResult> {
  return runCli(cwd, args);
}

// ── Phase command routing (pure — sequential vs council-parallel) ────────────────
// In --parallel mode the council fans the work out: define via member-split council-universe
// research (cross-verify on by default), build-to-7 via council --parallel (isolated worktrees +
// cross-member merge court + post-merge validate — the correct concurrent build). Scaffolding and
// outcome migration stay serial: they are fast local file ops, so worktree fan-out is pure overhead.

export function setupCommands(parallel: boolean, members: string[]): string[][] {
  const cmds: string[][] = [];
  if (parallel && members.length >= 2) cmds.push(['council-universe', '--members', members.join(','), '--propose-outcomes']);
  cmds.push(['evidence-scaffold'], ['migrate-outcomes', '--write']);
  // Honest-define: ground the scaffolded outcomes (real wired callsites or honest orphan-pending)
  // BEFORE build-to-7. The universe-definer/scaffold emit un-grounded outcomes (sentinel callsites);
  // without this the build phase would chase fabricated/orphan evidence the gate caps. ground-outcomes
  // never invents evidence — it grounds what the seam-free tests genuinely exercise, downgrades the rest.
  cmds.push(['ground-outcomes', '--apply']);
  return cmds;
}

export function buildTo7Commands(parallel: boolean, members: string[], dims: string[]): string[][] {
  // SERIAL build (--parallel 1), deliberately. harden-crusade --loop still drives EVERY buildable dim
  // to 7.0 (it re-ranks and loops to exhaustion) — just one at a time. We do NOT use --parallel N here
  // because N autoresearch workers share ONE working tree: concurrent checkout/applyHypothesis(file
  // writes)/reset --hard corrupt each other (council confirmed — the git-index mutex stops the
  // deadlock but NOT the shared-working-tree race). Serial is slower but CORRECT. The permanent fix is
  // worktree-per-worker isolation (like council --parallel) — tracked as a follow-up. The council
  // fan-out (already worktree-isolated) is reserved for push-to-9, where parity needs it.
  void parallel; void members; void dims;
  return [['harden-crusade', '--parallel', '1', '--loop', '--target', '7']];
}

// ── Orchestrator loop ───────────────────────────────────────────────────────────

export async function runAscendFrontier(options: AscendFrontierOptions): Promise<AscendFrontierResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const maxCycles = options.maxCycles ?? 200;
  const maxAttemptsPerDim = options.maxAttemptsPerDim ?? 3;
  const now = options._now ?? (() => new Date().toISOString());
  const buildState = options._buildState ?? defaultBuildState;
  // Discover the council once (parallel mode) — reused by define, build-to-7, and push fan-out.
  const members = (options.parallel && !options.dryRun)
    ? await (options._discoverMembers ?? defaultDiscoverMembers)()
    : [];
  const runSetup = options._runSetup ?? (async (c: string, dims: string[]) => {
    for (const cmd of setupCommands(!!options.parallel, members)) await df(c, cmd);
    void dims;
  });
  const runBuildTo7 = options._runBuildTo7 ?? (async (c: string, dims: string[]) => {
    for (const cmd of buildTo7Commands(!!options.parallel, members, dims)) await df(c, cmd);
  });
  const runPushTo9 = options._runPushTo9 ?? defaultPushTo9;

  const actions: string[] = [];
  let cycles = 0;
  // No-progress tracking: a setup/build action that runs but doesn't advance a dim increments its
  // counter; the counter resets the moment the dim genuinely advances. planNextAction ceilings a dim
  // whose counter hits maxBuildAttempts — so the loop can never spin forever on an un-buildable dim.
  const BUILD_TARGET = 7.0;
  const maxBuildAttempts = options.maxBuildAttempts ?? maxAttemptsPerDim;
  const setupAttempts = new Map<string, number>();
  const buildAttempts = new Map<string, number>();
  const lastScore = new Map<string, number>();
  // Distinct from court-attempt counting: a push whose court never RAN (build/evidence/command
  // failed) increments this, NOT the evidence-novelty attempt ledger. After maxBuildAttempts such
  // failures a dim gets an honest 'build-failed' ceiling (re-attemptable) — never a fabricated
  // 'generator-ceiling' (which is reserved for a court that actually ran and rejected).
  const buildFailedAttempts = new Map<string, number>();

  // Run-ledger: an auditable diary of the whole run (every sub-command + exit code, court verdict,
  // ceiling, before/after score). Created lazily on the first real cycle so dry-run / done-at-start
  // write nothing. finalize() emits .danteforge/runs/<runId>/ — the receipt Phase 3 inspects.
  let ledger: RunLedger | null = null;
  const ensureLedger = async (): Promise<RunLedger> => {
    if (!ledger) {
      ledger = new RunLedger('ascend-frontier', options.parallel ? ['--parallel'] : [], cwd);
      await ledger.initialize();
      setActiveLedger(ledger);
    }
    return ledger;
  };
  const complete = async (terminal: AscendFrontierResult['terminal'], summary: string): Promise<AscendFrontierResult> => {
    if (ledger) {
      await ledger.finalize({}, { actions }, {
        status: terminal === 'done' || terminal === 'dry-run' ? 'success' : terminal === 'failed' ? 'failure' : 'partial',
        completionOracle: terminal === 'done',
        reason: summary,
      }).catch(() => { /* ledger is advisory — never fail the run on a finalize hiccup */ });
      setActiveLedger(null);
    }
    return finish(terminal, cycles, actions, summary, options, ledger?.getRunId());
  };

  // Resilience: a single cycle that throws (e.g. an intermittent Windows child-spawn 127, a
  // transient matrix read during a concurrent council write) must NOT silently abort an hours-long
  // run. Each cycle's error is logged + recorded to the ledger and the loop continues; only after
  // MAX_CONSECUTIVE_ERRORS does it stop — with a VISIBLE 'failed' terminal and a FINALIZED ledger
  // (so the failing command + exit code are on disk, never an empty run dir). This is the council's
  // exact ask: surface the spawn failure, and don't kill the whole run on one transient glitch.
  const MAX_CONSECUTIVE_ERRORS = 3;
  let consecutiveErrors = 0;
  try {
  while (true) {
    let state: DimState[];
    try {
      state = await buildState(cwd);
    } catch (err) {
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[ascend-frontier] could not read project state: ${msg} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
      if (!options.dryRun) (await ensureLedger()).logEvent('cycle-error', { phase: 'buildState', error: msg });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) return await complete('failed', `aborted: could not read project state ${consecutiveErrors}× — ${msg}`);
      await new Promise(r => setTimeout(r, 500));
      continue;
    }
    for (const d of state) {
      const prev = lastScore.get(d.id);
      if (!d.needsSetup) setupAttempts.delete(d.id);                 // scaffolded → reset setup stall
      if (d.effectiveScore >= BUILD_TARGET || (prev !== undefined && d.effectiveScore > prev)) buildAttempts.delete(d.id); // advanced → reset build stall
      lastScore.set(d.id, d.effectiveScore);
      d.setupAttempts = setupAttempts.get(d.id) ?? 0;
      d.buildAttempts = buildAttempts.get(d.id) ?? 0;
    }
    const action = planNextAction(state, { maxAttemptsPerDim, maxBuildAttempts, buildTarget: BUILD_TARGET, nowIso: now() });

    if (action.type === 'done') { actions.push('done'); return await complete('done', action.summary); }
    if (action.type === 'stalled') { actions.push(`stalled:${action.reason}`); return await complete('stalled', action.reason); }

    if (options.dryRun) {
      actions.push(describe(action));
      logger.info(`[ascend-frontier] DRY RUN — next action: ${describe(action)}`);
      return await complete('dry-run', `next: ${describe(action)}`);
    }

    if (cycles >= maxCycles) { return await complete('max-cycles', `stopped at --max-cycles ${maxCycles}`); }
    cycles++;
    const led = await ensureLedger();
    led.logEvent('cycle', { cycle: cycles, action: describe(action) });
    logger.info(`[ascend-frontier] cycle ${cycles}: ${describe(action)}`);
    actions.push(describe(action));

    try {
    switch (action.type) {
      case 'setup':
        await runSetup(cwd, action.dims);
        for (const id of action.dims) setupAttempts.set(id, (setupAttempts.get(id) ?? 0) + 1);
        break;
      case 'build-to-7':
        await runBuildTo7(cwd, action.dims);
        for (const id of action.dims) buildAttempts.set(id, (buildAttempts.get(id) ?? 0) + 1);
        break;
      case 'ceiling':
        logger.info(`[ascend-frontier] ceiling ${action.dimId} (${action.cause}): ${action.detail}`);
        led.addReceipt('ceiling', { dimId: action.dimId, cause: action.cause, detail: action.detail, cap: scoreOf(state, action.dimId) });
        await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: action.cause,
          detail: action.detail, failedGates: [action.cause], recordedAt: now() });
        break;
      case 'push-to-9': {
        if (options.parallel) {
          // Fan out: assign the weakest dims to live members and push concurrently, each gated by
          // the frontier-review-court with the builder excluded (builder-never-judges). Reciprocal
          // passes are auto-queued for human audit inside runParallelRound.
          const liveMembers = members.length > 0 ? members : await (options._discoverMembers ?? defaultDiscoverMembers)();
          const assignments = assignRound(state, liveMembers, { nowIso: now() });
          if (assignments.length === 0) break;
          logger.info(`[ascend-frontier] parallel round: ${assignments.map(a => `${a.memberId}→${a.dimId}`).join(', ')}`);
          const round = await runParallelRound(cwd, assignments, {
            buildAll: options._buildAll ?? ((c, asg) => defaultBuildAll(c, asg, liveMembers)),
            promoteOne: options._promoteOne ?? defaultPromoteOne,
            nowIso: now(),
          });
          // Record an attempt per pushed dim so attempt-counts advance (a fresh HEAD makes it novel).
          const sha = await headSha(cwd);
          for (const o of round.outcomes) {
            if (o.parseError) {
              // The court did NOT run (failed/unparseable output) — never record a non-run as a
              // rejection; that would fabricate court-rejection provenance toward a generator-ceiling.
              // BUT count it as a build-failure attempt (mirroring the sequential push path, line ~291)
              // so a build-failing dim CEILINGS instead of churning forever in parallel mode.
              const n = (buildFailedAttempts.get(o.dimId) ?? 0) + 1;
              buildFailedAttempts.set(o.dimId, n);
              led.logGateCheck(`frontier-court:${o.dimId}`, 'fail', `court did NOT run (build/command failure) — attempt ${n}/${maxBuildAttempts}, not counted as a rejection`);
              if (n >= maxBuildAttempts) {
                const reviewAfter = new Date(Date.parse(now()) + 24 * 60 * 60_000).toISOString();
                led.addReceipt('ceiling', { dimId: o.dimId, cause: 'build-failed', detail: `${n} parallel push attempts failed to run` });
                await writeCeilingReceipt(cwd, { dimId: o.dimId, cap: scoreOf(state, o.dimId), cause: 'build-failed',
                  detail: `${n} parallel push attempts could not run the court — the build/command failed (not a court rejection). Held at current score; re-attempt after fixing the build.`,
                  failedGates: ['build-failed'], recordedAt: now(), reviewAfter });
              }
              continue;
            }
            led.logGateCheck(`frontier-court:${o.dimId}`, o.verdict === 'VALIDATED' ? 'pass' : 'fail', `builder=${o.builderId}`);
            await recordAttempt(cwd, { dimId: o.dimId, command: `parallel:${o.builderId}`, artifactPath: '', gitSha: sha },
              o.verdict === 'VALIDATED' ? 'validated' : 'rejected', now());
          }
          break;
        }
        const result = await runPushTo9(cwd, action.dimId);
        if (!result.courtRan) {
          // The court NEVER RAN (build/evidence/court sub-command failed) — this is NOT a rejection.
          // Do not touch the evidence-novelty attempt ledger; count it as a build failure instead.
          const n = (buildFailedAttempts.get(action.dimId) ?? 0) + 1;
          buildFailedAttempts.set(action.dimId, n);
          led.logGateCheck(`frontier-court:${action.dimId}`, 'fail', `court did NOT run (build/evidence/command failure) — attempt ${n}/${maxBuildAttempts}, not counted as a rejection`);
          if (n >= maxBuildAttempts) {
            // Honest operational ceiling — re-attemptable, distinct from generator-ceiling. Never
            // claims the court rejected (it didn't run). reviewAfter so it re-opens once the build is fixed.
            const reviewAfter = new Date(Date.parse(now()) + 24 * 60 * 60_000).toISOString();
            led.addReceipt('ceiling', { dimId: action.dimId, cause: 'build-failed', detail: `${n} push attempts failed to run` });
            await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: 'build-failed',
              detail: `${n} push attempts could not run the court — the build/evidence/court sub-command failed (not a court rejection). Held at current score; re-attempt after fixing the build.`,
              failedGates: ['build-failed'], recordedAt: now(), reviewAfter });
          }
          break;
        }
        // The court genuinely ran — record an honest attempt / generator-ceiling.
        led.logGateCheck(`frontier-court:${action.dimId}`, result.verdict === 'VALIDATED' ? 'pass' : 'fail');
        const attemptLedger = await loadAttemptLedger(cwd);
        if (!isNovelAttempt(attemptLedger, result.fingerprint)) {
          // The push produced no NEW evidence (same code/command/artifact) — it can't progress.
          led.addReceipt('ceiling', { dimId: action.dimId, cause: 'generator-ceiling', detail: 'no novel evidence' });
          await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: 'generator-ceiling',
            detail: 'Push produced no novel evidence (unchanged code/command/artifact) — cannot advance.', failedGates: ['evidence-novelty'], recordedAt: now() });
        } else {
          await recordAttempt(cwd, result.fingerprint, result.verdict === 'VALIDATED' ? 'validated' : 'rejected', now());
        }
        break;
      }
    }
    consecutiveErrors = 0; // a clean cycle resets the transient-failure counter
    } catch (err) {
      // One cycle threw (most likely a transient child-spawn 127 / worktree glitch). Surface it
      // loudly + record it, then CONTINUE — never abort the whole run on a single transient failure.
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[ascend-frontier] cycle ${cycles} (${describe(action)}) errored: ${msg} — continuing (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
      led.logEvent('cycle-error', { cycle: cycles, action: describe(action), error: msg });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return await complete('failed', `aborted after ${consecutiveErrors} consecutive cycle errors — last: ${msg}`);
      }
    }
  }
  } catch (err) {
    // Last-resort safety net: any escape finalizes the ledger so the failure is VISIBLE on disk
    // (summary.md + commands.json with the failing exit code) rather than a silent process abort.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[ascend-frontier] run aborted by an unexpected error: ${msg}`);
    (ledger as RunLedger | null)?.logEvent('run-error', { error: msg });
    return await complete('failed', `aborted: ${msg}`);
  } finally {
    // Always clear the module-scoped active ledger, even if the loop throws, so a later run
    // never records into a dead ledger.
    setActiveLedger(null);
  }
}

function scoreOf(state: DimState[], id: string): number { return state.find(d => d.id === id)?.effectiveScore ?? 0; }

function describe(a: AscendAction): string {
  switch (a.type) {
    case 'setup': return `setup(${a.dims.length} dims)`;
    case 'build-to-7': return `build-to-7(${a.dims.length} dims)`;
    case 'push-to-9': return `push-to-9(${a.dimId})`;
    case 'ceiling': return `ceiling(${a.dimId}:${a.cause})`;
    case 'done': return 'done';
    case 'stalled': return `stalled(${a.reason})`;
  }
}

function finish(terminal: AscendFrontierResult['terminal'], cycles: number, actions: string[], summary: string, options: AscendFrontierOptions, runId?: string): AscendFrontierResult {
  const result: AscendFrontierResult = { terminal, cycles, actions, summary, ...(runId ? { runId } : {}) };
  logger.info(`[ascend-frontier] ${terminal.toUpperCase()} after ${cycles} cycle(s) — ${summary}`);
  if (runId) logger.info(`[ascend-frontier] run-ledger: .danteforge/runs/${runId}/ (summary.md, commands.json, gates.json, receipts.json)`);
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

// ── Production push runner (one dim, full depth pass) ─────────────────────────────

async function defaultPushTo9(cwd: string, dimId: string): Promise<PushResult> {
  // freeze → capability work → real-user-path capture (per-session variant) → validate ×N → court.
  await df(cwd, ['frontier-spec', 'freeze', dimId, '--write']);
  await df(cwd, ['council-crusade', '--focus-dims', dimId, '--goal', `Close frontier_spec for ${dimId}`]);

  const specBefore = (await loadMatrix(cwd))?.dimensions.find(d => d.id === dimId);
  const spec0 = (specBefore as unknown as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
  let evidenceOk = false;
  if (spec0) {
    const callsite = spec0.real_user_path.required_callsite;
    const artifact = spec0.real_user_path.observable_artifacts[0]?.path ?? '';
    const sessions = Math.max(2, spec0.required_receipts.min_distinct_sessions);
    let okSessions = 0;
    for (let s = 0; s < sessions; s++) {
      // Each session runs a DIFFERENT realistic input (variant rotation) so one prepared fixture
      // cannot satisfy the whole multi-session proof — the anti-circular defense.
      const cmd = resolveRunCommand(spec0, s);
      const rec = await df(cwd, ['session-record', dimId, '--run', cmd, '--callsite', callsite, '--artifact', artifact, '--write']);
      const val = await df(cwd, ['validate', dimId, '--force-cold']);
      if (rec.ok && val.ok) okSessions++;
    }
    // Require ALL required distinct sessions to succeed — not just one. A single passing session is
    // NOT enough evidence to convene the court (it would violate min_distinct_sessions); treat a
    // partial run as a build failure, not a court attempt. (Council/Codex: evidenceOk was too permissive.)
    evidenceOk = okSessions >= sessions;
  }

  // The honesty boundary: the court only "ran" if there's a frozen spec, the evidence pipeline
  // actually produced something (rec+val exit 0), AND frontier-review itself executed (exit 0).
  // Otherwise this was a failed build — NOT a court rejection — and must not be recorded as one.
  let courtRan = false;
  let verdict: PushResult['verdict'] = 'REJECTED';
  if (spec0 && evidenceOk) {
    const review = await df(cwd, ['frontier-review', dimId, '--write']);
    if (review.ok) {
      courtRan = true;
      const matrix = await loadMatrix(cwd);
      const dim = matrix?.dimensions.find(d => d.id === dimId);
      const spec = (dim as unknown as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
      verdict = spec && effectiveStatus(spec) === 'validated' ? 'VALIDATED' : 'REJECTED';
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

async function headSha(cwd: string): Promise<string | null> {
  try { return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim(); } catch { return null; }
}

async function defaultDiscoverMembers(): Promise<CouncilMemberId[]> {
  const { discoverCouncil } = await import('./council.js');
  return (await discoverCouncil()).filter(m => m.available).map(m => m.id as CouncilMemberId);
}

/** CONCURRENT build: freeze each dim's spec, then council --parallel builds them in isolated
 *  worktrees with the cross-member merge court, merging approved work to main. */
async function defaultBuildAll(cwd: string, assignments: { memberId: CouncilMemberId; dimId: string }[], members: CouncilMemberId[]): Promise<void> {
  const dims = assignments.map(a => a.dimId);
  for (const d of dims) await df(cwd, ['frontier-spec', 'freeze', d, '--write']);
  if (members.length >= 2) {
    await df(cwd, ['council', '--parallel', '--members', members.join(','), '--focus-dims', dims.join(','), '--rounds', '1']);
  } else {
    for (const a of assignments) await df(cwd, ['council-crusade', '--focus-dims', a.dimId, '--goal', `Close frontier_spec for ${a.dimId}`]);
  }
}

/** SERIAL promote of one dim: capture real-user-path evidence (variant-rotated), validate across
 *  sessions, then run the court with the assigned owner EXCLUDED (builder-never-judges). Writes
 *  matrix.json — runParallelRound guarantees this runs one dim at a time, so no write races. */
async function defaultPromoteOne(cwd: string, a: { memberId: CouncilMemberId; dimId: string }): Promise<PushOutcome> {
  const spec0 = ((await loadMatrix(cwd))?.dimensions.find(d => d.id === a.dimId) as unknown as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
  if (spec0) {
    const callsite = spec0.real_user_path.required_callsite;
    const artifact = spec0.real_user_path.observable_artifacts[0]?.path ?? '';
    const sessions = Math.max(2, spec0.required_receipts.min_distinct_sessions);
    for (let s = 0; s < sessions; s++) {
      await df(cwd, ['session-record', a.dimId, '--run', resolveRunCommand(spec0, s), '--callsite', callsite, '--artifact', artifact, '--write']);
      await df(cwd, ['validate', a.dimId, '--force-cold']);
    }
  }
  // Distinguish a real court REJECT from "we couldn't read the court's answer" (non-zero exit or
  // no JSON): parseCourtOutput flags the latter so the orchestrator records uncertainty, not a clean no.
  const res = await runCli(cwd, ['frontier-review', a.dimId, '--builder', a.memberId, '--min-judges', '2', '--json', '--write']);
  const parsed = parseCourtOutput(res);
  return {
    dimId: a.dimId, builderId: a.memberId,
    verdict: parsed.verdict, passedByJudges: parsed.passedByJudges as CouncilMemberId[],
    ...(parsed.parseError ? { parseError: true } : {}),
  };
}
