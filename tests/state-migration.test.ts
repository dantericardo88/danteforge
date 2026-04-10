// state-migration.test.ts — schema migration chain in loadState (v0.19.0)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { loadState, saveState, CURRENT_SCHEMA_VERSION, type DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'migration-test',
    lastHandoff: 'initialized',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    ...overrides,
  } as DanteState;
}

describe('loadState — schema migration', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-migration-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeRawState(cwd: string, raw: object): Promise<void> {
    const stateDir = path.join(cwd, '.danteforge');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'STATE.yaml'), yaml.stringify(raw), 'utf8');
  }

  it('CURRENT_SCHEMA_VERSION is exported and equals 1', () => {
    assert.equal(CURRENT_SCHEMA_VERSION, 1);
  });

  it('v0 state (no _schemaVersion) is migrated to v1 on load', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-v0-'));
    try {
      await writeRawState(dir, {
        project: 'legacy-project',
        lastHandoff: 'initialized',
        workflowStage: 'initialized',
        currentPhase: 0,
        tasks: {},
        auditLog: [],
        profile: 'balanced',
        // deliberately omit _schemaVersion (v0)
      });
      const state = await loadState({ cwd: dir });
      assert.equal(state._schemaVersion, CURRENT_SCHEMA_VERSION, 'should be migrated to current version');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('v1 state (_schemaVersion: 1) is loaded without re-migration', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-v1-'));
    try {
      await writeRawState(dir, {
        project: 'v1-project',
        lastHandoff: 'initialized',
        workflowStage: 'initialized',
        currentPhase: 0,
        tasks: {},
        auditLog: [],
        profile: 'balanced',
        _schemaVersion: 1,
      });
      const state = await loadState({ cwd: dir });
      assert.equal(state._schemaVersion, 1);
      assert.equal(state.project, 'v1-project');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('saveState stamps _schemaVersion = CURRENT_SCHEMA_VERSION', async () => {
    const state = makeState();
    delete (state as Partial<DanteState>)._schemaVersion;
    await saveState(state, { cwd: tmpDir });
    const stateFile = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    const content = await fs.readFile(stateFile, 'utf8');
    const parsed = yaml.parse(content);
    assert.equal(parsed._schemaVersion, CURRENT_SCHEMA_VERSION);
  });

  it('loadState on corrupt YAML throws StateError', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-corrupt-'));
    try {
      const stateDir = path.join(dir, '.danteforge');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, 'STATE.yaml'), 'key: [unclosed bracket\n', 'utf8');
      const { StateError } = await import('../src/core/errors.js');
      await assert.rejects(
        () => loadState({ cwd: dir }),
        (err: unknown) => {
          assert.ok(err instanceof StateError, `expected StateError, got ${(err as Error)?.constructor?.name}`);
          assert.equal((err as InstanceType<typeof StateError>).code, 'STATE_CORRUPT');
          return true;
        },
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('loadState on YAML that parses to null throws StateError', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-null-'));
    try {
      const stateDir = path.join(dir, '.danteforge');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, 'STATE.yaml'), 'null\n', 'utf8');
      const { StateError } = await import('../src/core/errors.js');
      await assert.rejects(
        () => loadState({ cwd: dir }),
        (err: unknown) => {
          assert.ok(err instanceof StateError);
          return true;
        },
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('missing fields in old STATE.yaml are filled with defaults on migration', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-defaults-'));
    try {
      await writeRawState(dir, {
        project: 'sparse-state',
        // many fields intentionally missing
      });
      const state = await loadState({ cwd: dir });
      assert.ok(Array.isArray(state.auditLog), 'auditLog should default to []');
      assert.equal(typeof state.profile, 'string', 'profile should have a default');
      assert.equal(typeof state.currentPhase, 'number', 'currentPhase should default to 0');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('round-trip: save then load preserves all standard fields', async () => {
    const state = makeState({
      project: 'round-trip',
      workflowStage: 'forge',
      currentPhase: 3,
      profile: 'quality',
      auditLog: ['a', 'b'],
    });
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded.project, 'round-trip');
    assert.equal(loaded.workflowStage, 'forge');
    assert.equal(loaded.currentPhase, 3);
    assert.equal(loaded.profile, 'quality');
    assert.deepEqual(loaded.auditLog, ['a', 'b']);
  });

  it('_schemaVersion in saved file equals CURRENT_SCHEMA_VERSION after round-trip', async () => {
    const state = makeState();
    await saveState(state, { cwd: tmpDir });
    const loaded = await loadState({ cwd: tmpDir });
    assert.equal(loaded._schemaVersion, CURRENT_SCHEMA_VERSION);
  });
});
