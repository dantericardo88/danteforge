// End-to-End Workflow Runner — multi-step CLI workflow verification.
//
// Runs a sequence of CLI invocations, validates artifacts after each step,
// and optionally builds + tests the generated project. The ultimate runtime
// quality proof: DanteForge creates something → that something actually works.

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import type { E2eWorkflowOutcome, OutcomeEvidenceEntry } from '../types/outcome.js';

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

export interface E2eWorkflowRunnerOptions {
  _spawn?: (args: string[], opts: SpawnOpts) => SpawnResult;
  _mkdtemp?: () => Promise<string>;
  _rmdir?: (p: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
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

export async function runE2eWorkflowOutcome(
  outcome: E2eWorkflowOutcome,
  dimensionId: string,
  cwd: string,
  options: E2eWorkflowRunnerOptions = {},
): Promise<OutcomeEvidenceEntry> {
  const spawn = options._spawn ?? defaultSpawn;
  const existsFn = options._exists ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });
  const now = options._now ?? (() => new Date().toISOString());

  const binaryPath = path.join(cwd, 'dist', 'index.js');
  const useTempDir = outcome.cwd_strategy === 'temp';
  let workDir = cwd;
  let tempDir: string | undefined;

  if (useTempDir) {
    tempDir = options._mkdtemp
      ? await options._mkdtemp()
      : await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-'));
    workDir = tempDir;
  }

  const timeout = outcome.timeout_ms ?? 120_000;
  const start = Date.now();
  const stepResults: string[] = [];
  let passed = true;
  let failureReason: string | undefined;
  let lastExit = 0;

  for (let i = 0; i < outcome.steps.length; i++) {
    const step = outcome.steps[i];
    const expectedExit = step.expected_exit ?? 0;
    let result: SpawnResult;

    try {
      result = spawn([binaryPath, ...step.cli_args], {
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

    lastExit = result.status ?? 1;
    stepResults.push(`--- Step ${i + 1}: ${step.cli_args.join(' ')} ---\nexit: ${lastExit}\n${result.stdout}`);

    if (lastExit !== expectedExit) {
      passed = false;
      failureReason = `step ${i + 1} (${step.cli_args.join(' ')}): exit ${lastExit} (expected ${expectedExit})`;
      break;
    }

    if (step.expected_stdout_patterns) {
      for (const pattern of step.expected_stdout_patterns) {
        try {
          if (!new RegExp(pattern, 'i').test(result.stdout)) {
            passed = false;
            failureReason = `step ${i + 1}: stdout did not match pattern: ${pattern}`;
            break;
          }
        } catch (err) {
          passed = false;
          failureReason = `step ${i + 1}: bad regex: ${err instanceof Error ? err.message : 'unknown'}`;
          break;
        }
      }
      if (!passed) break;
    }

    if (step.expected_artifacts) {
      for (const artifact of step.expected_artifacts) {
        const artifactPath = path.isAbsolute(artifact) ? artifact : path.join(workDir, artifact);
        if (!(await existsFn(artifactPath))) {
          passed = false;
          failureReason = `step ${i + 1}: expected artifact not found: ${artifact}`;
          break;
        }
      }
      if (!passed) break;
    }
  }

  if (passed && outcome.verify_generated_project) {
    const npmResult = spawn(
      ['-e', `require('child_process').execSync('npm install && npm run build && npm test', { cwd: '${workDir.replace(/\\/g, '\\\\')}', stdio: 'inherit' })`],
      { cwd: workDir, timeout: 300_000, encoding: 'utf8' },
    );
    if ((npmResult.status ?? 1) !== 0) {
      passed = false;
      failureReason = `generated project build/test failed (exit ${npmResult.status})`;
      lastExit = npmResult.status ?? 1;
      stepResults.push(`--- verify_generated_project ---\nexit: ${lastExit}\n${npmResult.stderr}`);
    }
  }

  const durationMs = Date.now() - start;

  if (tempDir) {
    try {
      const rmdir = options._rmdir ?? ((p: string) => fs.rm(p, { recursive: true, force: true }));
      await rmdir(tempDir);
    } catch { /* best-effort */ }
  }

  const gitSha = options._readGitSha ? await options._readGitSha() : null;

  return {
    dimensionId,
    outcomeId: outcome.id,
    tier: outcome.tier,
    gitSha,
    passed,
    exitCode: lastExit,
    durationMs,
    stdoutTail: tailLines(stepResults.join('\n'), 100),
    stderrTail: '',
    failureReason,
    ranAt: now(),
    evidencePath: '',
  };
}
