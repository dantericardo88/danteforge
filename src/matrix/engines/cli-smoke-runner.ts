// CLI Smoke Runner — spawns the real CLI binary and validates output.
//
// This is the core runtime quality verifier. Instead of checking "does the
// file exist?", it answers "does the CLI actually run and produce correct
// output?". Structural checks cap at T4/7.0; this kind unlocks T5+.

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import type { CliSmokeOutcome, OutcomeEvidenceEntry } from '../types/outcome.js';

interface SpawnOpts {
  cwd: string;
  timeout: number;
  encoding: 'utf8';
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface CliSmokeRunnerOptions {
  _spawn?: (args: string[], opts: SpawnOpts) => SpawnResult;
  _mkdtemp?: () => Promise<string>;
  _rmdir?: (p: string) => Promise<void>;
  _readGitSha?: () => Promise<string | null>;
  _now?: () => string;
}

function defaultSpawn(args: string[], opts: SpawnOpts): SpawnResult {
  const r = spawnSync(process.execPath, args, {
    ...opts,
    shell: false,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  const toStr = (v: unknown): string => (typeof v === 'string' ? v : v ? String(v) : '');
  return { status: r.status, stdout: toStr(r.stdout), stderr: toStr(r.stderr) };
}

function tailLines(s: string, n: number): string {
  return s.split('\n').slice(-n).join('\n');
}

export async function runCliSmokeOutcome(
  outcome: CliSmokeOutcome,
  dimensionId: string,
  cwd: string,
  options: CliSmokeRunnerOptions = {},
): Promise<OutcomeEvidenceEntry> {
  const spawn = options._spawn ?? defaultSpawn;
  const now = options._now ?? (() => new Date().toISOString());

  const binaryPath = path.join(cwd, 'dist', 'index.js');
  const useTempDir = outcome.cwd_strategy === 'temp';
  let workDir = cwd;
  let tempDir: string | undefined;

  if (useTempDir) {
    tempDir = options._mkdtemp
      ? await options._mkdtemp()
      : await fs.mkdtemp(path.join(os.tmpdir(), 'df-smoke-'));
    workDir = tempDir;
  }

  const timeout = outcome.timeout_ms ?? 30_000;
  const expectedExit = outcome.expected_exit ?? 0;
  const start = Date.now();
  let result: SpawnResult;

  try {
    result = spawn([binaryPath, ...outcome.cli_args], {
      cwd: workDir,
      timeout,
      encoding: 'utf8',
    });
  } catch (err) {
    result = {
      status: -1,
      stdout: '',
      stderr: `spawn error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const durationMs = Date.now() - start;
  const actualExit = result.status ?? 1;
  let passed = actualExit === expectedExit;
  let failureReason: string | undefined;

  if (!passed) {
    failureReason = `exit ${actualExit} (expected ${expectedExit})`;
  }

  if (passed && outcome.expected_stdout_patterns) {
    for (const pattern of outcome.expected_stdout_patterns) {
      try {
        if (!new RegExp(pattern, 'i').test(result.stdout)) {
          passed = false;
          failureReason = `stdout did not match pattern: ${pattern}`;
          break;
        }
      } catch (err) {
        passed = false;
        failureReason = `bad regex in expected_stdout_patterns: ${err instanceof Error ? err.message : 'unknown'}`;
        break;
      }
    }
  }

  if (passed && outcome.forbidden_stdout_patterns) {
    for (const pattern of outcome.forbidden_stdout_patterns) {
      try {
        if (new RegExp(pattern, 'i').test(result.stdout)) {
          passed = false;
          failureReason = `stdout matched forbidden pattern: ${pattern}`;
          break;
        }
      } catch { /* bad regex in forbidden = skip */ }
    }
  }

  if (tempDir) {
    try {
      const rmdir = options._rmdir ?? ((p: string) => fs.rm(p, { recursive: true, force: true }));
      await rmdir(tempDir);
    } catch { /* best-effort cleanup */ }
  }

  const gitSha = options._readGitSha ? await options._readGitSha() : null;

  return {
    dimensionId,
    outcomeId: outcome.id,
    tier: outcome.tier,
    gitSha,
    passed,
    exitCode: actualExit,
    durationMs,
    stdoutTail: tailLines(result.stdout, 100),
    stderrTail: tailLines(result.stderr, 100),
    failureReason,
    ranAt: now(),
    evidencePath: '',
  };
}
