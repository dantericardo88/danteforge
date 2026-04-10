// state-audit-bound.test.ts — audit log bounding in saveState (v0.19.0)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { saveState, loadState, AUDIT_LOG_MAX_ENTRIES, type DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'audit-bound-test',
    lastHandoff: 'initialized',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    ...overrides,
  } as DanteState;
}

describe('saveState — audit log bounding', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-audit-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('AUDIT_LOG_MAX_ENTRIES is exported and equals 500', () => {
    assert.equal(AUDIT_LOG_MAX_ENTRIES, 500);
  });

  it('audit log with 501 entries is trimmed to 500 on save', async () => {
    const auditLog = Array.from({ length: 501 }, (_, i) => `entry-${i}`);
    const state = makeState({ auditLog });
    await saveState(state, { cwd: tmpDir });
    const stateFile = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    const content = await fs.readFile(stateFile, 'utf8');
    const parsed = yaml.parse(content);
    assert.equal(parsed.auditLog.length, 500, 'should be trimmed to 500');
  });

  it('trimming keeps the most recent entries (last 500)', async () => {
    const auditLog = Array.from({ length: 510 }, (_, i) => `entry-${i}`);
    const state = makeState({ auditLog });
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.auditLog[0], 'entry-10', 'oldest kept entry should be entry-10');
    assert.equal(loaded.auditLog[499], 'entry-509', 'newest entry should be entry-509');
  });

  it('audit log with exactly 500 entries is saved unchanged', async () => {
    const auditLog = Array.from({ length: 500 }, (_, i) => `entry-${i}`);
    const state = makeState({ auditLog });
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.auditLog.length, 500);
    assert.equal(loaded.auditLog[0], 'entry-0');
    assert.equal(loaded.auditLog[499], 'entry-499');
  });

  it('empty audit log is saved unchanged', async () => {
    const state = makeState({ auditLog: [] });
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.deepEqual(loaded.auditLog, []);
  });

  it('audit log with 499 entries is saved unchanged', async () => {
    const auditLog = Array.from({ length: 499 }, (_, i) => `e${i}`);
    const state = makeState({ auditLog });
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.auditLog.length, 499);
  });
});
