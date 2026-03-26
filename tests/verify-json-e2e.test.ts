// verify --json E2E smoke test - confirms JSON on stdout, log noise on stderr
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { runTsxCli } from './helpers/cli-runner.ts';

let tmpDir: string;
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
});
after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function runVerifyJson(cwd: string): { stdout: string; stderr: string; status: number | null } {
  const result = runTsxCli(['verify', '--json'], {
    cwd,
    timeout: 30000,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

describe('verify --json E2E', () => {
  it('stdout is valid JSON (JSON.parse does not throw)', () => {
    const { stdout } = runVerifyJson(tmpDir);
    assert.doesNotThrow(() => JSON.parse(stdout), `stdout was not valid JSON: ${stdout.slice(0, 200)}`);
  });

  it('stdout JSON has a "status" field with value pass, warn, or fail', () => {
    const { stdout } = runVerifyJson(tmpDir);
    const json = JSON.parse(stdout) as { status?: string };
    assert.ok(['pass', 'warn', 'fail'].includes(json.status ?? ''), `Unexpected status: ${json.status}`);
  });

  it('stdout JSON has a "counts" object', () => {
    const { stdout } = runVerifyJson(tmpDir);
    const json = JSON.parse(stdout) as { counts?: unknown };
    assert.ok(json.counts !== null && typeof json.counts === 'object', 'Expected counts object');
  });

  it('stderr is non-empty (logger output is redirected there)', () => {
    const { stderr } = runVerifyJson(tmpDir);
    assert.ok(stderr.length > 0, 'Expected stderr to contain log output');
  });

  it('stdout does not contain [INFO], [OK], or ANSI escape codes', () => {
    const { stdout } = runVerifyJson(tmpDir);
    assert.ok(!stdout.includes('[INFO]'), 'stdout should not contain [INFO] tags');
    assert.ok(!stdout.includes('[OK]'), 'stdout should not contain [OK] tags');
    assert.ok(!stdout.includes('[WARN]'), 'stdout should not contain [WARN] tags');
    // Check for ESC character (ANSI escape start)
    assert.ok(!stdout.includes('\x1b'), 'stdout should not contain ANSI escape codes');
  });
});
