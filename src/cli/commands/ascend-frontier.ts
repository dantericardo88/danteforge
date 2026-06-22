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
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadMatrix, invalidateMatrixCache, type CompeteMatrix } from '../../core/compete-matrix.js';
import { MARKET_CAPPED_DIMS } from '../../core/market-dims.js';
import { decisionDimScore } from '../../core/compete-matrix-score.js';
import { effectiveStatus, resolveRunCommand, checkFrontierSpec, type FrontierSpec } from '../../core/frontier-spec.js';
import { loadDimRubric } from '../../core/rubric-ladder.js';
import { loadCeilingReceipt, writeCeilingReceipt, shouldReopenForEngine, type CeilingCause } from '../../core/ceiling-receipt.js';
import { loadAuditQueue } from '../../core/audit-escrow.js';
import { loadAttemptLedger, recordAttempt, isNovelAttempt, type AttemptFingerprint } from '../../core/evidence-novelty.js';
import { planNextAction, reconcileAuditVerdict, type DimState, type AscendAction, type FrontierSpecStatus } from '../../core/ascend-frontier-engine.js';
import { assignRound, runParallelRound, type PushOutcome } from '../../core/ascend-frontier-parallel.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';
import { RunLedger } from '../../core/run-ledger.js';
import { setActiveLedger, peekPendingOutage, consumePendingOutage, clearPendingOutage } from './ascend-frontier-runner.js';
import { bootstrapColdRepo, defaultPreflight, type DefineUniverseFn, type PreflightResult } from './ascend-frontier-bootstrap.js';
import { df, defaultPushTo9, defaultDiscoverMembers, defaultBuildAll, defaultPromoteOne, headSha, engineSha, type PushResult } from './ascend-frontier-push.js';

const execFileAsync = promisify(execFile);
const MARKET_DIMS = MARKET_CAPPED_DIMS; // canonical set — src/core/market-dims.ts

// PushResult + the production push/promote runners live in ascend-frontier-push.ts
// (file-size split); PushResult is re-exported below so existing importers keep working.
export type { PushResult } from './ascend-frontier-push.js';

export interface AscendFrontierOptions {
  cwd?: string;
  dryRun?: boolean;
  /** Phase A cold-repo bootstrap: when no compete matrix exists, define one (non-interactive
   *  defineUniverse) before the loop. Default true; --no-bootstrap disables and the run fails
   *  cleanly naming the remedy instead of retry-spinning on the missing matrix. */
  bootstrap?: boolean;
  /** Parallel fan-out: each live council member owns a different dim and pushes concurrently. */
  parallel?: boolean;
  maxCycles?: number;
  maxAttemptsPerDim?: number;
  /** Dims excluded from the loop (e.g. code_generation, whose grade is cloud-only) — never selected for
   *  setup/build/push, so a local run can drive the safe dims to a court-9 without the heavy Docker grade. */
  skipDims?: string[];
  /** No-progress setup/build cycles before a stuck dim is ceilinged (default = maxAttemptsPerDim). */
  maxBuildAttempts?: number;
  json?: boolean;
  // Seams (production defaults shell out to the real commands).
  /** Cold-repo define runner (default: the real defineUniverse, always interactive:false). */
  _defineUniverse?: DefineUniverseFn;
  /** Pre-flight prober (default: node_modules + agent-CLI checks). Like _defineUniverse, an
   *  injected _buildState skips the production pre-flight unless this seam opts back in. */
  _preflight?: (cwd: string, parallel: boolean) => Promise<PreflightResult>;
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

/** Stale-brain predicate (self-challenge CH-012, exported for the pin): the engine on disk is
 *  newer than the one this process loaded at launch — continuing would burn budget on code that
 *  has been superseded (run 3f spent 11h on a pre-feedback engine this way). 1s slack absorbs
 *  same-write jitter; missing stats (tsx/test runs) disable the check rather than false-fire. */
export function engineUpdated(baselineMtimeMs: number | null, currentMtimeMs: number | null): boolean {
  if (baselineMtimeMs === null || currentMtimeMs === null) return false;
  return currentMtimeMs > baselineMtimeMs + 1000;
}

export interface AscendFrontierResult {
  terminal: 'done' | 'stalled' | 'max-cycles' | 'dry-run' | 'failed' | 'engine-updated';
  cycles: number;
  actions: string[];
  summary: string;
  /** The run-ledger id (.danteforge/runs/<runId>/) — present for any run that executed ≥1 cycle. */
  runId?: string;
}

// ── Production state builder ────────────────────────────────────────────────────

/** Exported for the ceiling re-open pin (tests drive the real state builder over a temp repo). */
export async function defaultBuildState(cwd: string): Promise<DimState[]> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found. (Phase A define has not run.)');
  const ledger = await loadAttemptLedger(cwd);
  // CH-018: the STABLE identity of the build+court engine that mints generator/build/court ceilings
  // (the last commit touching the engine source, NOT HEAD — council product commits move HEAD every
  // cycle). A fix to the engine changes this; a ceiling minted by the old engine then re-opens.
  const currentEngineSha = await engineSha(cwd);
  // CH-027: the dims a human spot-audit has FAILED — these must propagate into this unattended loop.
  const failedAuditDims = new Set(
    (await loadAuditQueue(cwd)).filter(e => e.status === 'failed').map(e => e.dimId),
  );
  const nowIso = new Date().toISOString();
  const out: DimState[] = [];
  for (const dim of matrix.dimensions) {
    const spec = (dim as unknown as { frontier_spec?: FrontierSpec }).frontier_spec;
    let ceiling = await loadCeilingReceipt(cwd, dim.id);
    // CH-018: cause-aware re-opening on engine change. An engine-bound ceiling (generator-ceiling /
    // build-failed / court-rejected) whose minting engineSha differs from the current HEAD measured
    // a generator that no longer exists — re-open it so the fixed engine retries, instead of forcing
    // the manual ceiling-lifts run 3k/3m needed. World/spec ceilings (market-cap, spec-incomplete)
    // are untouched. Legacy receipts (no engineSha) are held — we never re-open on absent provenance.
    if (ceiling && shouldReopenForEngine(ceiling, currentEngineSha)) {
      logger.info(`[ascend-frontier] ${dim.id}: ${ceiling.cause} ceiling RE-OPENED — minted by engine ${ceiling.engineSha?.slice(0, 8)}, current engine is ${currentEngineSha?.slice(0, 8)}; the generator changed, so its premise is stale.`);
      ceiling = null;
    }
    // Cause-aware re-opening (fleet run 3d: every dim sat behind a stale spec-incomplete ceiling
    // and the loop exited after ZERO cycles): a ceiling is a receipt for NAMED missing work, so
    // when that work is verifiably DONE the ceiling is resolved — not held until reviewAfter.
    // spec-incomplete names "author the real-user-path"; a spec that is now FROZEN (or validated)
    // passed checkFrontierSpec at freeze time, which is exactly that work completed.
    if (ceiling?.cause === 'spec-incomplete' && spec && ['frozen', 'validated'].includes(effectiveStatus(spec))) {
      logger.info(`[ascend-frontier] ${dim.id}: spec-incomplete ceiling RESOLVED — the frontier_spec is now ${effectiveStatus(spec)}; re-opening the push.`);
      ceiling = null;
    }
    const d = dim as unknown as { capability_test?: unknown; outcomes?: unknown[] };
    // decisionDimScore, NOT effectiveDimScore: a dim that declares outcomes but has no fresh
    // evidence at this SHA must read as UNVERIFIED (≤5), never coast on its stale self-claim.
    // effectiveDimScore falls back to raw self when derived is unset — on DanteAgents every
    // sub-7 dim snapped to a stale-high self after HEAD moved, so planNextAction returned a
    // premature 'done' after ONE unproductive cycle. The planner is a WORK decision; it uses
    // the work-decision score.
    const score = decisionDimScore(dim as Parameters<typeof decisionDimScore>[0]);
    // CH-027: a FAILED human spot-audit propagates here — it can never read as a validated 9, and
    // the loop stops re-pushing it (an honest, re-openable audit-failed ceiling) instead of spinning
    // on a frozen dim forever. A resolved (confirmed) audit clears the ceiling and re-opens the dim.
    let frontierStatus: FrontierSpecStatus = spec ? effectiveStatus(spec) : 'none';
    const verdict = reconcileAuditVerdict({
      dimId: dim.id, frontierStatus, ceiling, score, hasFailedAudit: failedAuditDims.has(dim.id), nowIso,
    });
    frontierStatus = verdict.frontierStatus;
    ceiling = verdict.ceiling;
    if (verdict.mintedCeiling) {
      logger.info(`[ascend-frontier] ${dim.id}: human audit FAILED — writing an audit-failed ceiling; the loop will stop re-pushing it until it is rebuilt and re-audited as confirmed.`);
      await writeCeilingReceipt(cwd, verdict.mintedCeiling);
    }
    out.push({
      id: dim.id,
      effectiveScore: score,
      frontierStatus,
      ceiling,
      attempts: ledger.filter(a => a.dimId === dim.id).length,
      isMarketCapped: MARKET_DIMS.has(dim.id),
      needsSetup: d.capability_test === undefined || !Array.isArray(d.outcomes) || d.outcomes.length === 0,
    });
  }
  return out;
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
  // Yardstick self-heal BEFORE the build: the conductor audits every dim's capability_test
  // (static + dynamic sensitivity probe), repairs or re-authors the self-fulfilling ones via the
  // examiner agent, and researches missing Score Ladders — budget-bounded so one setup cycle
  // cannot burn the run. Without this the build loop grips fictional metrics and "climbs" nothing.
  cmds.push(['capability-test', 'conduct', '--execute', '--max-actions', '3']);
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
  // After the build pass, RE-GROUND: a build can introduce a new module that isn't wired into
  // production (a fresh orphan) or a test that drifts from its callsite. ground-outcomes re-anchors
  // or honestly downgrades it, so the loop never advances toward 7 on un-grounded evidence the build
  // itself just created — the honesty self-correction in the real one-command path (not just runAscend).
  // TIME BUDGETS (fleet run 2 dead-loop fix): the runner caps harden-crusade at 60m (phaseTimeoutMs).
  // --time 18 bounds each per-dim autoresearch cycle so at least one FULL cycle (incl. merge-back)
  // always completes inside the window; --max-minutes 55 makes harden-crusade checkpoint-exit
  // CLEANLY (exit 0) before starting a cycle it cannot finish — merged progress persists and the
  // next orchestrator cycle continues from the re-ranked queue, instead of the old 30m-inner vs
  // 30m-outer tree-kill that died mid-dim-001 every cycle and restarted the fleet at zero forever.
  return [
    ['harden-crusade', '--parallel', '1', '--loop', '--target', '7', '--time', '18', '--max-minutes', '55'],
    ['ground-outcomes', '--apply'],
  ];
}

// ── Orchestrator loop ───────────────────────────────────────────────────────────

export async function runAscendFrontier(options: AscendFrontierOptions): Promise<AscendFrontierResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const maxCycles = options.maxCycles ?? 200;
  const maxAttemptsPerDim = options.maxAttemptsPerDim ?? 3;
  const skipDims = options.skipDims ?? [];
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

  // Stale-brain baseline (CH-012): the mtime of the entry bundle THIS process loaded. Checked
  // before every cycle; a newer file on disk means the engine was rebuilt and this loop is stale.
  const engineBaselineMtimeMs: number | null = process.argv[1]
    ? await fsp.stat(process.argv[1]).then(s => s.mtimeMs).catch(() => null)
    : null;
  // CH-018: stamp every minted ceiling with the engine that minted it, so a later run on a FIXED
  // engine re-opens the engine-bound ceilings this run produced (instead of needing a manual lift).
  const mintEngineSha = await engineSha(cwd);

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
  let interruptHandler: (() => void) | null = null;
  let crashHandler: ((err: unknown) => void) | null = null;
  const dropInterruptHandler = (): void => {
    if (interruptHandler) {
      process.removeListener('SIGINT', interruptHandler);
      process.removeListener('SIGTERM', interruptHandler);
      interruptHandler = null;
    }
    if (crashHandler) {
      process.removeListener('uncaughtException', crashHandler);
      process.removeListener('unhandledRejection', crashHandler);
      crashHandler = null;
    }
  };
  const ensureLedger = async (): Promise<RunLedger> => {
    if (!ledger) {
      ledger = new RunLedger('ascend-frontier', options.parallel ? ['--parallel'] : [], cwd);
      await ledger.initialize();
      setActiveLedger(ledger);
      // An operator-stopped run must STILL leave a complete bundle: the fleet's interrupted runs
      // produced sparse bundles (no summary.md / gates.json), so nothing verbatim could be quoted
      // in the reports. Finalize on SIGINT/SIGTERM, then exit with the conventional 130.
      interruptHandler = () => {
        const led = ledger;
        led?.logEvent('run-error', { error: 'interrupted (SIGINT/SIGTERM) — finalizing the bundle before exit' });
        void led?.finalize({}, { actions }, { status: 'partial', completionOracle: false, reason: 'interrupted by operator' })
          .catch(() => { /* exiting anyway */ })
          .finally(() => process.exit(130));
      };
      process.once('SIGINT', interruptHandler);
      process.once('SIGTERM', interruptHandler);
      // Silent-death net (live DanteForge run: parent exited 1 with a SPARSE bundle and no log
      // line — undebuggable). Any escape hatch the try/catch web misses still writes the error
      // and finalizes the bundle before the process dies.
      crashHandler = (err: unknown) => {
        const led = ledger;
        led?.logEvent('run-error', { error: `uncaught: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` });
        void led?.finalize({}, { actions }, { status: 'failure', completionOracle: false, reason: 'uncaught exception/rejection — see run-error event' })
          .catch(() => { /* dying anyway */ })
          .finally(() => process.exit(1));
      };
      process.once('uncaughtException', crashHandler);
      process.once('unhandledRejection', crashHandler);
    }
    return ledger;
  };
  const complete = async (terminal: AscendFrontierResult['terminal'], summary: string): Promise<AscendFrontierResult> => {
    dropInterruptHandler();
    if (ledger) {
      // Ledger is advisory (never fail the run on it) — but a SWALLOWED finalize error is how the
      // fleet got an exit-0 run with no summary.md. Surface it.
      await ledger.finalize({}, { actions }, {
        status: terminal === 'done' || terminal === 'dry-run' ? 'success' : terminal === 'failed' ? 'failure' : 'partial',
        completionOracle: terminal === 'done',
        reason: summary,
      }).catch((e) => logger.warn(`[ascend-frontier] run-ledger finalize failed (bundle may be sparse): ${e instanceof Error ? e.message : String(e)}`));
      setActiveLedger(null);
    }
    return finish(terminal, cycles, actions, summary, options, ledger?.getRunId());
  };

  // ── Phase A bootstrap (cold repo) ─────────────────────────────────────────────
  // The production state builder reads the compete matrix; a cold repo has none, so the loop used
  // to burn its whole retry budget on "No compete matrix found" and abort — define never ran.
  // Decide up front instead: define one (default — the same non-interactive defineUniverse
  // ascend-engine uses), report it (dry-run), or fail cleanly naming the remedy (--no-bootstrap).
  // Seam rule: an injected _buildState means the matrix is NOT what feeds the loop, so the check
  // is skipped — unless an injected _defineUniverse explicitly opts the define phase back in.
  if (!options._buildState || options._defineUniverse) {
    const boot = await bootstrapColdRepo(cwd, { bootstrap: options.bootstrap, dryRun: options.dryRun, _defineUniverse: options._defineUniverse });
    if (boot.kind === 'no-bootstrap') {
      actions.push('define-skipped:no-bootstrap');
      return await complete('failed', boot.remedy);
    } else if (boot.kind === 'would-define') {
      actions.push('define(bootstrap)');
      logger.info('[ascend-frontier] DRY RUN — next action: define(bootstrap) (no compete matrix yet; defineUniverse would create one)');
      return await complete('dry-run', 'next: define(bootstrap)');
    } else if (boot.kind === 'defined') {
      actions.push('define(bootstrap)');
      (await ensureLedger()).logEvent('define', boot.detail);
    } else if (boot.kind === 'define-failed') {
      actions.push('define(bootstrap)');
      (await ensureLedger()).logEvent('define-error', { error: boot.reason });
      return await complete('failed', `Phase A define (bootstrap) failed: ${boot.reason}`);
    }
  }

  // ── Pre-flight (fleet rank 10) ────────────────────────────────────────────────
  // A run whose environment cannot execute its own gates burns its whole budget on phantoms:
  // missing node_modules derives every dim to 0 (the inert state the fleet hit), and zero agent
  // CLIs means every build cycle honest-fails. Check ONCE, loudly, before any cycle — fail fast
  // with the named remedy for a broken environment, and ledger what was found either way.
  if (!options.dryRun && (!options._buildState || options._preflight)) {
    // ONE council probe per run (review finding 12): parallel mode already discovered the live
    // members above — preflight reuses that list instead of spawning the version probes again.
    // Sequential mode probes once, here, where the result is reported + ledgered.
    const discoverForPreflight: () => Promise<unknown[]> = members.length > 0
      ? (async () => members)
      : (options._discoverMembers ?? defaultDiscoverMembers);
    const preflight = options._preflight
      ?? ((c: string, p: boolean) => defaultPreflight(c, p, discoverForPreflight));
    const pf = await preflight(cwd, !!options.parallel);
    for (const n of pf.notes) logger.info(`[ascend-frontier] preflight: ${n}`);
    if (!pf.ok) {
      (await ensureLedger()).logEvent('preflight-failed', { remedy: pf.remedy, notes: pf.notes });
      actions.push('preflight-failed');
      return await complete('failed', `preflight: ${pf.remedy}`);
    }
    (await ensureLedger()).logEvent('preflight', { notes: pf.notes });
  }

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
    const action = planNextAction(state, { maxAttemptsPerDim, maxBuildAttempts, buildTarget: BUILD_TARGET, nowIso: now(), skipDims });

    if (action.type === 'done') { actions.push('done'); return await complete('done', action.summary); }
    if (action.type === 'stalled') { actions.push(`stalled:${action.reason}`); return await complete('stalled', action.reason); }

    if (options.dryRun) {
      actions.push(describe(action));
      logger.info(`[ascend-frontier] DRY RUN — next action: ${describe(action)}`);
      return await complete('dry-run', `next: ${describe(action)}`);
    }

    if (cycles >= maxCycles) { return await complete('max-cycles', `stopped at --max-cycles ${maxCycles}`); }
    // Stale-brain guard (self-challenge CH-012): if dist was rebuilt after this process launched,
    // every cycle from here on runs SUPERSEDED orchestration code (sub-commands pick the new dist
    // up; this in-memory loop never does). Exit cleanly and ask for a relaunch — state is durable,
    // earns persist, ceilings re-open: a restart costs nothing, a stale campaign costs hours.
    {
      const entry = process.argv[1];
      const current = entry ? await fsp.stat(entry).then(s => s.mtimeMs).catch(() => null) : null;
      if (engineUpdated(engineBaselineMtimeMs, current)) {
        return await complete('engine-updated',
          `the engine on disk was rebuilt after this run launched (${entry}) — restart \`ascend-frontier\` to run the new engine; all state persists.`);
      }
    }
    cycles++;
    const led = await ensureLedger();
    // Budget-window pause (self-challenge #7): once a sub-command reported the shared session
    // limit, every further build/judge fails identically until the stated reset. Sleeping here is
    // STRICTLY better than burning cycles on guaranteed failures mislabeled as build problems.
    {
      const { getBudgetPauseUntil, clearBudgetPause } = await import('./ascend-frontier-runner.js');
      const pauseUntil = getBudgetPauseUntil();
      if (pauseUntil !== null && pauseUntil > Date.now()) {
        const totalMin = Math.ceil((pauseUntil - Date.now()) / 60_000);
        logger.warn(`[ascend-frontier] agent session budget exhausted — pausing ${totalMin}m until the window resets (${new Date(pauseUntil).toLocaleTimeString()}); the campaign resumes by itself.`);
        led.logEvent('budget-pause', { minutes: totalMin, resumeAt: new Date(pauseUntil).toISOString() });
        while (Date.now() < pauseUntil) {
          await new Promise(r => setTimeout(r, Math.min(5 * 60_000, pauseUntil - Date.now())));
          const left = Math.ceil((pauseUntil - Date.now()) / 60_000);
          if (left > 0) logger.info(`[ascend-frontier] budget pause — ${left}m until the window resets`);
        }
        clearBudgetPause();
        logger.info('[ascend-frontier] budget window reopened — resuming the campaign.');
      }
    }
    // CH-019: fresh slate — the pending-outage marker now reflects ONLY this cycle's sub-commands.
    // If any of them hits a provider outage, we record nothing durable for the dim this cycle.
    clearPendingOutage();
    led.logEvent('cycle', { cycle: cycles, action: describe(action) });
    logger.info(`[ascend-frontier] cycle ${cycles}: ${describe(action)}`);
    actions.push(describe(action));

    try {
    switch (action.type) {
      case 'setup': {
        // The fleet lost gate-confirmed outcome declarations to setup's matrix rewrites with NO
        // signal (DanteAgents: 5 prior-session earns silently dropped, derived 2.09 → 1.74).
        // Grounding/migration may legitimately DOWNGRADE an outcome — but a declaration that
        // VANISHES must be loud and ledgered so the operator can restore or contest it.
        const before = await snapshotDeclarations(cwd);
        await runSetup(cwd, action.dims);
        const lost = diffLostDeclarations(before, await snapshotDeclarations(cwd));
        if (lost.length > 0) {
          logger.warn(`[ascend-frontier] setup REMOVED ${lost.length} outcome declaration(s): ${lost.slice(0, 8).join(', ')}${lost.length > 8 ? ', …' : ''} — grounding must downgrade with provenance, never silently drop. Recorded in the run ledger.`);
          led.logEvent('declarations-lost', { phase: 'setup', lost });
        }
        // CH-019: a provider outage during setup is not an un-scaffoldable dim — don't march it
        // toward a generator-ceiling on a dead council; the cycle-top pause waits out the window.
        if (!peekPendingOutage()) for (const id of action.dims) setupAttempts.set(id, (setupAttempts.get(id) ?? 0) + 1);
        break;
      }
      case 'build-to-7':
        await runBuildTo7(cwd, action.dims);
        // CH-019: an outage (no provider) is not a build that failed to progress — skip the counter.
        if (!peekPendingOutage()) for (const id of action.dims) buildAttempts.set(id, (buildAttempts.get(id) ?? 0) + 1);
        break;
      case 'ceiling':
        logger.info(`[ascend-frontier] ceiling ${action.dimId} (${action.cause}): ${action.detail}`);
        led.addReceipt('ceiling', { dimId: action.dimId, cause: action.cause, detail: action.detail, cap: scoreOf(state, action.dimId) });
        await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: action.cause,
          detail: action.detail, failedGates: [action.cause], recordedAt: now(), engineSha: mintEngineSha ?? undefined });
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
          // CH-019: a provider outage during the round means the builds/courts couldn't really run —
          // record NOTHING durable (no attempts, no ceilings) and let the cycle-top pause wait it out.
          if (peekPendingOutage()) {
            logger.warn('[ascend-frontier] parallel round hit a provider outage — recording nothing this round; pausing until the window reopens.');
            break;
          }
          // Record an attempt per pushed dim so attempt-counts advance (a fresh HEAD makes it novel).
          const sha = await headSha(cwd);
          for (const o of round.outcomes) {
            if (o.ceiling) {
              // spec-incomplete: honest, ACTIONABLE, names the unfilled fields — same semantics as
              // the sequential path. Not a build failure and not a court rejection.
              const reviewAfter = new Date(Date.parse(now()) + 24 * 60 * 60_000).toISOString();
              led.addReceipt('ceiling', { dimId: o.dimId, cause: o.ceiling.cause, detail: o.ceiling.detail });
              await writeCeilingReceipt(cwd, { dimId: o.dimId, cap: scoreOf(state, o.dimId), cause: o.ceiling.cause as CeilingCause,
                detail: o.ceiling.detail, failedGates: [o.ceiling.cause], recordedAt: now(), reviewAfter, engineSha: mintEngineSha ?? undefined });
              logger.info(`[ascend-frontier] ${o.dimId} ceiling (${o.ceiling.cause}) — ${o.ceiling.detail}`);
              continue;
            }
            if (o.parseError || !o.courtRan) {
              // The court did NOT run (missing/failed evidence, promote crash, or unparseable court
              // output) — never record a non-run as a rejection; that would fabricate court-rejection
              // provenance toward a generator-ceiling. Count it as a build-failure attempt
              // (mirroring the sequential push path) so a build-failing dim CEILINGS instead of
              // churning forever in parallel mode.
              const n = (buildFailedAttempts.get(o.dimId) ?? 0) + 1;
              buildFailedAttempts.set(o.dimId, n);
              led.logGateCheck(`frontier-court:${o.dimId}`, 'fail', `court did NOT run (build/command failure) — attempt ${n}/${maxBuildAttempts}, not counted as a rejection`);
              if (n >= maxBuildAttempts) {
                const reviewAfter = new Date(Date.parse(now()) + 24 * 60 * 60_000).toISOString();
                led.addReceipt('ceiling', { dimId: o.dimId, cause: 'build-failed', detail: `${n} parallel push attempts failed to run` });
                await writeCeilingReceipt(cwd, { dimId: o.dimId, cap: scoreOf(state, o.dimId), cause: 'build-failed',
                  detail: `${n} parallel push attempts could not run the court — the build/command failed (not a court rejection). Held at current score; re-attempt after fixing the build.`,
                  failedGates: ['build-failed'], recordedAt: now(), reviewAfter, engineSha: mintEngineSha ?? undefined });
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
        // CH-019: a provider outage during this push means the court couldn't really run / the build
        // couldn't really build — record NOTHING durable (no attempt, no build-failed, no
        // generator-ceiling) and let the cycle-top pause wait out the window. Without this guard, an
        // outage minted permanent generator-ceilings against live dims (run 3m: 5 in one night).
        if (peekPendingOutage()) {
          logger.warn(`[ascend-frontier] ${action.dimId}: provider outage during push — not counted; pausing until the provider window reopens.`);
          break;
        }
        if (result.ceiling) {
          // The dim's frontier_spec is INCOMPLETE — it genuinely cannot reach 9.0 until the human
          // real-user-path fields are authored. This is an HONEST, ACTIONABLE ceiling (it names the
          // exact missing work), NOT a build failure and NOT a court rejection. Re-openable: once the
          // operator authors the spec, the next push runs the court for real.
          const reviewAfter = new Date(Date.parse(now()) + 24 * 60 * 60_000).toISOString();
          led.addReceipt('ceiling', { dimId: action.dimId, cause: result.ceiling.cause, detail: result.ceiling.detail });
          await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: result.ceiling.cause,
            detail: result.ceiling.detail, failedGates: [result.ceiling.cause], recordedAt: now(), reviewAfter, engineSha: mintEngineSha ?? undefined });
          logger.info(`[ascend-frontier] ${action.dimId} ceiling (spec-incomplete) — author the frontier_spec to unlock 9.0: ${result.ceiling.detail}`);
          break;
        }
        if (result.planProgress && !result.courtRan && !result.ceiling) {
          // CH-014: this attempt advanced the dim's BUILD PLAN (court intentionally not convened).
          const p = result.planProgress;
          if (p.flipped > 0) {
            buildFailedAttempts.delete(action.dimId); // genuine progress resets the failure counter
            logger.info(`[ascend-frontier] ${action.dimId}: plan progress ${p.done}/${p.total} items (+${p.flipped} this attempt) — court convenes on plan-complete.`);
            led.logEvent('plan-progress', { dimId: action.dimId, ...p });
            break;
          }
          logger.warn(`[ascend-frontier] ${action.dimId}: plan attempt flipped 0 items (${p.done}/${p.total}) — counts toward build-failure.`);
          // fall through to the build-failure accounting below
        }
        if (!result.courtRan) {
          // The court NEVER RAN (build/evidence/court sub-command failed) — this is NOT a rejection.
          // Do not touch the evidence-novelty attempt ledger; count it as a build failure instead.
          const n = (buildFailedAttempts.get(action.dimId) ?? 0) + 1;
          buildFailedAttempts.set(action.dimId, n);
          // Console-visible too (fleet run 3b: this path was ledger-only, so an operator watching
          // live saw cycles end with NO explanation while a dim silently burned its 3 attempts).
          logger.warn(`[ascend-frontier] ${action.dimId}: court did NOT run (build/evidence/command failure) — attempt ${n}/${maxBuildAttempts}, not counted as a rejection`);
          led.logGateCheck(`frontier-court:${action.dimId}`, 'fail', `court did NOT run (build/evidence/command failure) — attempt ${n}/${maxBuildAttempts}, not counted as a rejection`);
          if (n >= maxBuildAttempts) {
            // Honest operational ceiling — re-attemptable, distinct from generator-ceiling. Never
            // claims the court rejected (it didn't run). reviewAfter so it re-opens once the build is fixed.
            const reviewAfter = new Date(Date.parse(now()) + 24 * 60 * 60_000).toISOString();
            led.addReceipt('ceiling', { dimId: action.dimId, cause: 'build-failed', detail: `${n} push attempts failed to run` });
            await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: 'build-failed',
              detail: `${n} push attempts could not run the court — the build/evidence/court sub-command failed (not a court rejection). Held at current score; re-attempt after fixing the build.`,
              failedGates: ['build-failed'], recordedAt: now(), reviewAfter, engineSha: mintEngineSha ?? undefined });
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
            detail: 'Push produced no novel evidence (unchanged code/command/artifact) — cannot advance.', failedGates: ['evidence-novelty'], recordedAt: now(), engineSha: mintEngineSha ?? undefined });
        } else {
          await recordAttempt(cwd, result.fingerprint, result.verdict === 'VALIDATED' ? 'validated' : 'rejected', now());
        }
        break;
      }
    }
    // CH-019: surface + clear the outage marker. The pause was already scheduled inside runCli; this
    // makes the outage an OBSERVED fact in the ledger/console (not a silent "nothing happened" cycle).
    const outageThisCycle = consumePendingOutage();
    if (outageThisCycle) {
      logger.warn(`[ascend-frontier] cycle ${cycles}: provider outage (${outageThisCycle.signature}) — no durable state recorded; the campaign pauses until the window reopens and resumes by itself.`);
      led.logEvent('provider-outage', { cycle: cycles, signature: outageThisCycle.signature });
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
    // Always clear the module-scoped active ledger + interrupt hooks, even if the loop throws,
    // so a later run never records into a dead ledger or fires a stale signal handler.
    dropInterruptHandler();
    setActiveLedger(null);
  }
}

function scoreOf(state: DimState[], id: string): number { return state.find(d => d.id === id)?.effectiveScore ?? 0; }

/** Per-dim outcome-declaration ids from the RAW on-disk matrix.json — deliberately NOT loadMatrix:
 *  the declarations-ledger overlay would silently re-add any ledgered declaration setup removed,
 *  making this detector blind to exactly the loss class it exists to catch (adversarial-review
 *  finding: the two persistence fixes cancelled each other's audit signal through the cache). */
async function snapshotDeclarations(cwd: string): Promise<Map<string, Set<string>>> {
  invalidateMatrixCache();
  const snap = new Map<string, Set<string>>();
  try {
    const raw = await fsp.readFile(path.join(cwd, '.danteforge', 'compete', 'matrix.json'), 'utf8');
    const m = JSON.parse(raw.replace(/^\uFEFF/, '')) as { dimensions?: Array<{ id?: unknown; outcomes?: Array<{ id?: unknown }> }> };
    for (const dim of m.dimensions ?? []) {
      if (typeof dim.id !== 'string') continue;
      const ids = (dim.outcomes ?? []).map(o => String(o.id ?? '')).filter(Boolean);
      snap.set(dim.id, new Set(ids));
    }
  } catch { /* no matrix on disk yet — empty snapshot */ }
  return snap;
}

/** Declarations present before but ABSENT after — `dim/outcomeId` rows for the warning + ledger. */
function diffLostDeclarations(before: Map<string, Set<string>>, after: Map<string, Set<string>>): string[] {
  const lost: string[] = [];
  for (const [dimId, ids] of before) {
    const now = after.get(dimId) ?? new Set<string>();
    for (const id of ids) if (!now.has(id)) lost.push(`${dimId}/${id}`);
  }
  return lost;
}

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
