// Runtime Execution Runner — runs real commands and enforces minimum duration.
//
// Extends the shell runner pattern with min_duration_ms enforcement: if the
// command completes faster than the threshold, it's treated as a trivial file
// check and fails. This prevents `readFileSync` checks from masquerading as
// runtime outcomes.

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { RuntimeExecOutcome, OutcomeEvidenceEntry } from '../types/outcome.js';

interface SpawnOpts {
  shell: boolean | string;
  cwd: string;
  timeout: number;
  encoding: 'utf8';
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RuntimeExecRunnerOptions {
  _spawn?: (cmd: string, opts: SpawnOpts) => SpawnResult;
  _readGitSha?: () => Promise<string | null>;
  _now?: () => string;
}

function resolveShell(): boolean | string {
  if (process.platform !== 'win32') return true;
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return true;
}

function defaultSpawn(cmd: string, opts: SpawnOpts): SpawnResult {
  const r = spawnSync(cmd, [], opts);
  const toStr = (v: unknown): string => (typeof v === 'string' ? v : v ? String(v) : '');
  return { status: r.status, stdout: toStr(r.stdout), stderr: toStr(r.stderr) };
}

function tailLines(s: string, n: number): string {
  return s.split('\n').slice(-n).join('\n');
}

export async function runRuntimeExecOutcome(
  outcome: RuntimeExecOutcome,
  dimensionId: string,
  cwd: string,
  options: RuntimeExecRunnerOptions = {},
): Promise<OutcomeEvidenceEntry> {
  const spawn = options._spawn ?? defaultSpawn;
  const now = options._now ?? (() => new Date().toISOString());
  const timeout = outcome.timeout_ms ?? 60_000;
  const expectedExit = outcome.expected_exit ?? 0;
  const minDuration = outcome.min_duration_ms ?? 0;

  const start = Date.now();
  let result: SpawnResult;

  try {
    result = spawn(outcome.command, {
      shell: resolveShell(),
      cwd,
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

  if (passed && minDuration > 0 && durationMs < minDuration) {
    passed = false;
    failureReason = `completed in ${durationMs}ms (minimum ${minDuration}ms) — too fast to be a real runtime check`;
  }

  if (passed && outcome.expected_output_pattern) {
    try {
      const combined = `${result.stdout}\n${result.stderr}`;
      if (!new RegExp(outcome.expected_output_pattern).test(combined)) {
        passed = false;
        failureReason = `output did not match pattern: ${outcome.expected_output_pattern}`;
      }
    } catch (err) {
      passed = false;
      failureReason = `bad regex: ${err instanceof Error ? err.message : 'unknown'}`;
    }
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
