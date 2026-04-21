import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadMemoryStore, saveMemoryStore, type MemoryEntry } from '../src/core/memory-store.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'entry-1',
    timestamp: new Date().toISOString(),
    sessionId: 'session-1',
    category: 'command',
    summary: 'Test entry',
    detail: 'Details here',
    tags: [],
    relatedCommands: [],
    tokenCount: 10,
    ...overrides,
  };
}

describe('loadMemoryStore', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-store-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty store when file does not exist', async () => {
    const store = await loadMemoryStore(tmpDir);
    assert.equal(store.version, '1.0.0');
    assert.deepEqual(store.entries, []);
  });

  it('loads stored entries', async () => {
    const dir = path.join(tmpDir, 'load-test');
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
    const entry = makeEntry({ id: 'abc', summary: 'hello' });
    const store = { version: '1.0.0' as const, entries: [entry] };
    await fs.writeFile(path.join(dir, '.danteforge', 'memory.json'), JSON.stringify(store));

    const loaded = await loadMemoryStore(dir);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].id, 'abc');
  });

  it('returns empty store for corrupted file', async () => {
    const dir = path.join(tmpDir, 'corrupt-test');
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(dir, '.danteforge', 'memory.json'), 'not-valid-json{{{');

    const store = await loadMemoryStore(dir);
    assert.deepEqual(store.entries, []);
  });

  it('handles missing entries array gracefully', async () => {
    const dir = path.join(tmpDir, 'missing-entries-test');
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(dir, '.danteforge', 'memory.json'), JSON.stringify({ version: '1.0.0' }));

    const store = await loadMemoryStore(dir);
    assert.deepEqual(store.entries, []);
  });
});

describe('saveMemoryStore', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-store-save-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .danteforge directory if missing', async () => {
    const dir = path.join(tmpDir, 'save-mkdir-test');
    const store = { version: '1.0.0' as const, entries: [] };
    await saveMemoryStore(store, dir);

    const stat = await fs.stat(path.join(dir, '.danteforge', 'memory.json'));
    assert.ok(stat.isFile());
  });

  it('persists entries that can be reloaded', async () => {
    const dir = path.join(tmpDir, 'roundtrip-test');
    const entry = makeEntry({ id: 'rt-1', summary: 'Roundtrip test', category: 'insight' });
    const store = { version: '1.0.0' as const, entries: [entry] };
    await saveMemoryStore(store, dir);

    const loaded = await loadMemoryStore(dir);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].id, 'rt-1');
    assert.equal(loaded.entries[0].category, 'insight');
  });

  it('overwrites existing store', async () => {
    const dir = path.join(tmpDir, 'overwrite-test');
    const store1 = { version: '1.0.0' as const, entries: [makeEntry({ id: 'old' })] };
    await saveMemoryStore(store1, dir);

    const store2 = { version: '1.0.0' as const, entries: [makeEntry({ id: 'new' })] };
    await saveMemoryStore(store2, dir);

    const loaded = await loadMemoryStore(dir);
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].id, 'new');
  });
});
