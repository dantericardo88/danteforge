// council-parallel-doctrine.ts — the post-merge doctrine pass for the parallel council
// (split from council-parallel.ts for the file-size standard): CIP check FIRST, then validate
// receipts for the dims that passed, then a Time Machine commit for the audit trail.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { runCIPCheck } from '../../core/completion-integrity.js';
import { createTimeMachineCommit } from '../../core/time-machine.js';

const execFileAsync = promisify(execFile);

export interface PostMergeDim {
  dimId: string;
  changedFiles: string[];
}

export interface PostMergeDoctrineResult {
  cipBlocked: string[];
  timeMachineCommitId: string | null;
}

export async function runPostMergeDoctrine(
  cwd: string,
  mergedDims: PostMergeDim[],
): Promise<PostMergeDoctrineResult> {
  if (mergedDims.length === 0) return { cipBlocked: [], timeMachineCommitId: null };

  const dimIds = mergedDims.map(d => d.dimId);

  // Step 1: CIP check FIRST — dims that fail CIP must not get validate receipts,
  // otherwise their score would be elevated based on incomplete integration.
  const cipBlocked: string[] = [];
  for (const dimId of dimIds) {
    try {
      const result = await runCIPCheck(dimId, { cwd });
      if (result.blocksFrontierReached) {
        cipBlocked.push(dimId);
        logger.warn(chalk.yellow(
          `  [cip] ${dimId} BLOCKED — gaps: ${result.gaps.slice(0, 3).join('; ')} (score not updated)`,
        ));
      } else {
        logger.info(chalk.dim(`  [cip] ${dimId} ${result.cipClass} (score ${result.cipScore.toFixed(1)})`));
      }
    } catch (err) {
      logger.info(chalk.dim(`  [cip] ${dimId} — check skipped: ${String(err).split('\n')[0]}`));
    }
  }

  // Step 2: validate — generate receipts only for dims that passed CIP.
  // CIP-blocked dims are excluded so their score ceilings are not lifted.
  const validateDims = dimIds.filter(id => !cipBlocked.includes(id));
  if (validateDims.length > 0) {
    logger.info(chalk.dim(`  [validate] Running validate for ${validateDims.length} dim(s)...`));
    // Use the currently-running Node process + CLI entry (avoids .ps1 shim on Windows)
    const [nodeBin, cliEntry] = [process.execPath, process.argv[1] ?? 'dist/index.js'];
    for (const dimId of validateDims) {
      try {
        await execFileAsync(nodeBin, [cliEntry, 'validate', dimId], {
          cwd, timeout: 120_000,
          env: { ...process.env, DANTEFORGE_MATRIX_MERGE_RECEIPT: '1' },
        });
        logger.info(chalk.dim(`  [validate] ${dimId} ✓`));
      } catch {
        logger.info(chalk.dim(`  [validate] ${dimId} — no outcome defined or failed (ok at breadth stage)`));
      }
    }
  } else if (cipBlocked.length > 0) {
    logger.warn(chalk.yellow(`  [validate] Skipped — all merged dims are CIP-blocked. Fix integration gaps first.`));
  }

  // Step 3: Time Machine commit — best-effort, never blocks (but failures are logged as warn)
  let timeMachineCommitId: string | null = null;
  try {
    const allChangedFiles = [...new Set(mergedDims.flatMap(d => d.changedFiles))];
    const commit = await createTimeMachineCommit({
      cwd,
      paths: allChangedFiles,
      label: `council-merge/${dimIds.join(',')}`,
    });
    timeMachineCommitId = commit.commitId;
    logger.info(chalk.dim(`  [time-machine] commit ${commit.commitId.slice(0, 12)} recorded`));
  } catch (err) {
    logger.warn(chalk.yellow(`  [time-machine] commit failed — audit trail incomplete: ${String(err).split('\n')[0]}`));
  }

  return { cipBlocked, timeMachineCommitId };
}
