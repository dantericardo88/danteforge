// Runtime Execution Runner — runs real commands and enforces minimum duration.
//
// Extends the shell runner pattern with min_duration_ms enforcement: if the
// command completes faster than the threshold, it's treated as a trivial file
// check and fails. This prevents `readFileSync` checks from masquerading as
// runtime outcomes.

import { existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { RuntimeExecOutcome, OutcomeEvidenceEntry } from '../types/outcome.js';
import { toolchainEnv } from '../../core/toolchain-path.js';

/** A fast run still proves production behavior if it emitted an artifact at/above this size (mirrors
 *  session-record's SUBSTANTIAL_ARTIFACT_BYTES — the council 2026-06-22 false-negative fix). */
const SUBSTANTIAL_ARTIFACT_BYTES = 512;

interface SpawnOpts {
  shell: boolean | string;
  cwd: string;
  timeout: number;
  encoding: 'utf8';
  env?: NodeJS.ProcessEnv;
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
      env: toolchainEnv(),
    });
  } catch (err) {
    result = {
      status: -1,
      stdout: '',
      stderr: `spawn error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const durationMs = Date.now() - start;
  // `let` so the retry block can update it if the first run fails.
  let actualExit = result.status ?? 1;
  let passed = actualExit === expectedExit;
  let failureReason: string | undefined;

  if (!passed) {
    failureReason = `exit ${actualExit} (expected ${expectedExit})`;
  }

  if (passed && minDuration > 0 && durationMs < minDuration) {
    // False-negative fix (council 2026-06-22): a fast run still proves production behavior if it produced a
    // SUBSTANTIAL artifact (e.g. `docs` emitting a 350KB reference in ~200ms). Only fast AND artifact-less/small
    // fails — mirrors session-record Guard 3. The frontier-review court remains the semantic backstop.
    const artPath = (outcome as { observable_artifact?: string }).observable_artifact;
    let artifactSubstantial = false;
    if (artPath) {
      try { artifactSubstantial = statSync(isAbsolute(artPath) ? artPath : join(cwd, artPath)).size >= SUBSTANTIAL_ARTIFACT_BYTES; } catch { /* missing/unreadable → not substantial */ }
    }
    if (!artifactSubstantial) {
      passed = false;
      failureReason = `completed in ${durationMs}ms (minimum ${minDuration}ms) and emitted no substantial artifact — too fast to prove a real runtime check`;
    }
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

  // Flake tolerance: retry once on failure if non-zero.
  // Handles transient failures (network timeouts, resource contention).
  // min_duration_ms IS re-checked on the retry: an outcome that failed because
  // it was "too fast to be a real runtime check" must also meet the threshold
  // on the retry — otherwise a deliberately instant check bypasses the gate.
  const flakeTolerance = outcome.flake_tolerance ?? 0;
  const firstAttemptFailureReason = failureReason;
  let finalDurationMs = durationMs;
  let attemptCount = 1;

  if (!passed && flakeTolerance > 0) {
    attemptCount = 2;
    const retryStart = Date.now();
    let retryR: SpawnResult;
    try {
      retryR = spawn(outcome.command, { shell: resolveShell(), cwd, timeout, encoding: 'utf8', env: toolchainEnv() });
    } catch (err) {
      retryR = { status: -1, stdout: '', stderr: `retry error: ${err instanceof Error ? err.message : String(err)}` };
    }
    const retryDurationMs = Date.now() - retryStart;
    const retryExit = retryR.status ?? 1;
    if (retryExit === expectedExit) {
      let retryOk = true;
      if (outcome.expected_output_pattern) {
        try { retryOk = new RegExp(outcome.expected_output_pattern).test(`${retryR.stdout}\n${retryR.stderr}`); }
        catch { retryOk = false; }
      }
      // Re-check min_duration_ms against the retry's own duration.
      if (retryOk && minDuration > 0 && retryDurationMs < minDuration) {
        retryOk = false;
      }
      if (retryOk) {
        passed = true;
        failureReason = undefined;
        actualExit = retryExit;
        result = retryR;
        finalDurationMs = retryDurationMs;
      }
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
    durationMs: finalDurationMs,
    stdoutTail: tailLines(result.stdout, 100),
    stderrTail: tailLines(result.stderr, 100),
    failureReason,
    ranAt: now(),
    evidencePath: '',
    ...(attemptCount > 1 ? { attemptCount, firstAttemptFailureReason } : {}),
  };
}
