// CLI — council frontier-loop command
//
// Runs the continuous quality ratchet: research → build → verify → confirm → loop.
// Claude Code builds. Codex researches + confirms. Grok verifies (minimal usage).
// Loops until all dims reach targetScore or maxIterations exhausted.
//
// Usage: danteforge council --frontier-loop [options]
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { runFrontierLoop } from '../../matrix/engines/council-frontier-loop.js';
import type { FrontierLoopOptions } from '../../matrix/engines/council-frontier-loop.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';

export interface FrontierLoopCLIOptions {
  cwd?: string;
  goal?: string;
  target?: number;
  maxIterations?: number;
  builder?: string;
  researchers?: string;
  verifier?: string;
  confirmer?: string;
  ossHarvestPath?: string;
  skipResearch?: boolean;
  skipValidate?: boolean;
  minGap?: number;
  json?: boolean;
}

const VALID_MEMBERS: CouncilMemberId[] = ['claude-code', 'codex', 'grok-build', 'gemini-cli'];

function parseMemberId(s: string, field: string): CouncilMemberId {
  const id = s.trim() as CouncilMemberId;
  if (!VALID_MEMBERS.includes(id)) {
    throw new Error(`Invalid ${field} "${s}". Must be one of: ${VALID_MEMBERS.join(', ')}`);
  }
  return id;
}

function parseMemberIds(s: string, field: string): CouncilMemberId[] {
  return s.split(',').map(p => parseMemberId(p, field));
}

export async function runFrontierLoopCommand(opts: FrontierLoopCLIOptions): Promise<void> {
  const projectPath = opts.cwd ?? process.cwd();

  const loopOpts: FrontierLoopOptions = {
    projectPath,
    goal: opts.goal,
    targetScore: opts.target ?? 9.0,
    maxIterations: opts.maxIterations ?? 100,
    builder: opts.builder ? parseMemberId(opts.builder, '--builder') : 'claude-code',
    researchers: opts.researchers ? parseMemberIds(opts.researchers, '--researchers') : ['codex', 'grok-build'],
    verifier: opts.verifier ? parseMemberId(opts.verifier, '--verifier') : 'grok-build',
    confirmer: opts.confirmer ? parseMemberId(opts.confirmer, '--confirmer') : 'codex',
    ossHarvestPath: opts.ossHarvestPath ?? 'X:\\Projects\\OSSHarvest',
    skipResearch: opts.skipResearch ?? false,
    skipValidate: opts.skipValidate ?? false,
    minGap: opts.minGap ?? 0,
  };

  logger.info(chalk.bold('\n╔══════════════════════════════════════════════╗'));
  logger.info(chalk.bold('║       COUNCIL FRONTIER LOOP                  ║'));
  logger.info(chalk.bold('╠══════════════════════════════════════════════╣'));
  logger.info(`║  Project:    ${projectPath.slice(-38).padEnd(38)}║`);
  logger.info(`║  Target:     ${String(loopOpts.targetScore).padEnd(38)}║`);
  logger.info(`║  Builder:    ${String(loopOpts.builder).padEnd(38)}║`);
  logger.info(`║  Verifier:   ${String(loopOpts.verifier).padEnd(38)}║`);
  logger.info(`║  Confirmer:  ${String(loopOpts.confirmer).padEnd(38)}║`);
  logger.info(chalk.bold('╚══════════════════════════════════════════════╝\n'));

  const result = await runFrontierLoop(loopOpts);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // Human-readable summary
  logger.info(chalk.bold('\n═══ FRONTIER LOOP SUMMARY ═══'));
  logger.info(`Stopped: ${result.stoppedReason}`);
  logger.info(`Total iterations: ${result.iterations.length}`);

  const passed = result.iterations.filter(i => i.verdict === 'PASS');
  const failed = result.iterations.filter(i => i.verdict === 'FAIL');
  const errored = result.iterations.filter(i => i.verdict === 'ERROR');

  logger.info(`Results: ${chalk.green(`${passed.length} PASS`)} / ${chalk.red(`${failed.length} FAIL`)} / ${chalk.dim(`${errored.length} ERROR`)}`);

  if (result.dimsReachedTarget.length > 0) {
    logger.info(chalk.green(`\nDims reached ${loopOpts.targetScore}+:`));
    result.dimsReachedTarget.forEach(id => logger.info(chalk.green(`  ✓ ${id}`)));
  }

  if (result.dimsRemaining.length > 0) {
    logger.info(chalk.yellow(`\nDims still below target:`));
    result.dimsRemaining.forEach(id => {
      const score = result.finalScores[id] ?? '?';
      logger.info(chalk.yellow(`  · ${id}: ${score}`));
    });
  }

  if (result.stoppedReason === 'ALL_DONE') {
    logger.info(chalk.bold(chalk.green('\n🎯 All dimensions reached the frontier!')));
  } else if (result.stoppedReason === 'MAX_ITERATIONS') {
    logger.info(chalk.yellow(`\nMax iterations (${loopOpts.maxIterations}) reached. Run again to continue.`));
  }
}
