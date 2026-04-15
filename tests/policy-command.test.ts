// policy command tests — get/set selfEditPolicy in STATE.yaml
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { policy } from '../src/cli/commands/policy.js';
import { loadState, saveState } from '../src/core/state.js';

let baseDir: string;
before(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-test-'));
});
after(async () => {
  await fs.rm(baseDir, { recursive: true, force: true });
});

// Reset process.exitCode between tests so mutations don't leak across test boundaries
let _savedExitCode: number | undefined;
beforeEach(() => { _savedExitCode = process.exitCode as number | undefined; process.exitCode = undefined; });
afterEach(() => { process.exitCode = _savedExitCode; });

// Helper: create a fresh project dir with minimal state
async function freshProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-proj-'));
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  const state = await loadState({ cwd: dir }).catch(() => ({
    project: 'test',
    workflowStage: 'initialized' as const,
    currentPhase: 1,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
  }));
  await saveState(state as Parameters<typeof saveState>[0], { cwd: dir });
  return dir;
}

describe('policy command — get', () => {
  it('get with no prior policy does not mutate state', async () => {
    const dir = await freshProject();
    try {
      const stateBefore = await loadState({ cwd: dir });
      assert.strictEqual(stateBefore.selfEditPolicy, 'deny'); // default applied on load
      await policy('get', undefined, { cwd: dir });
      const stateAfter = await loadState({ cwd: dir });
      assert.strictEqual(stateAfter.selfEditPolicy, stateBefore.selfEditPolicy, 'get should not mutate selfEditPolicy');
      assert.strictEqual(stateAfter.auditLog.length, stateBefore.auditLog.length, 'get should not add audit log entry');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('get after set reflects the stored value', async () => {
    const dir = await freshProject();
    try {
      await policy('set', 'allow-with-audit', { cwd: dir });
      const stateAfterSet = await loadState({ cwd: dir });
      assert.strictEqual(stateAfterSet.selfEditPolicy, 'allow-with-audit');
      // get should not change the value
      await policy('get', undefined, { cwd: dir });
      const stateAfterGet = await loadState({ cwd: dir });
      assert.strictEqual(stateAfterGet.selfEditPolicy, 'allow-with-audit', 'get should not mutate stored policy');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('policy command — set', () => {
  it('set deny writes to STATE.yaml', async () => {
    const dir = await freshProject();
    try {
      await policy('set', 'deny', { cwd: dir });
      const state = await loadState({ cwd: dir });
      assert.strictEqual(state.selfEditPolicy, 'deny');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('set allow-with-audit writes to STATE.yaml', async () => {
    const dir = await freshProject();
    try {
      await policy('set', 'allow-with-audit', { cwd: dir });
      const state = await loadState({ cwd: dir });
      assert.strictEqual(state.selfEditPolicy, 'allow-with-audit');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('set confirm writes to STATE.yaml', async () => {
    const dir = await freshProject();
    try {
      await policy('set', 'confirm', { cwd: dir });
      const state = await loadState({ cwd: dir });
      assert.strictEqual(state.selfEditPolicy, 'confirm');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('set adds an audit log entry', async () => {
    const dir = await freshProject();
    try {
      const stateBefore = await loadState({ cwd: dir });
      const logLenBefore = stateBefore.auditLog.length;
      await policy('set', 'deny', { cwd: dir });
      const stateAfter = await loadState({ cwd: dir });
      assert.ok(stateAfter.auditLog.length > logLenBefore);
      assert.ok(stateAfter.auditLog.at(-1)?.includes('selfEditPolicy'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('set with invalid value sets exitCode=1 and does not mutate state', async () => {
    const dir = await freshProject();
    try {
      await policy('set', 'super-allow', { cwd: dir });
      assert.strictEqual(process.exitCode, 1);
      const state = await loadState({ cwd: dir });
      assert.notStrictEqual(state.selfEditPolicy, 'super-allow'); // invalid value rejected
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('set with no value sets exitCode=1', async () => {
    const dir = await freshProject();
    try {
      await policy('set', undefined, { cwd: dir });
      assert.strictEqual(process.exitCode, 1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('policy command — unknown action', () => {
  it('unknown action sets exitCode=1', async () => {
    const dir = await freshProject();
    try {
      await policy('delete', undefined, { cwd: dir });
      assert.strictEqual(process.exitCode, 1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('roundtrip: set then verify state file contains the policy', async () => {
    const dir = await freshProject();
    try {
      await policy('set', 'confirm', { cwd: dir });
      const state = await loadState({ cwd: dir });
      assert.strictEqual(state.selfEditPolicy, 'confirm');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
