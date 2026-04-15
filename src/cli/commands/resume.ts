// resume — read the AUTOFORGE_PAUSED or ASCEND_PAUSED snapshot and restart the loop
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState } from '../../core/state.js';
import { detectProjectType } from '../../core/completion-tracker.js';
import {
  runAutoforgeLoop,
  AutoforgeLoopState,
  AUTOFORGE_PAUSE_FILE,
  type AutoforgeLoopContext,
  type AutoforgePauseSnapshot,
} from '../../core/autoforge-loop.js';
import {
  runAscend,
  ASCEND_PAUSE_FILE,
  type AscendCheckpoint,
  type AscendEngineOptions,
  type AscendResult,
} from '../../core/ascend-engine.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type UnlinkFn = (p: string) => Promise<void>;
export type RunLoopFn = (ctx: AutoforgeLoopContext) => Promise<AutoforgeLoopContext>;
export type RunAscendFn = (opts: AscendEngineOptions) => Promise<AscendResult>;

export interface ResumeOptions {
  cwd?: string;
  _readFile?: ReadFileFn;
  _unlink?: UnlinkFn;
  _runLoop?: RunLoopFn;
  _runAscend?: RunAscendFn;
}

export async function resumeAutoforge(opts: ResumeOptions = {}): Promise<void> {
  return withErrorBoundary('resume', async () => {
    const cwd = opts.cwd ?? process.cwd();
    const readFile = opts._readFile ?? ((p, enc) => fs.readFile(p, enc));
    const unlink = opts._unlink ?? ((p) => fs.unlink(p));
    const runLoop = opts._runLoop ?? runAutoforgeLoop;
    const runAscendFn = opts._runAscend ?? runAscend;

    // ── Check for ascend checkpoint first ──────────────────────────────────────
    const ascendPausePath = path.join(cwd, ASCEND_PAUSE_FILE);
    let ascendCheckpoint: AscendCheckpoint | null = null;
    try {
      const raw = await readFile(ascendPausePath, 'utf8');
      ascendCheckpoint = JSON.parse(raw) as AscendCheckpoint;
    } catch {
      // no ascend checkpoint — fall through to autoforge check
    }

    if (ascendCheckpoint) {
      logger.success('[Resume] Resuming ascend from checkpoint');
      logger.info(`  Paused at cycle: ${ascendCheckpoint.cyclesRun}/${ascendCheckpoint.maxCycles}`);
      logger.info(`  Paused on dimension: ${ascendCheckpoint.currentDimension}`);
      // runAscend auto-loads the checkpoint via _loadCheckpoint default
      await runAscendFn({ cwd, target: ascendCheckpoint.target, maxCycles: ascendCheckpoint.maxCycles });
      return;
    }

    // ── Check for autoforge pause snapshot ────────────────────────────────────
    const pauseFilePath = path.join(cwd, AUTOFORGE_PAUSE_FILE);

    // Read and parse pause snapshot
    let snapshot: AutoforgePauseSnapshot;
    try {
      const raw = await readFile(pauseFilePath, 'utf8');
      snapshot = JSON.parse(raw) as AutoforgePauseSnapshot;
    } catch {
      logger.error('[Resume] No pause file found. Run `danteforge autoforge --auto` or `danteforge ascend` to start.');
      return;
    }

    logger.success('[Resume] Resuming autoforge from pause snapshot');
    logger.info(`  Paused at score: ${snapshot.avgScore}`);
    logger.info(`  Cycle count: ${snapshot.cycleCount}`);
    logger.info(`  Goal: ${snapshot.goal}`);

    // Delete pause file before restarting
    try {
      await unlink(pauseFilePath);
    } catch {
      // Non-fatal — if delete fails, still proceed
    }

    // Load current state
    const state = await loadState({ cwd });
    const isWebProject = ((state.projectType ?? 'unknown') === 'web') ||
      (await detectProjectType(cwd)) === 'web';

    // Reconstruct context from snapshot
    const ctx: AutoforgeLoopContext = {
      goal: snapshot.goal,
      cwd,
      state,
      loopState: AutoforgeLoopState.IDLE,
      cycleCount: snapshot.cycleCount,
      startedAt: new Date().toISOString(),
      retryCounters: snapshot.retryCounters,
      blockedArtifacts: snapshot.blockedArtifacts,
      lastGuidance: null,
      isWebProject,
      force: false,
      maxRetries: 10,  // Must be > number of pipeline stages (5) to avoid premature BLOCKED
      recentScores: [],
    };

    logger.info('[Resume] Restarting convergence loop...');
    await runLoop(ctx);
  });
}
