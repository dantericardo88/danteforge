// climb.ts — danteforge climb <dim>: run the AIDE-style graded CLIMB loop on a dim's graded_evaluator.
//
// This is the autonomous build loop that finally drives on the CONTINUOUS evaluator instead of the binary
// capability_test. Each cycle: dispatch a builder (council-crusade, goal-driven toward the failing
// capabilities) -> re-evaluate the combined_score -> keep only if it improved -> climb until the target.

import path from 'node:path';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { runGradedClimb, type GradedClimbResult } from '../../core/graded-climb.js';
import { runGradedEvaluator } from '../../core/graded-evaluator.js';
import { runCli } from './ascend-frontier-runner.js';
import { logger } from '../../core/logger.js';

export interface ClimbCliOptions {
  dimId: string;
  cwd?: string;
  target?: number;
  maxCycles?: number;
  json?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _dispatch?: (dimId: string, goal: string, cwd: string) => Promise<void>;
}

/** The default builder dispatch: council-crusade builds toward the goal (which names the failing capabilities
 *  + the evaluator command). Goal-driven, so it needs no binary --exit-code-metric. */
async function councilCrusadeDispatch(dimId: string, goal: string, cwd: string): Promise<void> {
  const r = await runCli(cwd, ['council-crusade', '--focus-dims', dimId, '--goal', goal]);
  if (!r.ok) throw new Error(`council-crusade exit ${r.exitCode}`);
}

export async function runClimbCli(options: ClimbCliOptions): Promise<GradedClimbResult | { ran: false; reason: string }> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const matrix = await (options._loadMatrix ?? loadMatrix)(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');
  const dim = matrix.dimensions.find(d => d.id === options.dimId);
  if (!dim) throw new Error(`Dimension "${options.dimId}" not found in matrix.`);
  const evaluatorCommand = (dim as unknown as { graded_evaluator?: string }).graded_evaluator;
  if (!evaluatorCommand || !evaluatorCommand.trim()) {
    const reason = `"${options.dimId}" has no graded_evaluator. Declare one (final stdout line {"combined_score":0..1,...}) — that continuous bar is what the climb loop drives on.`;
    logger.warn(`[climb] ${reason}`);
    return { ran: false, reason };
  }

  const target = options.target ?? 0.9;
  logger.info(`[climb] ${options.dimId}: climbing combined_score toward ${target.toFixed(2)} (max ${options.maxCycles ?? 3} cycles) via ${evaluatorCommand}`);
  const result = await runGradedClimb({
    dimId: options.dimId, evaluatorCommand, cwd,
    target, maxCycles: options.maxCycles,
    _dispatch: options._dispatch ?? councilCrusadeDispatch,
    _eval: (c, w) => runGradedEvaluator(c, w),
    _log: (m) => logger.info(m),
  });

  const lift = result.finalScore - result.startScore;
  logger[result.reachedTarget ? 'success' : 'warn'](
    `[climb] ${options.dimId}: ${result.startScore.toFixed(3)} → ${result.finalScore.toFixed(3)} (Δ${lift >= 0 ? '+' : ''}${lift.toFixed(3)}) — ${result.stoppedReason}`,
  );
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
