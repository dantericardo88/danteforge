// daemon.ts — `danteforge daemon` — Autonomous improvement loop.
// Closes the autonomy gap vs Devin (-2.5): DanteForge can now run completely
// unattended, continuously improving until a score target is reached or a time
// limit is hit — no human re-invocation needed.
//
// Strategy options:
//   crusade:      Runs `harden-crusade` passes until target or ceiling
//   autoresearch: Runs `autoresearch` on the weakest dimension each pass
//   adaptive:     Switches between crusade and autoresearch based on stall detection

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';

const execFileAsync = promisify(execFile);
const DAEMON_LOG_FILE = '.danteforge/daemon-log.jsonl';
const NODE_BIN = process.execPath;

// ── Types ─────────────────────────────────────────────────────────────────────

export type DaemonStrategy = 'crusade' | 'autoresearch' | 'adaptive';

export interface DaemonOptions {
  strategy?: DaemonStrategy;
  target?: number;
  timeLimitMinutes?: number;
  intervalMinutes?: number;
  cwd?: string;
  dryRun?: boolean;
  /** Run the intel cycle every N improvement passes (0 = disabled, default: 3) */
  intelCycleEvery?: number;
  _runPass?: (strategy: DaemonStrategy, cwd: string) => Promise<DaemonPassResult>;
  _getCurrentScore?: (cwd: string) => Promise<number>;
  _now?: () => number;
}

export interface DaemonPassResult {
  strategy: DaemonStrategy;
  pass: number;
  scoreBeforePass: number;
  scoreAfterPass: number;
  durationMs: number;
  outcome: 'improved' | 'plateau' | 'error';
  error?: string;
}

export interface DaemonResult {
  passes: DaemonPassResult[];
  finalScore: number;
  targetReached: boolean;
  timeLimitReached: boolean;
  reason: string;
}

// ── Score helper ──────────────────────────────────────────────────────────────

async function getWeightedScore(cwd: string): Promise<number> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return 0;
  const excluded = new Set(matrix.excludedDimensions ?? []);
  const active = matrix.dimensions.filter(d => !excluded.has(d.id) && d.status !== 'closed');
  if (active.length === 0) return 0;
  const total = active.reduce((sum, d) => sum + (d.scores?.self ?? 0) * (d.weight ?? 1), 0);
  const weights = active.reduce((sum, d) => sum + (d.weight ?? 1), 0);
  return parseFloat((total / weights).toFixed(2));
}

// ── Pass runners ──────────────────────────────────────────────────────────────

async function runHardenCrusadePass(cwd: string): Promise<void> {
  const distPath = path.join(cwd, 'dist', 'index.js');
  await execFileAsync(NODE_BIN, [distPath, 'harden-crusade', '--target', '9', '--parallel', '2'], {
    cwd,
    timeout: 30 * 60 * 1000, // 30 min
    env: { ...process.env, DANTEFORGE_DAEMON: '1' },
  });
}

async function runAutoResearchPass(cwd: string): Promise<void> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return;
  const excl = new Set(matrix.excludedDimensions ?? []);
  const active = matrix.dimensions.filter(d => !excl.has(d.id) && d.status !== 'closed');
  const weakest = active.sort((a, b) => (a.scores?.self ?? 0) - (b.scores?.self ?? 0))[0];
  if (!weakest) return;
  const distPath = path.join(cwd, 'dist', 'index.js');
  await execFileAsync(
    NODE_BIN,
    [distPath, 'autoresearch', '--metric', weakest.id, '--time', '20', '--allow-dirty'],
    {
      cwd,
      timeout: 25 * 60 * 1000, // 25 min
      env: { ...process.env, DANTEFORGE_DAEMON: '1' },
    },
  );
}

async function defaultRunPass(strategy: DaemonStrategy, cwd: string): Promise<DaemonPassResult> {
  const t0 = Date.now();
  const scoreBefore = await getWeightedScore(cwd);
  let outcome: DaemonPassResult['outcome'] = 'improved';
  let error: string | undefined;

  try {
    if (strategy === 'autoresearch') {
      await runAutoResearchPass(cwd);
    } else {
      await runHardenCrusadePass(cwd);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    outcome = 'error';
  }

  const scoreAfter = await getWeightedScore(cwd);
  if (outcome !== 'error') {
    outcome = scoreAfter > scoreBefore ? 'improved' : 'plateau';
  }

  return {
    strategy,
    pass: 0, // set by caller
    scoreBeforePass: scoreBefore,
    scoreAfterPass: scoreAfter,
    durationMs: Date.now() - t0,
    outcome,
    error,
  };
}

// ── Log helper ────────────────────────────────────────────────────────────────

async function appendLog(cwd: string, entry: object): Promise<void> {
  const logPath = path.join(cwd, DAEMON_LOG_FILE);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  await fs.appendFile(logPath, line, 'utf8');
}

// ── Intel cycle ───────────────────────────────────────────────────────────────
// Runs competitor intelligence, then applies the findings to the matrix.
// Runs every `intelCycleEvery` improvement passes — not on every pass (expensive).

async function runIntelCycle(cwd: string): Promise<void> {
  logger.info('[daemon] ── Intel cycle ─────────────────────────────────────────');

  try {
    const { fetchCompetitorIntel, scoreOpportunities, COMPETITOR_REPOS } = await import('../../core/competitor-intel-fetcher.js');
    const { loadMatrix, applyIntelLeaderScores, saveMatrix } = await import('../../core/compete-matrix.js');
    const intelPath = path.join(cwd, '.danteforge', 'compete', 'weakness-intelligence.json');
    const { writeFile, mkdir } = await import('node:fs/promises');

    const toolNames = Object.keys(COMPETITOR_REPOS);
    logger.info(`[daemon] Intel: fetching signals for ${toolNames.length} competitors...`);

    const signals = await fetchCompetitorIntel(toolNames, { githubOnly: true, timeoutMs: 20_000 });
    logger.info(`[daemon] Intel: ${signals.length} signals collected`);

    if (signals.length > 0) {
      const matrix = await loadMatrix(cwd);
      const gaps: Record<string, number> = {};
      for (const dim of matrix?.dimensions ?? []) gaps[dim.id] = dim.gap_to_leader ?? 0;

      const opportunities = scoreOpportunities(signals, gaps);

      const report = { generatedAt: new Date().toISOString(), signals, opportunities };
      await mkdir(path.dirname(intelPath), { recursive: true });
      await writeFile(intelPath, JSON.stringify(report, null, 2), 'utf-8');

      if (matrix) {
        const adjustments = await applyIntelLeaderScores(matrix, intelPath);
        if (adjustments > 0) {
          await saveMatrix(matrix, cwd);
          logger.info(`[daemon] Intel: ${adjustments} leader score(s) evidence-adjusted`);
        }
      }

      if (opportunities[0]) {
        logger.info(`[daemon] Top opportunity: ${opportunities[0].category} (${opportunities[0].dimensionId}) — score ${opportunities[0].opportunityScore.toFixed(1)}`);
      }
    }
  } catch (err) {
    logger.warn(`[daemon] Intel cycle failed (non-fatal): ${(err as Error).message}`);
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runDaemon(options: DaemonOptions = {}): Promise<DaemonResult> {
  const cwd = options.cwd ?? process.cwd();
  const strategy = options.strategy ?? 'adaptive';
  const target = options.target ?? 9.0;
  const timeLimitMs = (options.timeLimitMinutes ?? 240) * 60 * 1000;
  const intervalMs = (options.intervalMinutes ?? 5) * 60 * 1000;
  const runPass = options._runPass ?? defaultRunPass;
  const now = options._now ?? Date.now;

  const intelCycleEvery = options.intelCycleEvery ?? 3;
  const startMs = now();
  const passes: DaemonPassResult[] = [];
  let consecutivePlateau = 0;
  let consecutiveErrors = 0;
  let improvementsSinceIntel = 0;
  let pass = 1;

  logger.info(`[daemon] Starting autonomous improvement loop`);
  logger.info(`[daemon] Strategy: ${strategy} | Target: ${target} | Time limit: ${options.timeLimitMinutes ?? 240}m`);
  logger.info(`[daemon] Log: ${DAEMON_LOG_FILE}`);

  if (options.dryRun) {
    logger.info('[daemon] --dry-run: would run autonomously until target reached or time limit hit');
    return { passes: [], finalScore: 0, targetReached: false, timeLimitReached: false, reason: 'dry-run' };
  }

  await appendLog(cwd, { event: 'start', strategy, target, timeLimitMinutes: options.timeLimitMinutes ?? 240 });

  while (true) {
    const elapsed = now() - startMs;

    if (elapsed >= timeLimitMs) {
      logger.info(`[daemon] Time limit reached (${Math.round(elapsed / 60000)}m elapsed)`);
      const finalScore = await getWeightedScore(cwd);
      await appendLog(cwd, { event: 'stop', reason: 'time-limit', finalScore, passes: passes.length });
      return { passes, finalScore, targetReached: false, timeLimitReached: true, reason: 'time-limit' };
    }

    // Choose strategy for adaptive mode
    const activeStrategy: DaemonStrategy =
      strategy === 'adaptive'
        ? (consecutivePlateau >= 2 ? 'autoresearch' : 'crusade')
        : strategy;

    logger.info(`\n[daemon] ── Pass ${pass} (${activeStrategy}) ──────────────────`);
    const result = await runPass(activeStrategy, cwd);
    result.pass = pass;
    passes.push(result);

    await appendLog(cwd, { event: 'pass', ...result });

    if (result.outcome === 'error') {
      consecutiveErrors++;
      logger.warn(`[daemon] Pass ${pass} error: ${result.error}`);
      if (consecutiveErrors >= 3) {
        const finalScore = result.scoreAfterPass;
        await appendLog(cwd, { event: 'stop', reason: 'consecutive-errors', finalScore, passes: passes.length });
        return { passes, finalScore, targetReached: false, timeLimitReached: false, reason: 'consecutive-errors' };
      }
    } else {
      consecutiveErrors = 0;
    }

    if (result.outcome === 'plateau') {
      consecutivePlateau++;
      logger.info(`[daemon] Plateau ${consecutivePlateau}/3 — score stayed at ${result.scoreAfterPass}`);
    } else if (result.outcome === 'improved') {
      consecutivePlateau = 0;
      improvementsSinceIntel++;
      logger.info(`[daemon] Score: ${result.scoreBeforePass} → ${result.scoreAfterPass} (+${(result.scoreAfterPass - result.scoreBeforePass).toFixed(2)})`);
    }

    // Run intel cycle every N improvements to refresh competitor weakness data
    if (intelCycleEvery > 0 && improvementsSinceIntel > 0 && improvementsSinceIntel % intelCycleEvery === 0) {
      await runIntelCycle(cwd);
      improvementsSinceIntel = 0;
    }

    if (result.scoreAfterPass >= target) {
      logger.info(`[daemon] TARGET REACHED: ${result.scoreAfterPass} >= ${target}`);
      await appendLog(cwd, { event: 'stop', reason: 'target-reached', finalScore: result.scoreAfterPass, passes: passes.length });
      return { passes, finalScore: result.scoreAfterPass, targetReached: true, timeLimitReached: false, reason: 'target-reached' };
    }

    pass++;

    // Interval between passes
    if (intervalMs > 0 && pass > 1) {
      const remaining = timeLimitMs - (now() - startMs);
      const wait = Math.min(intervalMs, remaining);
      if (wait > 0) {
        logger.info(`[daemon] Waiting ${Math.round(wait / 60000)}m before next pass...`);
        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  }
}
