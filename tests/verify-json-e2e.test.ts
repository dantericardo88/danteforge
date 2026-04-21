// verify --json E2E smoke test - confirms JSON on stdout, log noise on stderr
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { runTsxCli } from './helpers/cli-runner.ts';

let tmpDir: string;
let verifyJsonResult: { stdout: string; stderr: string; status: number | null; error: Error | null };
let verifyJsonOutput: { status?: string; counts?: unknown };
before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-verify-json-e2e-'));
  // Create minimal .danteforge/STATE.yaml for verify to run
  const stateDir = path.join(tmpDir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  const state = {
    project: 'e2e-test',
    workflowStage: 'verify',
    currentPhase: 1,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
  };
  await fs.writeFile(path.join(stateDir, 'STATE.yaml'), yaml.stringify(state), 'utf8');

  verifyJsonResult = runVerifyJson(tmpDir);
  assert.equal(verifyJsonResult.error, null, `verify --json failed before producing stdout: ${verifyJsonResult.error?.message ?? 'unknown error'}`);
  assert.notEqual(verifyJsonResult.status, null, 'verify --json timed out before producing stdout');
  verifyJsonOutput = JSON.parse(verifyJsonResult.stdout) as { status?: string; counts?: unknown };
});
after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function runVerifyJson(cwd: string): { stdout: string; stderr: string; status: number | null; error: Error | null } {
  const result = runTsxCli(['verify', '--json'], {
    cwd,
    timeout: 300000,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    error: result.error,
  };
}

describe('verify --json E2E', () => {
  it('stdout is valid JSON (JSON.parse does not throw)', () => {
    assert.ok(verifyJsonOutput && typeof verifyJsonOutput === 'object');
  });

  it('stdout JSON has a "status" field with value pass, warn, or fail', () => {
    assert.ok(['pass', 'warn', 'fail'].includes(verifyJsonOutput.status ?? ''), `Unexpected status: ${verifyJsonOutput.status}`);
  });

  it('stdout JSON has a "counts" object', () => {
    assert.ok(verifyJsonOutput.counts !== null && typeof verifyJsonOutput.counts === 'object', 'Expected counts object');
  });

  it('stderr is non-empty (logger output is redirected there)', () => {
    assert.ok(verifyJsonResult.stderr.length > 0, 'Expected stderr to contain log output');
  });

  it('stdout does not contain [INFO], [OK], or ANSI escape codes', () => {
    assert.ok(!verifyJsonResult.stdout.includes('[INFO]'), 'stdout should not contain [INFO] tags');
    assert.ok(!verifyJsonResult.stdout.includes('[OK]'), 'stdout should not contain [OK] tags');
    assert.ok(!verifyJsonResult.stdout.includes('[WARN]'), 'stdout should not contain [WARN] tags');
    // Check for ESC character (ANSI escape start)
    assert.ok(!verifyJsonResult.stdout.includes('\x1b'), 'stdout should not contain ANSI escape codes');
  });
});
