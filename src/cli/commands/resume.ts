// resume — read the AUTOFORGE_PAUSED snapshot and restart the convergence loop
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
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type UnlinkFn = (p: string) => Promise<void>;
export type RunLoopFn = (ctx: AutoforgeLoopContext) => Promise<AutoforgeLoopContext>;

export interface ResumeOptions {
  cwd?: string;
  _readFile?: ReadFileFn;
  _unlink?: UnlinkFn;
  _runLoop?: RunLoopFn;
}

export async function resumeAutoforge(opts: ResumeOptions = {}): Promise<void> {
  return withErrorBoundary('resume', async () => {
    const cwd = opts.cwd ?? process.cwd();
    const readFile = opts._readFile ?? ((p, enc) => fs.readFile(p, enc));
    const unlink = opts._unlink ?? ((p) => fs.unlink(p));
    const runLoop = opts._runLoop ?? runAutoforgeLoop;

    const pauseFilePath = path.join(cwd, AUTOFORGE_PAUSE_FILE);

    // Read and parse pause snapshot
    let snapshot: AutoforgePauseSnapshot;
    try {
      const raw = await readFile(pauseFilePath, 'utf8');
      snapshot = JSON.parse(raw) as AutoforgePauseSnapshot;
    } catch {
      logger.error('[Resume] No pause file found. Run `danteforge autoforge --auto` to start.');
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

      lastGuidance: null,
      isWebProject,
      force: false,
      maxRetries: 3,
    };

    logger.info('[Resume] Restarting convergence loop...');
    await runLoop(ctx);
  });
}
