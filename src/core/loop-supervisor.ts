// loop-supervisor.ts — the auto-reengage Supervisor: the OUTER loop the audit found missing. DanteForge's
// inner loop engines (autoforge/crusade/frontier/...) each exit cleanly with a status and then just STOP.
// The supervisor wraps an engine, reads how each run ended, classifies it (loop-exit-classifier), and either
// re-engages (restart / wait-then-restart), pauses for a human (ceiling/policy), or stops on success — so an
// unattended campaign survives sleep, crashes, provider outages, and dead council members WITHOUT a human
// nudging `danteforge resume` every time.
//
// All side effects are injected (runEngine / measureGrounding / sleep / now / notify / saveState), so the
// control flow is fully unit-testable with fakes — no subprocess, no real clock, no network. The real driver
// (supervise.ts) supplies runEngine = spawn the chosen engine and synthesize a LoopRunSummary.

import type { LoopRunSummary } from './autonomous-loop-runner.js';
import {
  classifyLoopExit, type ClassifyConfig, type LoopExit, type SupervisorAction,
} from './loop-exit-classifier.js';
import {
  freshSupervisorState, saveSupervisorState, type SupervisorState,
} from './supervisor-state.js';
import { decomposeOrEscalate, type ChildObstacle, type DecompositionReceipt } from './obstacle-decomposition.js';

export interface SupervisorDeps {
  /** Run the inner engine ONCE. Resolves to its LoopRunSummary; THROW on crash (docker down, etc.). */
  runEngine: (restart: number) => Promise<LoopRunSummary>;
  /** Measured grounding ratio (0..1) right now — the progress signal that resets the stale-restart counter.
   *  Omit → the supervisor assumes progress each run (no circuit breaker on grounding). */
  measureGrounding?: () => Promise<number>;
  /** Has the campaign target been reached? Checked before each run and after each exit. */
  targetReached?: () => Promise<boolean>;
  /** Operator stop sentinel — return true to halt cleanly (set by `supervise --stop`). */
  stopRequested?: () => Promise<boolean>;
  /** Sleep (injectable). Real: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Wall clock (injectable). Real: Date.now. */
  now?: () => number;
  /** Pause/escalation/done sink (injectable). Real: ESCALATIONS.md + optional toast/webhook. */
  notify?: (n: { level: 'pause' | 'escalate' | 'done'; reason: string; state: SupervisorState }) => void | Promise<void>;
  /** Persist state (injectable). Real: saveSupervisorState. */
  saveState?: (s: SupervisorState) => Promise<void>;
  /** No-walls: propose smaller sub-problems when a ceiling escalates. Omit → escalate to the operator. */
  proposeCeilingChildren?: (reason: string) => ChildObstacle[] | Promise<ChildObstacle[]>;
  log?: (msg: string) => void;
}

export interface SupervisorConfig extends ClassifyConfig {
  goal: string;
  target: number;
  engine: string;
  /** Hard backstop on total relaunches — convergence guard, set far above any real campaign. Default 1000. */
  maxRestarts?: number;
}

export interface SupervisorSummary {
  outcome: 'stopped-success' | 'paused' | 'escalated' | 'restart-cap' | 'stopped-operator';
  reason: string;
  restarts: number;
  state: SupervisorState;
  /** Present when a ceiling escalated — the ceiling broken into a worklist (no-walls invariant). */
  ceilingDecomposition?: DecompositionReceipt;
  history: Array<{ restart: number; action: SupervisorAction }>;
}

const DEFAULT_MAX_RESTARTS = 1000;

/**
 * Run a supervised campaign until success, an operator stop, a human-in-loop pause, or the restart cap.
 * Deterministic given deterministic deps. Persists state every turn so a crash/sleep can resume.
 */
export async function runSupervisor(
  deps: SupervisorDeps,
  config: SupervisorConfig,
  initialState?: SupervisorState,
): Promise<SupervisorSummary> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const save = deps.saveState ?? ((s: SupervisorState) => saveSupervisorState(s));
  const maxRestarts = config.maxRestarts ?? DEFAULT_MAX_RESTARTS;

  const state: SupervisorState = initialState ?? freshSupervisorState(
    { goal: config.goal, target: config.target, engine: config.engine, posture: config.posture },
    new Date(now()).toISOString(),
  );
  const history: SupervisorSummary['history'] = [];

  const finish = async (
    outcome: SupervisorSummary['outcome'], reason: string, action: SupervisorAction,
  ): Promise<SupervisorSummary> => {
    state.status = outcome === 'paused' ? 'paused' : 'stopped';
    if (outcome === 'paused') state.pauseSticky = true; // awaits the operator; keepalive must not auto-resume
    state.lastExitReason = reason;
    state.savedAt = new Date(now()).toISOString();
    await save(state);
    if (outcome === 'stopped-success') await deps.notify?.({ level: 'done', reason, state });
    else if (outcome === 'paused') await deps.notify?.({ level: 'pause', reason, state });
    return { outcome, reason, restarts: state.restarts, state, history: history.concat({ restart: state.restarts, action }) };
  };

  const escalate = async (action: Extract<SupervisorAction, { kind: 'pause' }>): Promise<SupervisorSummary> => {
    // No-walls: a ceiling is decomposed into the next sub-problems, or escalated to the operator — never a
    // bare stop. Reuses the doctrine engine so the campaign always ends with a worklist.
    const decomposition = await decomposeOrEscalate(
      { solved: false, obstacle: { kind: 'supervisor-ceiling', signal: action.reason }, attempted: [], ceiling: action.reason },
      {
        proposeChildren: deps.proposeCeilingChildren ? () => deps.proposeCeilingChildren!(action.reason) : undefined,
        escalate: () => ({ to: 'human', reason: 'ceiling reached — operator names the next sub-problem' }),
      },
    );
    state.status = 'paused';
    state.pauseSticky = true; // ceiling/escalation awaits the operator; keepalive must not auto-resume
    state.escalations.push({ at: new Date(now()).toISOString(), reason: action.reason });
    state.savedAt = new Date(now()).toISOString();
    await save(state);
    await deps.notify?.({ level: 'escalate', reason: action.reason, state });
    return {
      outcome: 'escalated', reason: action.reason, restarts: state.restarts, state,
      ceilingDecomposition: decomposition, history,
    };
  };

  for (;;) {
    // Operator stop sentinel — honored at the top of every turn.
    if (await deps.stopRequested?.()) {
      return await finish('stopped-operator', 'operator requested stop', { kind: 'stop', reason: 'operator stop' });
    }
    // Already at target before spending a run.
    if (await deps.targetReached?.()) {
      return await finish('stopped-success', 'campaign target reached', { kind: 'stop', reason: 'target reached' });
    }
    if (state.restarts >= maxRestarts) {
      return await finish('restart-cap', `restart cap reached (${maxRestarts})`, { kind: 'stop', reason: 'restart cap' });
    }

    // RUN one inner-engine pass; a throw is a crash we recover from (not a bare failure).
    let summary: LoopRunSummary | null = null;
    let crashed = false;
    let output = '';
    log(`[supervise] launching ${config.engine} (run ${state.restarts + 1})…`);
    try {
      summary = await deps.runEngine(state.restarts);
      output = summary.finalReason;
    } catch (err) {
      crashed = true;
      output = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      log(`[supervise] engine crashed: ${output.split('\n')[0]}`);
    }

    // Measure progress → reset/advance the stale-restart counter (drives backoff + circuit breaker).
    const grounding = deps.measureGrounding ? await deps.measureGrounding() : null;
    const progressed = grounding === null || state.lastGrounding === null ? true : grounding > state.lastGrounding;
    if (grounding !== null) state.lastGrounding = grounding;

    const targetReached = (await deps.targetReached?.()) ?? false;
    const exit: LoopExit = {
      status: summary?.status ?? 'stopped',
      ceilingHit: summary?.ceilingHit ?? false,
      finalReason: crashed ? 'engine crashed' : summary?.finalReason ?? 'unknown',
      output,
      crashed,
      targetReached,
      staleRestarts: state.staleRestarts,
    };
    const action = classifyLoopExit(exit, config, now());
    history.push({ restart: state.restarts, action });
    state.restarts += 1;
    state.lastExitReason = action.reason;
    state.staleRestarts = progressed ? 0 : state.staleRestarts + 1;
    state.savedAt = new Date(now()).toISOString();
    state.nextResumeAtMs = action.kind === 'resume-at' ? action.resumeAtMs : null;
    await save(state);
    log(`[supervise] run ${state.restarts}: ${action.kind.toUpperCase()} — ${action.reason}`);

    switch (action.kind) {
      case 'stop':
        return await finish('stopped-success', action.reason, action);
      case 'pause':
        if (action.escalate) return await escalate(action);
        return await finish('paused', action.reason, action);
      case 'resume-at': {
        const waitMs = Math.max(action.backoffMs, action.resumeAtMs - now());
        log(`[supervise] sleeping ${Math.round(waitMs / 1000)}s until provider reset…`);
        await sleep(waitMs);
        break;
      }
      case 'restart':
        await sleep(action.backoffMs);
        break;
    }
  }
}
