// State cache tests — TTL-based in-memory cache for loadState/saveState
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import {
  cachedLoadState,
  cachedSaveState,
  invalidateStateCache,
  getStateCacheSize,
} from '../src/core/state-cache.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cache-'));
  tempDirs.push(dir);
  const dfDir = path.join(dir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), yaml.stringify({
    project: 'cache-test',
    created: new Date().toISOString(),
    workflowStage: 'forge',
    currentPhase: 1,
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    auditLog: [],
  }));
  return dir;
}

describe('state-cache', () => {
  beforeEach(() => { invalidateStateCache(); });

  after(async () => {
    invalidateStateCache();
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('cachedLoadState returns cached value within TTL', async () => {
    const dir = await makeTempDir();
    const first = await cachedLoadState({ cwd: dir, ttlMs: 5000 });
    assert.equal(first.project, 'cache-test');

    // Modify the file on disk — cached value should still be returned
    const stateFile = path.join(dir, '.danteforge', 'STATE.yaml');
    const raw = yaml.parse(await fs.readFile(stateFile, 'utf-8'));
    raw.project = 'modified-on-disk';
    await fs.writeFile(stateFile, yaml.stringify(raw));

    const second = await cachedLoadState({ cwd: dir, ttlMs: 5000 });
    assert.equal(second.project, 'cache-test', 'Should return cached value, not disk value');
  });

  it('cachedLoadState refreshes after TTL expires', async () => {
    const dir = await makeTempDir();
    await cachedLoadState({ cwd: dir, ttlMs: 1 }); // very short TTL

    // Modify on disk
    const stateFile = path.join(dir, '.danteforge', 'STATE.yaml');
    const raw = yaml.parse(await fs.readFile(stateFile, 'utf-8'));
    raw.project = 'refreshed';
    await fs.writeFile(stateFile, yaml.stringify(raw));

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 10));
    const fresh = await cachedLoadState({ cwd: dir, ttlMs: 1 });
    assert.equal(fresh.project, 'refreshed', 'Should reload from disk after TTL');
  });

  it('cachedSaveState updates cache and persists to disk', async () => {
    const dir = await makeTempDir();
    const state = await cachedLoadState({ cwd: dir });
    state.project = 'saved-via-cache';
    await cachedSaveState(state, { cwd: dir });

    // Verify disk
    const stateFile = path.join(dir, '.danteforge', 'STATE.yaml');
    const diskRaw = yaml.parse(await fs.readFile(stateFile, 'utf-8'));
    assert.equal(diskRaw.project, 'saved-via-cache');

    // Verify cache returns updated value
    const cached = await cachedLoadState({ cwd: dir, ttlMs: 5000 });
    assert.equal(cached.project, 'saved-via-cache');
  });

  it('invalidateStateCache(cwd) clears specific entry', async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();
    await cachedLoadState({ cwd: dir1 });
    await cachedLoadState({ cwd: dir2 });
    assert.equal(getStateCacheSize(), 2);

    invalidateStateCache(dir1);
    assert.equal(getStateCacheSize(), 1);
  });

  it('invalidateStateCache() clears all entries', async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();
    await cachedLoadState({ cwd: dir1 });
    await cachedLoadState({ cwd: dir2 });
    assert.ok(getStateCacheSize() >= 2);

    invalidateStateCache();
    assert.equal(getStateCacheSize(), 0);
  });

  it('getStateCacheSize reflects cache entries', async () => {
    assert.equal(getStateCacheSize(), 0);
    const dir = await makeTempDir();
    await cachedLoadState({ cwd: dir });
    assert.equal(getStateCacheSize(), 1);
  });
});
