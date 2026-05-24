// schedule.ts — Lightweight in-process cron for danteforge commands.
//
// Usage:
//   danteforge schedule "compete --calibrate" --interval 60 --max-runs 24
//   danteforge schedule "autoforge --auto" --interval 30 --log .danteforge/schedule.log
//
// This is a blocking foreground process. Ctrl+C (SIGINT) stops it cleanly.
// Each run executes the given command via the danteforge CLI sub-process.

import fs from 'node:fs/promises';
import path from 'node:path';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';

const execAsync = promisify(execCallback);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScheduleOptions {
  /** Interval between runs in minutes. */
  intervalMinutes: number;
  /** Maximum number of runs. 0 = unlimited. Default: 0 */
  maxRuns?: number;
  /** Path to the log file. Default: .danteforge/schedule.log */
  logFile?: string;
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /**
   * Injectable command runner for testing.
   * Receives the full command string and options; returns exit code.
   */
  _runCommand?: (command: string, cwd: string) => Promise<number>;
  /**
   * Injectable sleep for testing (milliseconds).
   */
  _sleep?: (ms: number) => Promise<void>;
}

export interface ScheduleRun {
  runNumber: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  command: string;
}

export interface ScheduleResult {
  runsCompleted: number;
  runsFailed: number;
  stopped: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function appendRunLog(
  logFile: string,
  run: ScheduleRun,
): Promise<void> {
  try {
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    const line = JSON.stringify(run) + '\n';
    await fs.appendFile(logFile, line, 'utf8');
  } catch {
    // best-effort: logging failures never stop the scheduler
  }
}

async function defaultRunCommand(command: string, cwd: string): Promise<number> {
  try {
    const danteforge = process.execPath;
    const cliEntry = path.resolve(process.cwd(), 'dist/index.js');
    const full = `"${danteforge}" "${cliEntry}" ${command}`;
    await execAsync(full, { cwd });
    return 0;
  } catch (err: unknown) {
    // execAsync throws on non-zero exit; extract the code if available
    const exitCode =
      typeof (err as { code?: number }).code === 'number'
        ? (err as { code: number }).code
        : 1;
    return exitCode;
  }
}

function defaultLogPath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'schedule.log');
}

// ── Main scheduler ────────────────────────────────────────────────────────────

/**
 * Run `command` every `intervalMinutes` minutes, up to `maxRuns` times.
 *
 * Logs each run (start time, exit code, duration) to `logFile`.
 * Returns when maxRuns is reached or the process is interrupted.
 * Never throws — errors in individual runs are logged and counted.
 */
export async function schedule(
  command: string,
  options: ScheduleOptions,
): Promise<ScheduleResult> {
  const cwd = options.cwd ?? process.cwd();
  const intervalMs = options.intervalMinutes * 60_000;
  const maxRuns = options.maxRuns ?? 0;
  const logFile = options.logFile ?? defaultLogPath(cwd);
  const runCommand = options._runCommand ?? defaultRunCommand;
  const sleep = options._sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  let runsCompleted = 0;
  let runsFailed = 0;
  let stopped = 'max-runs-reached';
  let interrupted = false;

  const sigintHandler = (): void => {
    interrupted = true;
    stopped = 'user-interrupted';
    logger.info('\n[schedule] SIGINT received — stopping after current run.');
  };
  process.on('SIGINT', sigintHandler);

  logger.info(
    `[schedule] Starting: "${command}" | interval: ${options.intervalMinutes}m | ` +
    `max-runs: ${maxRuns === 0 ? 'unlimited' : maxRuns} | log: ${logFile}`,
  );

  try {
    while (!interrupted) {
      runsCompleted++;
      const runNumber = runsCompleted;
      const startedAt = new Date().toISOString();
      const startMs = Date.now();

      logger.info(`[schedule] Run ${runNumber}${maxRuns > 0 ? `/${maxRuns}` : ''} starting at ${startedAt}`);

      let exitCode = 0;
      try {
        exitCode = await runCommand(command, cwd);
      } catch (err) {
        exitCode = 1;
        logger.warn(`[schedule] Run ${runNumber} threw: ${err instanceof Error ? err.message : String(err)}`);
      }

      const finishedAt = new Date().toISOString();
      const durationMs = Date.now() - startMs;

      if (exitCode !== 0) {
        runsFailed++;
        logger.warn(`[schedule] Run ${runNumber} finished with exit code ${exitCode} in ${durationMs}ms`);
      } else {
        logger.info(`[schedule] Run ${runNumber} succeeded in ${durationMs}ms`);
      }

      const runRecord: ScheduleRun = {
        runNumber,
        startedAt,
        finishedAt,
        durationMs,
        exitCode,
        command,
      };
      await appendRunLog(logFile, runRecord);

      // Check termination conditions
      if (maxRuns > 0 && runsCompleted >= maxRuns) {
        stopped = 'max-runs-reached';
        break;
      }

      if (interrupted) break;

      logger.info(`[schedule] Next run in ${options.intervalMinutes} minute(s)...`);
      await sleep(intervalMs);
    }
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }

  logger.info(
    `[schedule] Done. ${runsCompleted} run(s) completed (${runsFailed} failed). Stopped: ${stopped}`,
  );
  return { runsCompleted, runsFailed, stopped };
}
