// evaluate.ts — run a dimension's CONTINUOUS graded evaluator and report the score.
//
//   danteforge evaluate <dim> [--json]
//
// This is the operator-facing surface of the frontier loop fix (graded-evaluator.ts): instead of a binary
// capability_test, a dimension declares a `graded_evaluator` command that prints a final OpenEvolve-style
// verdict line — {"combined_score": 0..1, "metrics": {...}, "artifacts": {...}}. The build loop CLIMBS that
// score (dispatch the builder while score < target, keep the best); its artifacts ARE the T5 evidence; the
// court reads the same score. `evaluate` runs that loop's signal once so you can see exactly what the builder
// is climbing toward — the missing continuous bar that kept dims plateaued below 7.

import path from 'node:path';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { runGradedEvaluator, type EvaluationResult } from '../../core/graded-evaluator.js';
import { logger } from '../../core/logger.js';

export interface EvaluateCliOptions {
  dimId: string;
  cwd?: string;
  json?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _run?: (command: string, cwd: string, timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export async function runEvaluateCli(options: EvaluateCliOptions): Promise<EvaluationResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const matrix = await (options._loadMatrix ?? loadMatrix)(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');
  const dim = matrix.dimensions.find(d => d.id === options.dimId);
  if (!dim) throw new Error(`Dimension "${options.dimId}" not found in matrix.`);

  const command = (dim as unknown as { graded_evaluator?: string }).graded_evaluator;
  if (!command || !command.trim()) {
    const reason = `"${options.dimId}" has no graded_evaluator. Declare a "graded_evaluator" command on the dim whose final stdout line is {"combined_score": 0..1, "metrics": {...}, "artifacts": {...}} (OpenEvolve contract) — that continuous score is what the build loop climbs, and its artifacts are the evidence.`;
    logger.warn(`[evaluate] ${reason}`);
    const result: EvaluationResult = { combinedScore: 0, metrics: {}, artifacts: {}, ran: false, reason };
    if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  logger.info(`[evaluate] ${options.dimId}: running graded evaluator — ${command}`);
  const result = await runGradedEvaluator(command, cwd, { _run: options._run });
  if (result.ran) {
    logger.success(`[evaluate] ${options.dimId}: combined_score = ${result.combinedScore.toFixed(3)}`);
    const subs = Object.entries(result.metrics);
    if (subs.length) logger.info(`  metrics: ${subs.map(([k, v]) => `${k}=${v}`).join('  ')}`);
    const arts = Object.keys(result.artifacts);
    if (arts.length) logger.info(`  artifacts: ${arts.join(', ')} (these ARE the evidence the court reads)`);
  } else {
    logger.warn(`[evaluate] ${options.dimId}: ${result.reason ?? 'evaluator produced no score'}`);
  }
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
