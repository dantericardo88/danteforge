import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadMemoryStore, saveMemoryStore } from '../src/core/memory-store.js';
import { recordMemory, searchMemory, getRecentMemory, getMemoryBudget, compactMemory } from '../src/core/memory-engine.js';

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

describe('compactMemory', () => {
  function oldTimestamp(daysAgo = 10): string {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
  }

  it('does nothing for empty store', async () => {
    await assert.doesNotReject(() => compactMemory(200_000, tmpDir));
    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.entries.length, 0);
  });

  it('does nothing when all entries are recent (< 7 days old)', async () => {
    await recordMemory({ category: 'command', summary: 'Recent entry', detail: 'detail', tags: [], relatedCommands: [] }, tmpDir);
    await compactMemory(200_000, tmpDir);
    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.entries.length, 1, 'recent entries should not be removed');
  });

  it('compacts old entries by dropping detail in fallback mode (no LLM)', async () => {
    // Write old entries directly to the store
    const oldEntry = {
      id: 'old-1',
      timestamp: oldTimestamp(15),
      sessionId: 'sess-old',
      category: 'command' as const,
      summary: 'Old forge run',
      detail: 'Long detailed description that should be dropped during compaction for token savings',
      tags: ['forge'],
      relatedCommands: ['forge'],
      tokenCount: 500,
    };
    await saveMemoryStore({ version: '1.0.0', entries: [oldEntry] }, tmpDir);

    // compactMemory with a very large budget — fallback strips detail from old entries
    await compactMemory(200_000, tmpDir);

    const store = await loadMemoryStore(tmpDir);
    // Entry should still exist but detail must be stripped and compactedAt must be set
    assert.strictEqual(store.entries.length, 1, 'entry should survive compaction');
    assert.strictEqual(store.entries[0]!.detail, '', 'detail should be stripped by fallback compaction');
    assert.ok(store.compactedAt !== undefined, 'compactedAt should be set after compaction');
  });

  it('drops oldest entries when over budget after compaction', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `old-${i}`,
      timestamp: oldTimestamp(10 + i),
      sessionId: 'sess-old',
      category: 'command' as const,
      summary: `Old entry ${i}`,
      detail: 'detail',
      tags: [],
      relatedCommands: [],
      tokenCount: 100,
    }));
    await saveMemoryStore({ version: '1.0.0', entries }, tmpDir);

    // Budget of 50 tokens forces dropping of oldest entries
    await compactMemory(50, tmpDir);

    const store = await loadMemoryStore(tmpDir);
    const totalTokens = store.entries.reduce((sum, e) => sum + e.tokenCount, 0);
    assert.ok(totalTokens <= 50, `total tokens ${totalTokens} should be <= 50`);
  });

  it('sets compactedAt and totalEntriesBeforeCompaction after compaction', async () => {
    const oldEntry = {
      id: 'old-1',
      timestamp: oldTimestamp(15),
      sessionId: 'sess',
      category: 'command' as const,
      summary: 'Old',
      detail: 'Detail',
      tags: [],
      relatedCommands: [],
      tokenCount: 10,
    };
    await saveMemoryStore({ version: '1.0.0', entries: [oldEntry] }, tmpDir);

    await compactMemory(200_000, tmpDir);

    const store = await loadMemoryStore(tmpDir);
    assert.ok(store.compactedAt, 'compactedAt should be set');
    assert.strictEqual(store.totalEntriesBeforeCompaction, 1);
  });
});

describe('compactMemory — _llmCaller injection (LLM-assisted path)', () => {
  function oldTimestamp(daysAgo = 10): string {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
  }

  function makeOldEntries(count: number, category: 'command' | 'decision' | 'error' = 'command') {
    return Array.from({ length: count }, (_, i) => ({
      id: `old-${i}`,
      timestamp: oldTimestamp(15 + i),
      sessionId: 'sess-old',
      category,
      summary: `Old entry ${i}`,
      detail: `Detail for entry ${i}`,
      tags: [`tag-${i}`],
      relatedCommands: ['forge'],
      tokenCount: 50,
    }));
  }

  it('uses _llmCaller when group has > 2 entries of same category', async () => {
    let llmCallCount = 0;
    const llmCaller = async (_prompt: string) => {
      llmCallCount++;
      return 'Compacted summary of all entries';
    };

    const entries = makeOldEntries(3, 'command');
    await saveMemoryStore({ version: '1.0.0', entries }, tmpDir);

    await compactMemory(200_000, tmpDir, llmCaller);

    assert.strictEqual(llmCallCount, 1, 'should call LLM once for the command group');
    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.entries.length, 1, '3 entries compacted into 1');
    assert.ok(store.entries[0]!.summary.includes('Compacted'), 'summary should indicate compaction');
  });

  it('passes small groups (≤ 2 entries) through without calling _llmCaller', async () => {
    let llmCallCount = 0;
    const llmCaller = async (_prompt: string) => {
      llmCallCount++;
      return 'Should not be called';
    };

    const entries = makeOldEntries(2, 'decision');
    await saveMemoryStore({ version: '1.0.0', entries }, tmpDir);

    await compactMemory(200_000, tmpDir, llmCaller);

    assert.strictEqual(llmCallCount, 0, 'should not call LLM for groups of ≤ 2');
    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.entries.length, 2, 'small group should pass through unchanged');
  });

  it('calls _llmCaller once per category group with > 2 entries', async () => {
    let callCount = 0;
    const llmCaller = async (_prompt: string) => {
      callCount++;
      return 'Summary';
    };

    const cmdEntries = makeOldEntries(3, 'command');
    const decEntries = makeOldEntries(3, 'decision');
    await saveMemoryStore({ version: '1.0.0', entries: [...cmdEntries, ...decEntries] }, tmpDir);

    await compactMemory(200_000, tmpDir, llmCaller);

    assert.strictEqual(callCount, 2, 'should call LLM once per large category group (2 groups)');
  });

  it('falls back to fallback path when _llmCaller throws', async () => {
    const throwingLlm = async (_prompt: string): Promise<string> => {
      throw new Error('LLM network error');
    };

    const entries = makeOldEntries(3, 'error');
    await saveMemoryStore({ version: '1.0.0', entries }, tmpDir);

    await compactMemory(200_000, tmpDir, throwingLlm);

    // Fallback path should have run — entries still exist with detail stripped
    const store = await loadMemoryStore(tmpDir);
    assert.ok(store.compactedAt !== undefined, 'compactedAt should be set even after LLM error');
    assert.ok(store.entries.length >= 1, 'entries should survive even after LLM failure');
  });

  it('sets compactedAt and totalEntriesBeforeCompaction via LLM path', async () => {
    const llmCaller = async (_prompt: string) => 'Summarized entry';
    const entries = makeOldEntries(3, 'command');
    await saveMemoryStore({ version: '1.0.0', entries }, tmpDir);

    await compactMemory(200_000, tmpDir, llmCaller);

    const store = await loadMemoryStore(tmpDir);
    assert.ok(store.compactedAt, 'compactedAt should be set via LLM path');
    assert.strictEqual(store.totalEntriesBeforeCompaction, 3);
  });

  it('response from _llmCaller becomes the detail of the compacted entry', async () => {
    const expectedSummary = 'Key insight from LLM compaction';
    const llmCaller = async (_prompt: string) => expectedSummary;

    const entries = makeOldEntries(3, 'command');
    await saveMemoryStore({ version: '1.0.0', entries }, tmpDir);

    await compactMemory(200_000, tmpDir, llmCaller);

    const store = await loadMemoryStore(tmpDir);
    assert.strictEqual(store.entries[0]!.detail, expectedSummary, 'LLM response should be stored as detail');
  });
});
