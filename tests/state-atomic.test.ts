// state-atomic.test.ts — atomic write (temp+rename) behaviour in saveState (v0.19.0)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { saveState, loadState, type DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'atomic-test',
    lastHandoff: 'initialized',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    ...overrides,
  } as DanteState;
}

describe('saveState — atomic write behaviour', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-atomic-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes STATE.yaml that round-trips through loadState', async () => {
    const state = makeState({ project: 'round-trip-project' });
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.project, 'round-trip-project');
  });

  it('leaves no .tmp files after a successful write', async () => {
    const state = makeState();
    await saveState(state, { cwd: tmpDir });
    const stateDir = path.join(tmpDir, '.danteforge');
    const files = await fs.readdir(stateDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0, `found leftover .tmp files: ${tmpFiles.join(', ')}`);
  });

  it('written YAML is valid and parseable', async () => {
    const state = makeState({ project: 'yaml-valid' });
    await saveState(state, { cwd: tmpDir });
    const stateFile = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    const content = await fs.readFile(stateFile, 'utf8');
    const parsed = yaml.parse(content);
    assert.equal(typeof parsed, 'object');
    assert.equal(parsed.project, 'yaml-valid');
  });

  it('replaces existing STATE.yaml atomically (content matches last write)', async () => {
    const state1 = makeState({ project: 'first-write' });
    await saveState(state1, { cwd: tmpDir });
    const state2 = makeState({ project: 'second-write' });
    await saveState(state2, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.project, 'second-write');
  });

  it('stamps _schemaVersion on every save', async () => {
    const state = makeState();
    await saveState(state, { cwd: tmpDir });
    const stateFile = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    const content = await fs.readFile(stateFile, 'utf8');
    const parsed = yaml.parse(content);
    assert.ok(typeof parsed._schemaVersion === 'number', '_schemaVersion should be a number');
    assert.equal(parsed._schemaVersion, 1);
  });

  it('creates .danteforge directory if it does not exist', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-fresh-'));
    try {
      const state = makeState({ project: 'fresh-dir' });
      await saveState(state, { cwd: freshDir });
      const stateFile = path.join(freshDir, '.danteforge', 'STATE.yaml');
      const stat = await fs.stat(stateFile);
      assert.ok(stat.isFile(), 'STATE.yaml should exist after save');
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('sequential saves preserve the last-written state', async () => {
    for (let i = 0; i < 5; i++) {
      await saveState(makeState({ project: `seq-${i}` }), { cwd: tmpDir });
    }
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.project, 'seq-4');
  });

  it('audit log written to disk contains the same entries as state object', async () => {
    const state = makeState({ auditLog: ['entry-A', 'entry-B', 'entry-C'] });
    await saveState(state, { cwd: tmpDir });
    const stateFile = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    const content = await fs.readFile(stateFile, 'utf8');
    const parsed = yaml.parse(content);
    assert.deepEqual(parsed.auditLog, ['entry-A', 'entry-B', 'entry-C']);
  });

  it('loadState after saveState returns identical profile field', async () => {
    const state = makeState({ profile: 'quality' });
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.profile, 'quality');
  });

  it('writes create lock file transiently (lock is released after save)', async () => {
    const state = makeState();
    await saveState(state, { cwd: tmpDir });
    const lockPath = path.join(tmpDir, '.danteforge', '.state.lock');
    let exists = true;
    try {
      await fs.access(lockPath);
    } catch {
      exists = false;
    }
    assert.ok(!exists, 'lock file should be removed after successful save');
  });
});
