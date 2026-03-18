import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadState, saveState } from '../src/core/state.js';

describe('state management', () => {
  let originalCwd: string;
  let tmpDir: string;

  before(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-test-'));
    process.chdir(tmpDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads state with all required fields', async () => {
    const state = await loadState();
    assert.strictEqual(typeof state.project, 'string');
    assert.strictEqual(typeof state.lastHandoff, 'string');
    assert.strictEqual(typeof state.workflowStage, 'string');
    assert.strictEqual(typeof state.currentPhase, 'number');
    assert.ok(typeof state.tasks === 'object');
    assert.ok(Array.isArray(state.auditLog));
    assert.strictEqual(typeof state.profile, 'string');
  });

  it('round-trips state through save and load', async () => {
    const state = await loadState();
    const marker = `test-roundtrip-${Date.now()}`;
    state.auditLog.push(marker);
    await saveState(state);

    const reloaded = await loadState();
    assert.ok(reloaded.auditLog.includes(marker));
  });

  it('preserves optional fields through save/load', async () => {
    const state = await loadState();
    state.tddEnabled = true;
    state.lightMode = false;
    await saveState(state);

    const reloaded = await loadState();
    assert.strictEqual(reloaded.tddEnabled, true);
    assert.strictEqual(reloaded.lightMode, false);
  });

  it('derives the project name from package.json when present', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'battle-station' }, null, 2),
      'utf8',
    );

    const state = await loadState();
    assert.strictEqual(state.project, 'battle-station');
  });

  it('defaults workflowStage to initialized for a new workspace', async () => {
    const state = await loadState();
    assert.strictEqual(state.workflowStage, 'initialized');
  });
});
