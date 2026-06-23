// finish.ts — `danteforge finish`: report each dimension's status against its HONEST ceiling, and whether the
// project is FINISHED. The operator's dashboard for finishing a project to its honest frontier (council 2026-06-23)
// instead of perpetually reading every <9 as failure. Read-only — it does NOT stamp ceilings (that stays gated on
// harden-green + a validate receipt elsewhere). Reuses gap's canonical per-dim scores so the numbers match.

import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import { runGapCli } from './gap.js';
import { dimFinishStatus, type DimFinishInput, type DimFinishStatus } from '../../core/finish-ceiling.js';

export interface FinishCliOptions {
  cwd?: string;
  json?: boolean;
  _loadMatrix?: typeof loadMatrix;
  /** Injected gap scorer (tests supply controlled per-dim scores). */
  _runGap?: typeof runGapCli;
  /** Injected "a harvest ran" probe (tests control demand-observed-ness). */
  _harvestAttempted?: boolean;
}

export interface FinishCliResult {
  finished: boolean;
  doneCount: number;
  total: number;
  unobservedCount: number;
  perDim: DimFinishStatus[];
}

export async function runFinishCli(options: FinishCliOptions = {}): Promise<FinishCliResult> {
  const cwd = options.cwd ?? process.cwd();
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const matrix = await loadMatrixFn(cwd);
  if (!matrix) {
    logger.info(chalk.yellow('No matrix found — run `danteforge compete status` or `danteforge matrix-orchestrate detect` first.'));
    return { finished: false, doneCount: 0, total: 0, unobservedCount: 0, perDim: [] };
  }

  // demandBound per dim: a demand-grounded frontier_spec (evidence_ref carries `harvest-demand:`). A competitor-
  // grounded or absent spec is NOT demand-bound → its honest ceiling is 8.0 (the autonomous build-complete).
  const demandBound = new Map<string, boolean>();
  for (const d of matrix.dimensions) {
    const ref = (d as { frontier_spec?: { leader_target?: { evidence_ref?: string } } }).frontier_spec?.leader_target?.evidence_ref ?? '';
    demandBound.set(d.id, /(?:^|;)\s*harvest-demand:/.test(ref));
  }
  // "No demand" is honest ONLY when a harvest actually RAN (the backlog exists) — else it's an unobserved claim.
  const harvestAttempted = options._harvestAttempted ?? existsSync(join(cwd, '.danteforge', 'demand-backlog.json'));

  const runGapFn = options._runGap ?? runGapCli;
  const gap = await runGapFn({ all: true, cwd, _loadMatrix: loadMatrixFn, _quiet: true });
  const inputs: DimFinishInput[] = gap.dimensions.map(a => ({
    id: a.dimensionId,
    score: a.currentScore,
    demandBound: demandBound.get(a.dimensionId) ?? false,
    demandHarvestAttempted: harvestAttempted,
  }));
  const perDim = inputs.map(dimFinishStatus);
  const doneCount = perDim.filter(d => d.finished).length;
  const unobservedCount = perDim.filter(d => d.unobservedNoDemand).length;
  const finished = perDim.length > 0 && doneCount === perDim.length && unobservedCount === 0;
  const result: FinishCliResult = { finished, doneCount, total: perDim.length, unobservedCount, perDim };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  logger.info('');
  logger.info(chalk.bold('── FINISH STATUS — each dimension vs its HONEST ceiling ──'));
  for (const d of [...perDim].sort((a, b) => Number(a.finished) - Number(b.finished) || a.gap - b.gap)) {
    const mark = d.finished ? chalk.green('✓ FINISHED') : chalk.yellow(`▶ ${d.gap.toFixed(1)} to go`);
    const prof = d.profile === 'market-capped' ? 'market→5.0' : d.profile === 'demand-frontier' ? 'demand→9.0' : 'build→8.0';
    const warn = d.unobservedNoDemand ? chalk.red('  ⚠ run harvest-demand to OBSERVE no-demand') : '';
    logger.info(`  ${chalk.bold(d.dimId.padEnd(28))} ${d.score.toFixed(1)} / ${d.target.toFixed(1)}  [${prof}]  ${mark}${warn}`);
  }
  logger.info('');
  if (finished) {
    logger.info(chalk.green.bold(`✓ PROJECT FINISHED — all ${perDim.length} dims at their honest ceiling.`));
  } else {
    const reasons: string[] = [];
    if (doneCount < perDim.length) reasons.push(`${perDim.length - doneCount} below their honest ceiling`);
    if (unobservedCount > 0) reasons.push(`${unobservedCount} claim no-demand without a harvest (run harvest-demand first)`);
    logger.info(chalk.yellow.bold(`▶ IN PROGRESS — ${doneCount}/${perDim.length} finished; ${reasons.join('; ')}.`));
  }
  logger.info(chalk.dim('  build→8.0 = BUILD-COMPLETE (terminal success); demand→9.0 needs bound demand'));
  logger.info(chalk.dim('  (dogfood: file a dated issue → harvest-demand → demand-satisfaction court); market→5.0 is capped.'));
  return result;
}
