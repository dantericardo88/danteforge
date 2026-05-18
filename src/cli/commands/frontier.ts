// frontier.ts — Phase H Slice 4b.
//
// Reports the project's frontier state: a boolean conjunction per dimension,
// rolled up to one of {frontier-reached, stuck-on-dims, blocked-by-dispensations,
// progressing}. This is the substrate's terminal-state report — what crusade
// will return as its win condition after Phase H Slice 5.

import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import {
  computeProjectFrontierState,
  type DimensionFrontierResult,
} from '../../core/frontier-state.js';
import type { Outcome } from '../../matrix/types/outcome.js';
import type { CapabilityTier } from '../../matrix/types/capability-test.js';

export interface RunFrontierOptions {
  cwd?: string;
  json?: boolean;
  /** Filter to one dim. */
  dim?: string;
  /** Custom waves-threshold for stuck detection (default 3). */
  stuckThreshold?: number;
  _loadMatrix?: typeof loadMatrix;
}

const DISPENSATION_DIR = path.join('.danteforge', 'score-proposals', 'dispensations');

async function loadDispensations(cwd: string): Promise<Record<string, string[]>> {
  const dir = path.join(cwd, DISPENSATION_DIR);
  let entries: string[];
  try { entries = await fs.readdir(dir); } catch { return {}; }
  const map: Record<string, string[]> = {};
  for (const f of entries.filter(n => n.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const parsed = JSON.parse(raw) as { dimensionId?: string; receiptId?: string; cleared?: boolean };
      if (parsed.cleared) continue;
      const dimId = parsed.dimensionId;
      if (!dimId) continue;
      const list = map[dimId] ?? [];
      list.push(parsed.receiptId ?? f.replace(/\.json$/, ''));
      map[dimId] = list;
    } catch { /* skip */ }
  }
  return map;
}

async function loadWavesSinceProgress(cwd: string): Promise<Record<string, number>> {
  // Best-effort: read STATE.yaml if it has outcomeRefinementCounts (Phase H Slice 5 field).
  // Until then, return empty — every dim has 0 waves recorded.
  void cwd;
  return {};
}

function statusColor(status: DimensionFrontierResult['status']): (s: string) => string {
  switch (status) {
    case 'at-frontier': return chalk.green;
    case 'progressing': return chalk.cyan;
    case 'stuck': return chalk.red;
    case 'blocked-by-dispensation': return chalk.yellow;
    case 'no-outcomes-declared': return chalk.dim;
  }
}

export async function runFrontierCommand(options: RunFrontierOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const matrix = await loadMatrixFn(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);

  const evidence = await loadOutcomeEvidence(cwd);
  const dispensations = await loadDispensations(cwd);
  const wavesSinceProgress = await loadWavesSinceProgress(cwd);

  const dims = matrix.dimensions
    .filter(d => !options.dim || d.id === options.dim)
    .map(d => ({
      id: d.id,
      outcomes: (d as unknown as Record<string, unknown>)['outcomes'] as Outcome[] | undefined,
      declared_ceiling: (d as unknown as Record<string, unknown>)['declared_ceiling'] as CapabilityTier | undefined,
      scores: d.scores,
      legacy_score: (d as unknown as Record<string, unknown>)['legacy_score'] as number | undefined,
    }));

  const state = computeProjectFrontierState({
    dimensions: dims,
    evidence,
    wavesSinceProgress,
    dispensations,
    stuckThreshold: options.stuckThreshold,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    if (state.terminal === 'frontier-reached') process.exitCode = 0;
    else process.exitCode = 1;
    return;
  }

  // Human display
  logger.info('');
  logger.info(chalk.bold('Project Frontier State'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info('');

  const terminalColor =
    state.terminal === 'frontier-reached' ? chalk.green :
    state.terminal === 'stuck-on-dims' ? chalk.red :
    state.terminal === 'blocked-by-dispensations' ? chalk.yellow :
    chalk.cyan;
  logger.info(`  ${chalk.bold('Terminal state:')} ${terminalColor(state.terminal)}`);
  logger.info(`  ${chalk.dim(state.summary)}`);
  logger.info('');

  // Per-dim table
  for (const r of state.perDimension) {
    const colorFn = statusColor(r.status);
    const tier = r.highestPassedTier ?? '—';
    const ceiling = r.declaredCeiling ?? '(none)';
    logger.info(`  ${colorFn('●')} ${r.dimensionId.padEnd(28)} ${colorFn(r.status.padEnd(24))} score=${chalk.dim(r.derivedScore.toFixed(1))} tier=${chalk.dim(tier)}/${chalk.dim(ceiling)}`);
    if (r.status !== 'at-frontier' && r.status !== 'no-outcomes-declared') {
      logger.info(`      ${chalk.dim(r.reason)}`);
    }
  }
  logger.info('');

  // Help footer
  if (state.terminal === 'blocked-by-dispensations') {
    logger.info(chalk.yellow(`  Action: clear dispensations with \`danteforge dispensation clear\` (Phase H Slice 6 — pending CLI; for now remove files from ${DISPENSATION_DIR}).`));
  } else if (state.terminal === 'stuck-on-dims') {
    logger.info(chalk.red(`  Action: review stuck dims (${state.stuckDims.join(', ')}). Either the outcome design is wrong or the capability is genuinely hard.`));
  } else if (state.terminal === 'progressing') {
    logger.info(chalk.cyan(`  Next: run \`danteforge outcomes\` to refresh evidence, or \`danteforge crusade\` to push toward frontier.`));
  } else if (state.terminal === 'frontier-reached') {
    logger.info(chalk.green(`  Done. Every eligible dim is at frontier. Time to use the system on real work for a while.`));
  }
  logger.info('');

  if (state.terminal !== 'frontier-reached') process.exitCode = 1;
}
