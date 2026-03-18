import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadMemoryStore, saveMemoryStore } from '../src/core/memory-store.js';
import { recordMemory, searchMemory, getRecentMemory, getMemoryBudget } from '../src/core/memory-engine.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-mem-test-'));
  await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('returns empty store when file does not exist', async () => {
    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.version, '1.0.0');
    assert.strictEqual(store.entries.length, 0);
  });

  it('round-trips store to disk', async () => {
    const store = {
      version: '1.0.0' as const,
      entries: [
        {
          id: 'test-1',
          timestamp: '2026-03-12T00:00:00.000Z',
          sessionId: 'sess-1',
          category: 'command' as const,
          summary: 'Ran forge',
          detail: 'Full forge output...',
          tags: ['forge'],
          relatedCommands: ['forge'],
          tokenCount: 10,
        },
      ],
    };
    await saveMemoryStore(store, tmpDir);
    const loaded = await loadMemoryStore(tmpDir);
    assert.strictEqual(loaded.entries.length, 1);
    assert.strictEqual(loaded.entries[0].id, 'test-1');
    assert.strictEqual(loaded.entries[0].summary, 'Ran forge');
  });
});

describe('recordMemory', () => {
  it('appends an entry to the store', async () => {
    await recordMemory(
      {
        category: 'decision',
        summary: 'Selected React as frontend framework',
        detail: 'Based on team expertise and project requirements',
        tags: ['tech-decide', 'react'],
        relatedCommands: ['tech-decide'],
      },
      tmpDir,
    );

    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.entries.length, 1);
    assert.strictEqual(store.entries[0].category, 'decision');
    assert.strictEqual(store.entries[0].summary, 'Selected React as frontend framework');
    assert.ok(store.entries[0].id.length > 0);
    assert.ok(store.entries[0].timestamp.length > 0);
    assert.ok(store.entries[0].tokenCount > 0);
  });

  it('appends multiple entries sequentially', async () => {
    for (let i = 0; i < 3; i++) {
      await recordMemory(
        {
          category: 'command',
          summary: `Command ${i}`,
          detail: `Detail ${i}`,
          tags: [`tag-${i}`],
          relatedCommands: ['forge'],
        },
        tmpDir,
      );
    }

    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.entries.length, 3);
  });
});

describe('searchMemory', () => {
  it('returns empty array for empty store', async () => {
    const results = await searchMemory('anything', 10, tmpDir);
    assert.strictEqual(results.length, 0);
  });

  it('finds entries by keyword match', async () => {
    await recordMemory({ category: 'decision', summary: 'Selected React', detail: 'Framework decision', tags: ['react'], relatedCommands: ['tech-decide'] }, tmpDir);
    await recordMemory({ category: 'command', summary: 'Ran forge phase 1', detail: 'Build step', tags: ['forge'], relatedCommands: ['forge'] }, tmpDir);
    await recordMemory({ category: 'error', summary: 'React import failed', detail: 'Missing dependency', tags: ['react', 'error'], relatedCommands: ['forge'] }, tmpDir);

    const results = await searchMemory('react', 10, tmpDir);
    assert.strictEqual(results.length, 2);
    // Error + correction categories should score higher
    assert.strictEqual(results[0].category, 'error');
  });

  it('returns recent entries when query has no meaningful keywords', async () => {
    await recordMemory({ category: 'command', summary: 'Test entry', detail: 'Details', tags: [], relatedCommands: [] }, tmpDir);
    const results = await searchMemory('a b', 10, tmpDir);
    // Keywords too short (< 3 chars), falls back to recent entries
    assert.strictEqual(results.length, 1);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await recordMemory({ category: 'command', summary: `test entry ${i}`, detail: 'test detail', tags: ['test'], relatedCommands: [] }, tmpDir);
    }
    const results = await searchMemory('test', 2, tmpDir);
    assert.strictEqual(results.length, 2);
  });
});

describe('getRecentMemory', () => {
  it('returns last N entries chronologically', async () => {
    for (let i = 0; i < 5; i++) {
      await recordMemory({ category: 'command', summary: `Entry ${i}`, detail: '', tags: [], relatedCommands: [] }, tmpDir);
    }
    const recent = await getRecentMemory(3, tmpDir);
    assert.strictEqual(recent.length, 3);
    assert.strictEqual(recent[0].summary, 'Entry 2');
    assert.strictEqual(recent[2].summary, 'Entry 4');
  });
});

describe('getMemoryBudget', () => {
  it('returns zero for empty store', async () => {
    const budget = await getMemoryBudget(tmpDir);
    assert.strictEqual(budget.totalTokens, 0);
    assert.strictEqual(budget.entryCount, 0);
    assert.strictEqual(budget.oldestEntry, null);
  });

  it('tracks token budget correctly', async () => {
    await recordMemory({ category: 'command', summary: 'Test', detail: 'Some detail text here', tags: [], relatedCommands: [] }, tmpDir);
    const budget = await getMemoryBudget(tmpDir);
    assert.strictEqual(budget.entryCount, 1);
    assert.ok(budget.totalTokens > 0);
    assert.ok(budget.oldestEntry !== null);
  });
});
