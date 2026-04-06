// ExitCode isolation tests — library functions must NOT set process.exitCode
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { verify } from '../src/harvested/gsd/agents/verifier.js';
import { executeWave } from '../src/harvested/gsd/agents/executor.js';
import { runGate, GateError } from '../src/core/gates.js';

let originalHome: string | undefined;
const tempDirs: string[] = [];

async function makeTempDir(tasks?: Record<number, { name: string; verify?: string }[]>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-exitcode-'));
  tempDirs.push(dir);
  const dfDir = path.join(dir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  const state: Record<string, unknown> = {
    project: 'exitcode-test',
    created: new Date().toISOString(),
    workflowStage: 'forge',
    currentPhase: 1,
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: tasks ?? {},
    gateResults: {},
    auditLog: [],
  };
  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), yaml.stringify(state));
  return dir;
}

describe('exitCode isolation — library functions', () => {
  before(async () => {
    originalHome = process.env.DANTEFORGE_HOME;
    const dir = await makeTempDir();
    process.env.DANTEFORGE_HOME = dir;
  });

  beforeEach(() => { process.exitCode = 0; });

  after(async () => {
    process.exitCode = 0;
    if (originalHome !== undefined) {
      process.env.DANTEFORGE_HOME = originalHome;
    } else {
      delete process.env.DANTEFORGE_HOME;
    }
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('verify() returns false but does NOT set process.exitCode', async () => {
    const result = await verify('', 'criteria');
    assert.equal(result, false);
    assert.equal(process.exitCode, 0, 'verify() must not set process.exitCode');
  });

  it('verify() with LLM FAIL verdict does NOT set process.exitCode', async () => {
    const mockLLM = async () => 'FAIL\nNot implemented.';
    const result = await verify('output', 'criteria', { _llmCaller: mockLLM });
    assert.equal(result, false);
    assert.equal(process.exitCode, 0, 'verify() must not set process.exitCode on FAIL verdict');
  });

  it('executeWave returns { success: false } but does NOT set process.exitCode (no tasks)', async () => {
    const dir = await makeTempDir({ 1: [] }); // empty task list for phase 1 won't match
    const result = await executeWave(99, 'balanced', false, false, false, 5000, { cwd: dir });
    assert.equal(result.success, false);
    assert.equal(process.exitCode, 0, 'executeWave must not set process.exitCode');
  });

  it('executeWave returns { success: false } when LLM unavailable, does NOT set process.exitCode', async () => {
    const dir = await makeTempDir({ 1: [{ name: 'task-1', verify: 'check it' }] });
    const result = await executeWave(1, 'balanced', false, false, false, 5000, { cwd: dir });
    assert.equal(result.success, false);
    assert.equal(result.mode, 'blocked');
    assert.equal(process.exitCode, 0, 'executeWave must not set process.exitCode when blocked');
  });

  it('runGate returns false but does NOT set process.exitCode', async () => {
    const failingGate = async () => {
      throw new GateError('Gate failed', 'testGate', 'run fix');
    };
    const result = await runGate(failingGate);
    assert.equal(result, false);
    assert.equal(process.exitCode, 0, 'runGate must not set process.exitCode');
  });
});
