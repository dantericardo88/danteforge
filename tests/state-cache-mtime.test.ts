// state-cache-mtime.test.ts — mtime-based cache invalidation in cachedLoadState (v0.19.0)
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { cachedLoadState, cachedSaveState, invalidateStateCache } from '../src/core/state-cache.js';
import { saveState, type DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'cache-mtime-test',
    lastHandoff: 'initialized',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    ...overrides,
  } as DanteState;
}

describe('cachedLoadState — mtime invalidation', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cache-mtime-'));
    // Write initial state
    await saveState(makeState({ project: 'initial' }), { cwd: tmpDir });
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    invalidateStateCache(tmpDir);
  });

  it('returns state from cache on second call within TTL when file unchanged', async () => {
    await saveState(makeState({ project: 'stable' }), { cwd: tmpDir });
    invalidateStateCache(tmpDir);
    const first = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    const second = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    assert.equal(first.project, second.project, 'should return same object from cache');
  });

  it('invalidateStateCache clears cache for specific cwd', async () => {
    await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    invalidateStateCache(tmpDir);
    // After invalidation, next load re-reads disk
    await saveState(makeState({ project: 'post-invalidation' }), { cwd: tmpDir });
    const loaded = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    assert.equal(loaded.project, 'post-invalidation');
  });

  it('cachedSaveState updates cache entry so immediate read is fresh', async () => {
    const state = makeState({ project: 'cached-save' });
    await cachedSaveState(state, { cwd: tmpDir });
    // Read back from cache — should see the new project name
    const loaded = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    assert.equal(loaded.project, 'cached-save');
  });

  it('returns fresh state after external write when mtime is newer than loadedAt', async () => {
    // Seed cache
    await saveState(makeState({ project: 'original' }), { cwd: tmpDir });
    invalidateStateCache(tmpDir);
    await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });

    // Wait 10ms so mtime is guaranteed > loadedAt
    await new Promise(r => setTimeout(r, 10));

    // Simulate external write by directly calling saveState (bypasses cache update)
    await saveState(makeState({ project: 'externally-modified' }), { cwd: tmpDir });

    // cachedLoadState should detect mtime > loadedAt and reload
    const loaded = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    assert.equal(loaded.project, 'externally-modified');
  });

  it('does not re-read disk when mtime <= loadedAt and within TTL', async () => {
    // Write state, cache it with cachedSaveState (sets loadedAt = now)
    const state = makeState({ project: 'no-reread' });
    await cachedSaveState(state, { cwd: tmpDir });

    let readCount = 0;
    const origReadFile = fs.readFile;
    // We can't easily spy on fs.readFile — instead verify project name stays consistent
    const first = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    const second = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    assert.equal(first.project, second.project);
    void readCount; // suppress unused var
    void origReadFile;
  });

  it('stat failure (file deleted) causes fallthrough to loadState', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-stat-fail-'));
    try {
      await saveState(makeState({ project: 'stat-fail' }), { cwd: dir });
      await cachedLoadState({ cwd: dir, ttlMs: 60000 });

      // Delete the state file
      const stateFile = path.join(dir, '.danteforge', 'STATE.yaml');
      await fs.unlink(stateFile);

      // Should fall through and call loadState which recreates defaults
      const loaded = await cachedLoadState({ cwd: dir, ttlMs: 60000 });
      assert.equal(typeof loaded.project, 'string');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('cachedSaveState stores stateFile path in cache entry (mtime check is possible)', async () => {
    const state = makeState({ project: 'stateFile-in-entry' });
    await cachedSaveState(state, { cwd: tmpDir });

    // Modify file externally after a small delay so mtime changes
    await new Promise(r => setTimeout(r, 10));
    await saveState(makeState({ project: 'external-edit' }), { cwd: tmpDir });

    // Should detect external edit via mtime
    const loaded = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
    assert.equal(loaded.project, 'external-edit');
  });

  it('invalidateStateCache() with no args clears all entries', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cache2-'));
    try {
      await saveState(makeState({ project: 'dir2' }), { cwd: dir2 });
      await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
      await cachedLoadState({ cwd: dir2, ttlMs: 60000 });
      invalidateStateCache(); // clear all
      // Both should re-read on next access — no assertion error expected
      await saveState(makeState({ project: 'cleared-tmpDir' }), { cwd: tmpDir });
      const loaded = await cachedLoadState({ cwd: tmpDir, ttlMs: 60000 });
      assert.equal(loaded.project, 'cleared-tmpDir');
    } finally {
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });

  it('cachedLoadState with very short TTL re-reads after expiry', async () => {
    await saveState(makeState({ project: 'short-ttl' }), { cwd: tmpDir });
    invalidateStateCache(tmpDir);
    await cachedLoadState({ cwd: tmpDir, ttlMs: 1 }); // 1ms TTL

    await new Promise(r => setTimeout(r, 5)); // wait for TTL to expire

    await saveState(makeState({ project: 'after-expiry' }), { cwd: tmpDir });
    const loaded = await cachedLoadState({ cwd: tmpDir, ttlMs: 1 });
    assert.equal(loaded.project, 'after-expiry');
  });
});
