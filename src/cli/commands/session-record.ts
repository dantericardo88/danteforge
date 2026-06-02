// session-record.ts — produce real-user-path evidence by running the REAL product.
//
// The keystone of the input_source contract: 9.0 (T7) requires an outcome with
// input_source: real-user-path, but nothing could PRODUCE one — so "drive to 9" was
// unsatisfiable by construction (every agent would give up or fake it). This command
// closes that loop honestly.
//
// It runs a genuine product command (NOT a test runner) against a realistic input,
// confirms it actually executed (exit 0, ran long enough) and produced an observable
// artifact, and only THEN emits a real-user-path outcome for the dimension. An agent
// cannot satisfy it without actually running the real product and producing real output —
// which is exactly the evidence the adversarial audit looks for.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import { isTestSuiteCommand } from '../../matrix/engines/outcome-quality.js';

/** A real exercise must run at least this long — instant commands prove nothing. */
export const MIN_REAL_RUN_MS = 1000;

export interface SessionRecordOptions {
  cwd?: string;
  dimId: string;
  /** The real product command to run, e.g. `node dist/index.js forge --project fixtures/sample`. */
  run: string;
  /** The production file this exercise drives (recorded as required_callsite). */
  callsite: string;
  /** Path to the observable artifact the run must produce/modify. */
  artifact: string;
  description?: string;
  write?: boolean;
  json?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeMatrix?: (m: CompeteMatrix, p: string) => Promise<void>;
  /** Seam: run the command, returning exit code + duration. */
  _runCommand?: (command: string, cwd: string) => Promise<{ exitCode: number; durationMs: number; stdout: string }>;
  /** Seam: did the artifact get produced/modified at/after `sinceEpochMs`? */
  _artifactProduced?: (artifactPath: string, sinceEpochMs: number) => Promise<boolean>;
}

export interface SessionRecordResult {
  accepted: boolean;
  reason: string;
  outcome?: Record<string, unknown>;
  durationMs?: number;
  wrote: boolean;
}

async function defaultRun(command: string, cwd: string): Promise<{ exitCode: number; durationMs: number; stdout: string }> {
  const start = performance.now();
  return await new Promise((resolve) => {
    execFile(command, { cwd, shell: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      const durationMs = Math.round(performance.now() - start);
      const exitCode = err ? ((err as { code?: number }).code ?? 1) : 0;
      resolve({ exitCode: typeof exitCode === 'number' ? exitCode : 1, durationMs, stdout: String(stdout ?? '') });
    });
  });
}

async function defaultArtifactProduced(artifactPath: string, sinceEpochMs: number): Promise<boolean> {
  try {
    const st = await fs.stat(artifactPath);
    return st.mtimeMs >= sinceEpochMs - 50; // small clock-skew tolerance
  } catch {
    return false;
  }
}

export async function runSessionRecord(options: SessionRecordOptions): Promise<SessionRecordResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const write = options.write ?? false;
  const loadFn = options._loadMatrix ?? loadMatrix;
  const writeMatrix = options._writeMatrix ?? ((m, p) => fs.writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf8'));
  const runCmd = options._runCommand ?? defaultRun;
  const artifactProduced = options._artifactProduced ?? defaultArtifactProduced;
  const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');

  const matrix = await loadFn(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');
  const dim = matrix.dimensions.find(d => d.id === options.dimId);
  if (!dim) throw new Error(`Dimension "${options.dimId}" not found in matrix.`);

  // Guard 1: a test runner can never be real-user-path — the gate can't tell a real
  // integration test from a mocked one. 9.0 requires running the actual product.
  if (isTestSuiteCommand(options.run)) {
    const reason = `"${options.run}" is a test-runner command, not a product run. Real-user-path requires executing the actual product (e.g. node dist/index.js <cmd>).`;
    return finalize({ accepted: false, reason, wrote: false }, options, reason);
  }

  // Run the real product.
  logger.info(`[session-record] Running: ${options.run}`);
  const beforeEpoch = Date.now();
  const { exitCode, durationMs } = await runCmd(options.run, cwd);

  // Guard 2: it must have actually succeeded.
  if (exitCode !== 0) {
    const reason = `Command exited ${exitCode}. A real-user-path receipt requires a successful run.`;
    return finalize({ accepted: false, reason, durationMs, wrote: false }, options, reason);
  }
  // Guard 3: it must have run long enough to be a real exercise.
  if (durationMs < MIN_REAL_RUN_MS) {
    const reason = `Ran in ${durationMs}ms (< ${MIN_REAL_RUN_MS}ms). Too fast to be a real exercise — an instant command does not prove production behavior.`;
    return finalize({ accepted: false, reason, durationMs, wrote: false }, options, reason);
  }
  // Guard 4: it must have produced an observable artifact.
  const produced = await artifactProduced(options.artifact, beforeEpoch);
  if (!produced) {
    const reason = `No observable artifact at "${options.artifact}" was produced/modified by the run. 9.0 requires an observable output, not just an exit code.`;
    return finalize({ accepted: false, reason, durationMs, wrote: false }, options, reason);
  }

  // Genuine real-user-path exercise — emit the outcome.
  const outcome: Record<string, unknown> = {
    id: `${options.dimId}-rup-${beforeEpoch}`,
    // runtime-exec consumes `command` (e2e-workflow expects steps[] — a mismatch would
    // make validate no-op the receipt). runtime-exec + real-user-path + non-test-runner
    // reaches 9.0 via classifyOutcomeKind.
    kind: 'runtime-exec',
    tier: 'T7',
    description: options.description ?? `Real-user-path: \`${options.run}\` produces ${options.artifact}`,
    command: options.run,
    required_callsite: options.callsite,
    min_duration_ms: MIN_REAL_RUN_MS,
    input_source: { type: 'real-user-path', description: options.description ?? `runs ${options.run} on a realistic input` },
  };

  let wrote = false;
  if (write) {
    const d = dim as unknown as { outcomes?: Array<Record<string, unknown>> };
    // Drop any scaffold stub for this dim — it is now superseded by a real outcome.
    d.outcomes = (d.outcomes ?? []).filter(o => o._scaffold !== true);
    d.outcomes.push(outcome);
    await writeMatrix(matrix, matrixPath);
    wrote = true;
  }

  const reason = `Genuine real-user-path exercise (${durationMs}ms, artifact produced). ${write ? 'Outcome written.' : 'Dry-run — re-run with --write to add it.'}`;
  return finalize({ accepted: true, reason, outcome, durationMs, wrote }, options, reason);
}

function finalize(result: SessionRecordResult, options: SessionRecordOptions, reason: string): SessionRecordResult {
  if (result.accepted) {
    logger.success(`[session-record] ✓ ${reason}`);
    if (result.wrote) {
      logger.info(`  Outcome added to "${options.dimId}". Now run it across TWO sessions to reach 9.0:`);
      logger.info(`    danteforge validate ${options.dimId}    # session 1`);
      logger.info(`    danteforge validate ${options.dimId}    # session 2 (separate invocation)`);
    }
  } else {
    logger.warn(`[session-record] ✗ ${reason}`);
  }
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}
