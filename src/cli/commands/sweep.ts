// sweep — `danteforge sweep`: the single entry point for the staged frontier campaign. Wires the thin
// sweep-orchestrator to the real executors (dim-dispatch → depth-wave → ascend-frontier) and caps the
// autonomous target at 9.0. --dry-run prints the band snapshot + phase plan without touching anything.

import fs from 'fs/promises';
import { spawn } from 'node:child_process';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { loadMatrix, saveMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { resolveAutonomousTarget } from '../../core/autonomy-cap.js';
import { snapshotBands, bandCounts } from '../../core/dim-band.js';
import { runFullSweep, type SweepDeps, type SweepResult } from '../../core/sweep-orchestrator.js';
import { runDepthWave } from '../../core/depth-wave.js';
import { NEEDS_SHELL, splitCommand } from '../../core/autoresearch-engine.js';

interface SweepOptions {
  target?: number;
  pilotSize?: number;
  dryRun?: boolean;
  json?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _deps?: SweepDeps;
}

const CLI = (): string => process.argv[1] ?? 'dist/index.js';
const freshLoad = (cwd: string) => loadMatrix(cwd, (p) => fs.readFile(p, 'utf8')); // bypass cache → fresh derived

export async function sweep(opts: SweepOptions = {}): Promise<void> {
  return withErrorBoundary('sweep', async () => {
    const cwd = process.cwd();
    const target = resolveAutonomousTarget(opts.target, 9.0);
    const loadMatrixFn = opts._loadMatrix ?? freshLoad;

    const matrix = await loadMatrixFn(cwd);
    if (!matrix) { logger.error('No competitive matrix found. Run `danteforge compete` first.'); process.exitCode = 1; return; }

    const before = bandCounts(snapshotBands(matrix));
    logger.success(`DanteForge Sweep — staged frontier campaign (target ${target})`);
    logger.info(`Bands: below5=${before.below5}  5→7=${before.fiveToSeven}  7→9=${before.sevenToNine}  done=${before.done}`);

    if (opts.dryRun) {
      logger.info('--- Plan (hybrid breadth-first) ---');
      if (before.below5 > 0) logger.info(`  Phase 1: dispatch ${before.below5} below-5 dim(s) to 5.0`);
      if (target > 5 && before.fiveToSeven > 0) logger.info(`  Phase 2-3: pilot then sweep ${before.fiveToSeven} dim(s) 5→7 via depth-wave`);
      if (target > 7 && before.sevenToNine > 0) logger.info(`  Phase 4: delegate ${before.sevenToNine} dim(s) 7→9 to ascend-frontier`);
      logger.info('--dry-run: no execution.');
      if (opts.json) process.stdout.write(JSON.stringify({ target, bands: before }, null, 2) + '\n');
      return;
    }

    const result = await runFullSweep(cwd, { target, pilotSize: opts.pilotSize }, opts._deps ?? defaultSweepDeps());
    reportSweep(result);
    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  });
}

function defaultSweepDeps(): SweepDeps {
  return {
    loadMatrix: freshLoad,
    runDispatch: async (_cwd, t) => { const { dimDispatch } = await import('./dim-dispatch.js'); await dimDispatch({ target: t }); },
    runDepthWave: async (cwd, dimId) => {
      const r = await runDepthWave(cwd, dimId, {
        runValidate: (c, id) => spawnCli(['validate', id], c),
        loadMatrix: freshLoad,
        saveMatrix: (m, c) => saveMatrix(m, c),
        capabilityTestPassed: capabilityTestPassed,
      });
      return { promoted: r.promoted };
    },
    runAscendFrontier: async (cwd) => { const { runAscendFrontier } = await import('./ascend-frontier.js'); await runAscendFrontier({ cwd }); },
  };
}

function reportSweep(r: SweepResult): void {
  logger.info('');
  logger.success('=== Sweep complete ===');
  logger.info(`  Phases: ${r.phasesRun.join(' → ') || '(none)'}`);
  logger.info(`  Before: below5=${r.bandsBefore.below5} 5→7=${r.bandsBefore.fiveToSeven} 7→9=${r.bandsBefore.sevenToNine} done=${r.bandsBefore.done}`);
  logger.info(`  After:  below5=${r.bandsAfter.below5} 5→7=${r.bandsAfter.fiveToSeven} 7→9=${r.bandsAfter.sevenToNine} done=${r.bandsAfter.done}`);
  if (r.stoppedEarly) logger.warn(`  Stopped early: ${r.stoppedEarly}`);
}

// ── default real execution helpers ──────────────────────────────────────────────

function spawnCli(args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [CLI(), ...args], { cwd, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

async function capabilityTestPassed(cwd: string, dimId: string): Promise<boolean> {
  const matrix = await freshLoad(cwd);
  const dim = matrix?.dimensions.find(d => d.id === dimId) as (undefined | { capability_test?: { command?: string } });
  const command = dim?.capability_test?.command;
  if (!command) return false;
  return new Promise<boolean>((resolve) => {
    let file: string; let args: string[];
    if (NEEDS_SHELL.test(command)) {
      if (process.platform === 'win32') { file = process.env.ComSpec || 'cmd.exe'; args = ['/d', '/s', '/c', command]; }
      else { file = '/bin/sh'; args = ['-c', command]; }
    } else { const parts = splitCommand(command); file = parts[0] ?? ''; args = parts.slice(1); }
    if (!file) { resolve(false); return; }
    const child = spawn(file, args, { cwd, stdio: 'ignore', windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
