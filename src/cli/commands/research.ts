// research.ts — `danteforge research ...` command surface.
//
// Phase N-Q of docs/PRDs/autonomous-frontier-reaching.md. Three READ-ONLY
// subcommands (status, history, caps) plus two REFUSAL subcommands (resolve,
// replay) which surface a clear "Phase O orchestration not yet shipped" error
// to honor PRD invariant I7 (stop conditions are mandatory, not silently
// worked around).
//
// When Phase O parallel agent execution and Phase P synthesis ship in future
// sessions, the refusal subcommands become real handlers without changing
// the CLI shape.

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import {
  getPriorResearch,
  getResearchSummary,
  getStructuralCaps,
} from '../../matrix/research/research-history.js';

export interface ResearchCommandOptions {
  cwd?: string;
  json?: boolean;
}

// ── status ───────────────────────────────────────────────────────────────────

export async function runResearchStatus(opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const summary = await getResearchSummary(cwd);
  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold('Research status'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info(`  Total waves:       ${summary.totalWaves}`);
  logger.info(`  Promoted:          ${summary.byOutcome.promote}`);
  logger.info(`  Capped:            ${summary.byOutcome.cap} (${summary.capDims.length} dim(s))`);
  logger.info(`  Conflict pending:  ${summary.byOutcome.conflict}`);
  logger.info(`  In-progress:       ${summary.byOutcome['in-progress']}`);
  if (summary.totalWaves === 0) {
    logger.info('');
    logger.info(chalk.dim('No research waves have run yet. Phase O orchestration is not yet shipped — see docs/PRDs/autonomous-frontier-reaching.md section 6.'));
  }
}

// ── history <dimensionId> ────────────────────────────────────────────────────

export async function runResearchHistory(dimensionId: string, opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const waves = await getPriorResearch(cwd, dimensionId);
  if (opts.json) {
    process.stdout.write(JSON.stringify(waves, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold(`Research history — ${dimensionId}`));
  logger.info(chalk.dim('─'.repeat(60)));
  if (waves.length === 0) {
    logger.info(chalk.dim(`No prior research waves for "${dimensionId}".`));
    return;
  }
  for (const w of waves) {
    logger.info(`  ${chalk.cyan(w.waveId)}  ${chalk.bold(w.outcome ?? 'unknown')}  ${chalk.dim(w.startedAt)}`);
    if (w.reason) logger.info(`    ${chalk.dim(w.reason)}`);
  }
}

// ── caps ─────────────────────────────────────────────────────────────────────

export async function runResearchCaps(opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const caps = await getStructuralCaps(cwd);
  if (opts.json) {
    process.stdout.write(JSON.stringify(caps, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold('Structurally capped dimensions'));
  logger.info(chalk.dim('─'.repeat(60)));
  if (caps.length === 0) {
    logger.info(chalk.dim('No dims currently capped by research wave outcome.'));
    return;
  }
  for (const c of caps) {
    logger.info(`  ${chalk.yellow('▲')} ${chalk.bold(c.dimensionId)}`);
    logger.info(`    ${chalk.dim(c.reason)}`);
  }
}

// ── resolve <wave-id> (refusal — Phase O not yet shipped) ───────────────────

export async function runResearchResolve(waveId: string, _opts: ResearchCommandOptions = {}): Promise<void> {
  void waveId; void _opts;
  throw new Error(
    'research resolve: Phase P operator-resolution path is not yet shipped. ' +
    'Phase O (parallel agent execution) must complete first. ' +
    'See docs/PRDs/autonomous-frontier-reaching.md sections 6-7.',
  );
}

// ── replay <wave-id> (refusal — Phase O not yet shipped) ────────────────────

export async function runResearchReplay(waveId: string, _opts: ResearchCommandOptions = {}): Promise<void> {
  void waveId; void _opts;
  throw new Error(
    'research replay: Phase O wave-replay infrastructure is not yet shipped. ' +
    'Once parallel agent execution lands, this command will reconstruct a wave from its artifacts. ' +
    'See docs/PRDs/autonomous-frontier-reaching.md section 6.',
  );
}
