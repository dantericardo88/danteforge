import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadState, saveState } from '../src/core/state.js';

describe('state management', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads state with all required fields', async () => {
    const state = await loadState({ cwd: tmpDir });
    assert.strictEqual(typeof state.project, 'string');
    assert.strictEqual(typeof state.lastHandoff, 'string');
    assert.strictEqual(typeof state.workflowStage, 'string');
    assert.strictEqual(typeof state.currentPhase, 'number');
    assert.ok(typeof state.tasks === 'object');
    assert.ok(Array.isArray(state.auditLog));
    assert.strictEqual(typeof state.profile, 'string');
  });

  it('round-trips state through save and load', async () => {
    const state = await loadState({ cwd: tmpDir });
    const marker = `test-roundtrip-${Date.now()}`;
    state.auditLog.push(marker);
    await saveState(state, { cwd: tmpDir });

    const reloaded = await loadState({ cwd: tmpDir });
    assert.ok(reloaded.auditLog.includes(marker));
  });

  it('preserves optional fields through save/load', async () => {
    const state = await loadState({ cwd: tmpDir });
    state.tddEnabled = true;
    state.lightMode = false;
    await saveState(state, { cwd: tmpDir });

    const reloaded = await loadState({ cwd: tmpDir });
    assert.strictEqual(reloaded.tddEnabled, true);
    assert.strictEqual(reloaded.lightMode, false);
  });

  it('derives the project name from package.json when present', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'battle-station' }, null, 2),
      'utf8',
    );

    const state = await loadState({ cwd: tmpDir });
    assert.strictEqual(state.project, 'battle-station');
  });

  it('defaults workflowStage to initialized for a new workspace', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-fresh-'));
    try {
      const state = await loadState({ cwd: freshDir });
      assert.strictEqual(state.workflowStage, 'initialized');
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });
});
