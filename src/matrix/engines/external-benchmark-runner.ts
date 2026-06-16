// external-benchmark-runner.ts — runs an `external-benchmark` outcome HONESTLY (master-plan Phase 1b).
//
// Previously external-benchmark outcomes "fell through to shell mode": they ran the command and passed on
// exit-0, ignoring `min_pass_rate` and not checking the suite is registered — so a command that exits 0 but
// scores below its threshold (or a made-up "benchmark") could still mint external-grounding evidence. This
// runner makes the receipt honest: (1) the suite MUST be in the registry (external grounding can only come
// from an independently-reproducible suite — see external-suite-registry.ts); (2) when the benchmark emits
// a parseable pass rate it is ENFORCED against `min_pass_rate`, else it falls back to exit-code (the
// command self-enforces). This is the receipt the Phase-1c grounding gate trusts to let a score past 7.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isRegisteredExternalSuite, REGISTERED_EXTERNAL_SUITES } from './external-suite-registry.js';
import { toolchainEnv } from '../../core/toolchain-path.js';
import type { OutcomeEvidenceEntry, ExternalBenchmarkOutcome } from '../types/outcome.js';

/** Match outcome-runner's shell resolution (Git Bash on win32, else default). */
function resolveShell(): boolean | string {
  if (process.platform !== 'win32') return true;
  for (const c of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe']) {
    if (existsSync(c)) return c;
  }
  return true;
}

export interface ExternalBenchmarkDeps {
  /** Seam: run the benchmark command (default: spawnSync via the resolved shell). */
  _spawn?: (command: string, opts: { cwd: string; timeout: number }) => { status: number | null; stdout: string; stderr: string };
  _readGitSha?: (cwd: string) => Promise<string | null>;
}

function tail(s: string, n = 100): string { return (s ?? '').split('\n').slice(-n).join('\n'); }

// Common benchmark pass-rate shapes (JSON, percent, N/M, swe-bench "resolved"). First match wins.
const PASS_RATE_PATTERNS: RegExp[] = [
  /"pass[_]?rate"\s*:\s*([0-9.]+)/i,
  /pass\s*rate\s*[:=]\s*([0-9.]+)\s*%/i,
  /resolved\s*[:=]?\s*([0-9]+)\s*\/\s*([0-9]+)/i,
  /([0-9]+)\s*\/\s*([0-9]+)\s+(?:passed|pass\b|solved|resolved)/i,
];

/** Parse a 0..1 pass rate from benchmark output, or null if none is recognizable. */
export function parsePassRate(text: string): number | null {
  for (const re of PASS_RATE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    if (m[2] !== undefined) { const denom = Number(m[2]); return denom > 0 ? Number(m[1]) / denom : null; }
    const v = Number(m[1]);
    if (Number.isNaN(v)) continue;
    return v > 1 ? v / 100 : v; // a value >1 is a percent (82) → 0.82; otherwise already a fraction
  }
  return null;
}

async function defaultReadGitSha(cwd: string): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
    return stdout.trim() || null;
  } catch { return null; }
}

export async function runExternalBenchmarkOutcome(
  outcome: ExternalBenchmarkOutcome,
  dimensionId: string,
  cwd: string,
  deps: ExternalBenchmarkDeps = {},
): Promise<OutcomeEvidenceEntry> {
  const gitSha = await (deps._readGitSha ?? defaultReadGitSha)(cwd);
  const base = {
    dimensionId, outcomeId: outcome.id, tier: outcome.tier, gitSha,
    stdoutTail: '', stderrTail: '', durationMs: 0, ranAt: new Date().toISOString(), evidencePath: '',
  };

  // (1) Integrity anchor: external grounding can ONLY come from a registered, independently-reproducible
  // suite. A made-up "benchmark" produces a FAILED receipt — it can never count as grounding.
  if (!isRegisteredExternalSuite(outcome.benchmark)) {
    return {
      ...base, passed: false, exitCode: -1,
      failureReason: `benchmark "${outcome.benchmark}" is not a registered external suite (allowed: ${[...REGISTERED_EXTERNAL_SUITES].join(', ')}) — cannot count as external grounding`,
    };
  }

  const start = Date.now();
  const spawn = deps._spawn ?? ((command: string, opts: { cwd: string; timeout: number }) => {
    const r = spawnSync(command, { shell: resolveShell(), cwd: opts.cwd, timeout: opts.timeout, encoding: 'utf8', env: toolchainEnv() });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  });

  let r: { status: number | null; stdout: string; stderr: string };
  try { r = spawn(outcome.command, { cwd, timeout: outcome.timeout_ms ?? 600_000 }); }
  catch (err) { r = { status: -1, stdout: '', stderr: `spawn error: ${err instanceof Error ? err.message : String(err)}` }; }

  const durationMs = Date.now() - start;
  const exitCode = r.status ?? 1;
  const rate = parsePassRate(`${r.stdout}\n${r.stderr}`);

  // (2) Enforce min_pass_rate when the benchmark reports one; else fall back to the exit code.
  let passed: boolean;
  let failureReason: string | undefined;
  if (rate !== null) {
    passed = rate >= outcome.min_pass_rate;
    if (!passed) failureReason = `${outcome.benchmark} pass rate ${(rate * 100).toFixed(1)}% < required min_pass_rate ${(outcome.min_pass_rate * 100).toFixed(1)}%`;
  } else {
    passed = exitCode === 0;
    if (!passed) failureReason = `exit ${exitCode}; no parseable pass rate (the command must enforce min_pass_rate ${outcome.min_pass_rate} itself)`;
  }

  return { ...base, passed, exitCode, durationMs, stdoutTail: tail(r.stdout), stderrTail: tail(r.stderr), failureReason };
}
