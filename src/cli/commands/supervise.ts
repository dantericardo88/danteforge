// supervise.ts — the `danteforge supervise` command: the operator-facing front door to the auto-reengage
// Supervisor. It wraps an inner engine (autoforge | crusade | frontier) and keeps re-launching it through
// transient stops (sleep, crash, provider outage, degraded panel) WITHOUT a human running `resume` — pausing
// only on a real capability ceiling or a policy/budget stop, exactly as the operator chose (tiered autonomy).
//
// The pure decision logic lives in loop-exit-classifier.ts + loop-supervisor.ts (fully unit-tested). This
// file is the thin real-world driver: spawn the engine, capture its output, map exit→LoopRunSummary, persist
// state, and surface pauses. `summarizeEngineRun` is exported and pure so the exit→summary mapping is tested.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import type { LoopRunSummary } from '../../core/autonomous-loop-runner.js';
import type { Posture } from '../../core/loop-exit-classifier.js';
import { runSupervisor, type SupervisorDeps, type SupervisorConfig } from '../../core/loop-supervisor.js';
import {
  loadSupervisorState, requestSupervisorStop, saveSupervisorState, freshSupervisorState,
  type SupervisorState,
} from '../../core/supervisor-state.js';
import { installKeepalive } from '../../core/supervisor-keepalive.js';
import { writeEscalation } from '../../core/supervisor-notify.js';
import { acquireSupervisorLock, releaseSupervisorLock } from '../../core/supervisor-lock.js';
import { measuredReceiptGate } from '../../core/measured-completion-gate.js';

export interface SuperviseOptions {
  goal?: string;
  target?: number;
  engine?: string;
  posture?: Posture;
  maxRestarts?: number;
  status?: boolean;
  stop?: boolean;
  installKeepalive?: boolean;
  dryRun?: boolean;
  bestOfN?: number;
  /** Set by the OS keepalive launcher — a sticky-paused campaign is NOT auto-resumed when this is true. */
  fromKeepalive?: boolean;
}

const ENGINES = new Set(['autoforge', 'crusade', 'frontier']);

/** Map an engine name + target (+ optional best-of-N) to the CLI argv that runs its inner loop once. */
export function engineArgs(engine: string, target: number, bestOfN?: number): string[] {
  const bo = bestOfN && bestOfN > 1 ? ['--best-of-n', String(bestOfN)] : [];
  switch (engine) {
    case 'crusade': return ['crusade', '--target', String(target), ...bo];
    case 'frontier': return ['ascend', '--frontier', '--target', String(target), ...bo];
    case 'autoforge':
    default: return ['autoforge', '--auto', '--target', String(target), ...bo];
  }
}

/**
 * PURE: turn a finished engine subprocess (exit code + combined output) into a LoopRunSummary plus a
 * target-reached flag. The classifier reads finalReason for outage/policy/budget signatures, so we carry the
 * output tail there; ceiling and success are detected from well-known engine markers.
 */
export function summarizeEngineRun(code: number | null, output: string): { summary: LoopRunSummary; targetReached: boolean } {
  const tail = output.replace(/\s+/g, ' ').trim().slice(-2000);
  const targetReached = /FRONTIER_REACHED|target reached|campaign complete|✅ *target|all dimensions? (?:at|reached) target/i.test(output);
  const ceilingHit = /AT_CEILING|generator-ceiling|capability ceiling|market-cap|CAPABILITY_TEST_BLOCKED/i.test(output);
  const summary: LoopRunSummary = {
    status: ceilingHit ? 'stopped' : code === 0 ? 'stopped' : 'paused',
    ceilingHit,
    cyclesRun: 1,
    groundingStart: 0,
    groundingEnd: 0,
    finalReason: tail || (code === 0 ? 'engine run completed' : `engine exited ${code}`),
    history: [],
  };
  return { summary, targetReached };
}

/** Default per-run wall-clock cap: a single inner-engine run may not exceed this. A hang past it is KILLED and
 *  reported as a timeout (a classifiable transient) so an unattended campaign can never freeze on one bad run. */
const DEFAULT_ENGINE_RUN_TIMEOUT_MS = 60 * 60_000;

/** Spawn the engine once, tee its output to the console, and resolve {code, output}. Rejects on spawn error.
 *  A run exceeding `timeoutMs` is killed and resolves with a synthetic timeout result (not a hang). */
function spawnEngine(argv: string[], cwd: string, timeoutMs = DEFAULT_ENGINE_RUN_TIMEOUT_MS): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1]!, ...argv], { cwd, env: process.env });
    let output = '';
    let settled = false;
    const onData = (buf: Buffer) => { const s = buf.toString('utf8'); output += s; process.stdout.write(s); };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      logger.warn(`[supervise] engine run exceeded ${Math.round(timeoutMs / 60_000)}m — killed (will be retried as a transient).`);
      resolve({ code: 124, output: `${output}\nengine timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); });
    child.on('close', (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, output }); });
  });
}

/** Cheap, no-LLM grounding proxy: how many outcome-evidence receipts currently PASS. The supervisor's circuit
 *  breaker resets its stale counter only when this grows — i.e. only when the loop produced real measured
 *  progress. Without this the breaker was dead (council finding: measureGrounding was never wired). */
async function countPassingReceipts(cwd: string): Promise<number> {
  try {
    const dir = path.join(cwd, '.danteforge', 'outcome-evidence');
    const files = await fsp.readdir(dir);
    let passing = 0;
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')) as { status?: string; passed?: boolean };
        if (j.status === 'pass' || j.passed === true) passing++;
      } catch { /* skip malformed receipt */ }
    }
    return passing;
  } catch {
    return 0;
  }
}

export async function supervise(goalArg: string | undefined, options: SuperviseOptions = {}): Promise<void> {
  const cwd = process.cwd();

  if (options.status) {
    const s = await loadSupervisorState(cwd);
    if (!s) { logger.info('[supervise] no campaign state found.'); return; }
    logger.info(`[supervise] status=${s.status} engine=${s.engine} goal="${s.goal}" target=${s.target}`);
    logger.info(`           restarts=${s.restarts} staleRestarts=${s.staleRestarts} lastExit="${s.lastExitReason}"`);
    if (s.escalations.length) logger.info(`           escalations: ${s.escalations.length} (latest: ${s.escalations.at(-1)!.reason})`);
    return;
  }
  if (options.stop) { await requestSupervisorStop(cwd); return; }
  if (options.installKeepalive) {
    const target = options.target ?? 8;
    const engine = options.engine ?? 'autoforge';
    await installKeepalive({ cwd, goal: goalArg ?? options.goal ?? '', target, engine, posture: options.posture ?? 'tiered' });
    return;
  }

  const goal = goalArg ?? options.goal ?? '';
  const target = options.target ?? 8;
  const engine = options.engine ?? 'autoforge';
  const posture: Posture = options.posture ?? 'tiered';
  if (!ENGINES.has(engine)) { logger.error(`[supervise] unknown engine "${engine}". Use: autoforge | crusade | frontier`); process.exitCode = 1; return; }

  const argv = engineArgs(engine, target, options.bestOfN);
  if (options.dryRun) {
    logger.info(`[supervise] DRY RUN — would loop: ${engine} → \`danteforge ${argv.join(' ')}\` (posture=${posture}, target=${target})`);
    logger.info('[supervise] would auto-restart transient stops; pause only on ceiling/policy/budget.');
    return;
  }

  // Sticky pause: a campaign paused for the operator (ceiling/policy/config) must NOT be auto-resumed by the
  // keepalive — only a foreground operator re-run clears it. Without this the scheduler silently un-pauses it.
  const prior = await loadSupervisorState(cwd);
  if (prior && prior.pauseSticky && prior.status === 'paused' && options.fromKeepalive) {
    logger.info('[supervise] campaign is paused awaiting the operator — keepalive will not auto-resume. Re-run `danteforge supervise` in the foreground to continue.');
    return;
  }

  // Resume an existing campaign if one is paused/running for the same engine+goal, else start fresh. A
  // foreground re-run of a sticky-paused campaign CLEARS the sticky flag (the operator chose to continue).
  const initial: SupervisorState | undefined =
    prior && prior.engine === engine && prior.goal === goal && prior.status !== 'stopped'
      ? { ...prior, status: 'running', stopRequested: false, pauseSticky: false }
      : freshSupervisorState({ goal, target, engine, posture }, new Date().toISOString());
  await saveSupervisorState(initial, cwd);

  let lastTargetReached = false;
  const deps: SupervisorDeps = {
    runEngine: async () => {
      const { code, output } = await spawnEngine(argv, cwd);
      const { summary, targetReached } = summarizeEngineRun(code, output);
      lastTargetReached = targetReached;
      return summary;
    },
    // Success is anchored to MEASURED truth, not just the engine's stdout marker: the supervisor declares the
    // campaign done only if the engine signalled success AND a fresh T5+ receipt proves it (same gate the inner
    // loop uses). Closes the last soft-success surface — a future engine that logs a success token on a
    // non-gated path can't false-positive the campaign.
    targetReached: async () => lastTargetReached && (await measuredReceiptGate(cwd).then((r) => r.passed).catch(() => false)),
    // Measured progress proxy → makes the circuit breaker real: if passing receipts don't grow across
    // restarts, the loop isn't making measured progress and the breaker escalates instead of burning forever.
    measureGrounding: async () => countPassingReceipts(cwd),
    stopRequested: async () => (await loadSupervisorState(cwd))?.stopRequested === true,
    notify: async (n) => { await writeEscalation(cwd, n.level, n.reason); },
    log: (m) => logger.info(m),
  };
  const config: SupervisorConfig = { posture, goal, target, engine, maxRestarts: options.maxRestarts ?? 100 };

  // Singleton guard: never let a keepalive-launched supervisor and a foreground one run the same campaign
  // concurrently (they would clobber state + double-launch engines). PID-liveness, not a TTL.
  const lock = await acquireSupervisorLock(cwd);
  if (!lock.acquired) {
    logger.info(`[supervise] another supervisor is already running (pid ${lock.heldByPid}) — exiting.`);
    return;
  }

  logger.info(`[supervise] starting campaign — engine=${engine} target=${target} posture=${posture}`);
  try {
    const res = await runSupervisor(deps, config, initial);
    logger.info(`[supervise] campaign ended: ${res.outcome} — ${res.reason} (after ${res.restarts} run(s))`);
    if (res.ceilingDecomposition?.resolution.kind === 'decomposed') {
      logger.info(`[supervise] ceiling broken into ${res.ceilingDecomposition.resolution.children.length} sub-problem(s) — see ESCALATIONS.md`);
    }
    if (res.outcome !== 'stopped-success') process.exitCode = res.outcome === 'stopped-operator' ? 0 : 2;
  } finally {
    await releaseSupervisorLock(cwd);
  }
}
