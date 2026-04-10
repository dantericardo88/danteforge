// Real subprocess E2E tests — zero injection seams, actual process spawning
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { runTsxCli } from './helpers/cli-runner.ts';

let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-real-'));
  // Pre-seed minimal STATE.yaml so `verify` can run
  const stateDir = path.join(tmpDir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  const state = {
    project: 'e2e-real',
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

describe('Real subprocess E2E', () => {
  it('--version returns a semver string and exits 0', () => {
    const result = runTsxCli(['--version'], { timeout: 30_000 });
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr.slice(0, 200)}`);
    const version = result.stdout.trim();
    assert.match(version, /^\d+\.\d+\.\d+/, `expected semver, got "${version}"`);
  });

  it('verify --json on a fresh project returns valid JSON with a status field', () => {
    const result = runTsxCli(['verify', '--json'], { cwd: tmpDir, timeout: 60_000 });
    assert.doesNotThrow(
      () => JSON.parse(result.stdout),
      `stdout is not valid JSON: ${result.stdout.slice(0, 200)}`,
    );
    const json = JSON.parse(result.stdout) as { status?: string };
    assert.ok(
      ['pass', 'warn', 'fail'].includes(json.status ?? ''),
      `unexpected status field: ${json.status}`,
    );
  });
});
