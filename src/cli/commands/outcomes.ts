// outcomes.ts — Run declared outcomes for matrix dimensions (Phase G).
//
// Operator-facing entry to the outcome-derived scoring system. Each dim declares
// outcomes in matrix.json; this command runs them, writes per-outcome evidence
// files, and reports the derived score for each dim.

import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { runAllOutcomes, loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import { computeDerivedScoreWithBreakdown, hasOutcomes, type DimensionForScoring } from '../../core/derived-score.js';
import type { Outcome } from '../../matrix/types/outcome.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunOutcomesCliOptions {
  cwd?: string;
  dim?: string;
  tier?: string;
  forceCold?: boolean;
  json?: boolean;
  status?: boolean;            // skip execution; just read cached evidence and report
  _loadMatrix?: typeof loadMatrix;
}

// ── Status mode: don't run, just report ──────────────────────────────────────

async function runStatusMode(opts: RunOutcomesCliOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const loadMatrixFn = opts._loadMatrix ?? loadMatrix;
  const matrix = await loadMatrixFn(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);

  const evidence = await loadOutcomeEvidence(cwd);
  const rows: Array<{ dim: string; declared: number; passing: number; score: number; tier: string | null }> = [];

  for (const dim of matrix.dimensions) {
    const dfs: DimensionForScoring = {
      id: dim.id,
      outcomes: (dim as unknown as Record<string, unknown>)['outcomes'] as Outcome[] | undefined,
      declared_ceiling: (dim as unknown as Record<string, unknown>)['declared_ceiling'] as DimensionForScoring['declared_ceiling'],
      legacy_score: dim.scores.self,
      scores: dim.scores,
    };
    const breakdown = computeDerivedScoreWithBreakdown(dfs, evidence);
    const declared = (dfs.outcomes ?? []).length;
    const passing = breakdown.perTier.reduce((s, r) => s + r.passing, 0);
    rows.push({
      dim: dim.id,
      declared,
      passing,
      score: breakdown.score,
      tier: breakdown.highestFullPassedTier,
    });
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ cwd, evidenceCount: evidence.size, rows }, null, 2) + '\n');
    return;
  }

  logger.info('');
  logger.info(chalk.bold('Outcome Status'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info(`  ${chalk.bold('Evidence files loaded:')} ${evidence.size}`);
  logger.info('');
  for (const r of rows) {
    if (r.declared === 0) {
      logger.info(`  ${chalk.dim('·')} ${r.dim.padEnd(30)} ${chalk.dim('(no outcomes declared; legacy score)')} ${chalk.dim(r.score.toString())}`);
      continue;
    }
    const tier = r.tier ?? chalk.red('—');
    const colorScore = r.score >= 6 ? chalk.green(r.score.toString()) : r.score >= 4 ? chalk.yellow(r.score.toString()) : chalk.red(r.score.toString());
    logger.info(`  ${chalk.cyan('●')} ${r.dim.padEnd(30)} ${colorScore.padEnd(4)}  ${chalk.dim(`(${r.passing}/${r.declared} outcomes, highest=${tier})`)}`);
  }
  logger.info('');
}

// ── Main: run outcomes ──────────────────────────────────────────────────────

export async function runOutcomesCli(opts: RunOutcomesCliOptions = {}): Promise<void> {
  if (opts.status) return runStatusMode(opts);

  const cwd = opts.cwd ?? process.cwd();
  const loadMatrixFn = opts._loadMatrix ?? loadMatrix;
  const matrix = await loadMatrixFn(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);

  // Extract per-dim outcomes (the field is currently optional and unknown to MatrixDimension type)
  const dims = matrix.dimensions.map(d => ({
    id: d.id,
    outcomes: (d as unknown as Record<string, unknown>)['outcomes'] as Outcome[] | undefined,
  }));
  const dimsWithOutcomes = dims.filter(d => d.outcomes && d.outcomes.length > 0);

  if (dimsWithOutcomes.length === 0) {
    logger.warn('No dimensions declare outcomes yet.');
    logger.info('Migration path: edit .danteforge/compete/matrix.json to add an `outcomes` array per dim.');
    logger.info('Each outcome has: { id, tier, description, command }. See ~/.claude/plans/dapper-hatching-aurora.md');
    return;
  }

  logger.info('');
  logger.info(chalk.bold(`Running outcomes — ${dimsWithOutcomes.length} dim(s) declared`));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info('');

  const result = await runAllOutcomes({
    cwd,
    dimensions: dimsWithOutcomes,
    dim: opts.dim,
    tier: opts.tier,
    forceCold: opts.forceCold,
    _onProgress: (msg) => logger.info(`  ${chalk.dim('•')} ${chalk.dim(msg)}`),
  });

  logger.info('');
  logger.info(chalk.bold('Outcome Run Summary'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info(`  ${chalk.bold('Total outcomes:')}  ${result.totalOutcomes}`);
  logger.info(`  ${chalk.green('Passing:')}         ${result.passingOutcomes}`);
  logger.info(`  ${chalk.red('Failing:')}         ${result.failingOutcomes}`);
  logger.info('');

  // Compute derived score per dim.
  // NOTE: loadMatrix has already replaced dim.scores.self with the previously-derived
  // value and preserved the original writable score at dim.legacy_score. So the
  // "writable" history is `legacy_score`, and we re-derive `scores.self` from
  // the just-produced evidence to show what the new derived value will be.
  const perDimScores: Array<{ dim: string; writable: number; derived: number; delta: number; tier: string | null }> = [];
  for (const dim of matrix.dimensions) {
    const writableAgentScore = ((dim as unknown as Record<string, unknown>)['legacy_score'] as number | undefined)
      ?? dim.scores.self;
    const dfs: DimensionForScoring = {
      id: dim.id,
      outcomes: (dim as unknown as Record<string, unknown>)['outcomes'] as Outcome[] | undefined,
      declared_ceiling: (dim as unknown as Record<string, unknown>)['declared_ceiling'] as DimensionForScoring['declared_ceiling'],
      legacy_score: writableAgentScore,
      scores: { self: writableAgentScore },
    };
    if (!hasOutcomes(dfs)) continue;
    const breakdown = computeDerivedScoreWithBreakdown(dfs, result.evidence);
    perDimScores.push({
      dim: dim.id,
      writable: writableAgentScore,
      derived: breakdown.score,
      delta: breakdown.score - writableAgentScore,
      tier: breakdown.highestFullPassedTier,
    });
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      cwd,
      summary: {
        totalOutcomes: result.totalOutcomes,
        passingOutcomes: result.passingOutcomes,
        failingOutcomes: result.failingOutcomes,
      },
      perDimension: result.perDimension,
      derivedScores: perDimScores,
    }, null, 2) + '\n');
    return;
  }

  logger.info(chalk.bold(`Per-dimension derived scores:`));
  for (const r of perDimScores) {
    const delta = r.delta.toFixed(1);
    const color = r.delta >= 0 ? chalk.green : chalk.red;
    const sign = r.delta >= 0 ? '+' : '';
    const tier = r.tier ?? chalk.red('—');
    logger.info(`  ${r.dim.padEnd(30)} writable=${chalk.dim(r.writable.toFixed(1))} derived=${chalk.cyan(r.derived.toFixed(1))} (${color(sign + delta)}, tier=${tier})`);
  }
  logger.info('');

  if (result.failingOutcomes > 0) process.exitCode = 1;
}
