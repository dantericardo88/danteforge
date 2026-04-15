import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadRefusedPatterns,
  saveRefusedPatterns,
  addRefusedPattern,
  isPatternRefused,
  buildRefusedPatternsPromptSection,
  removeRefusedPattern,
  type RefusedPattern,
  type RefusedPatternsStore,
} from '../src/core/refused-patterns.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMemoryStore(initial?: RefusedPatternsStore): {
  fsRead: (p: string) => Promise<string>;
  fsWrite: (p: string, d: string) => Promise<void>;
  getStored: () => RefusedPatternsStore | null;
} {
  let stored: string | null = initial ? JSON.stringify(initial) : null;
  return {
    fsRead: async () => { if (stored === null) throw new Error('ENOENT'); return stored; },
    fsWrite: async (_p, d) => { stored = d; },
    getStored: () => stored ? JSON.parse(stored) : null,
  };
}

function makeEntry(overrides: Partial<RefusedPattern> = {}): RefusedPattern {
  return {
    patternName: 'circuit-breaker',
    sourceRepo: 'github.com/example/repo',
    refusedAt: new Date().toISOString(),
    reason: 'hypothesis-falsified',
    hypothesis: 'Expected error-handling to improve',
    laggingDelta: -0.5,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('refused-patterns', () => {
  it('T1: loadRefusedPatterns returns empty store when file not found', async () => {
    const store = await loadRefusedPatterns('/fake', async () => { throw new Error('ENOENT'); });
    assert.equal(store.patterns.length, 0);
    assert.equal(store.version, '1.0.0');
  });

  it('T2: addRefusedPattern persists entry and isPatternRefused returns true', async () => {
    const mem = makeMemoryStore();
    await addRefusedPattern(makeEntry(), '/fake', { _fsRead: mem.fsRead, _fsWrite: mem.fsWrite });

    const store = mem.getStored()!;
    assert.equal(store.patterns.length, 1);
    assert.equal(store.patterns[0].patternName, 'circuit-breaker');
    assert.equal(isPatternRefused('circuit-breaker', store), true);
  });

  it('T3: addRefusedPattern is idempotent — adding same pattern twice keeps one entry', async () => {
    const mem = makeMemoryStore();
    const entry = makeEntry();
    await addRefusedPattern(entry, '/fake', { _fsRead: mem.fsRead, _fsWrite: mem.fsWrite });
    await addRefusedPattern(entry, '/fake', { _fsRead: mem.fsRead, _fsWrite: mem.fsWrite });

    const store = mem.getStored()!;
    assert.equal(store.patterns.length, 1, 'should not duplicate');
  });

  it('T4: isPatternRefused returns false for unknown pattern', async () => {
    const store: RefusedPatternsStore = { version: '1.0.0', patterns: [makeEntry()], updatedAt: '' };
    assert.equal(isPatternRefused('retry-logic', store), false);
  });

  it('T5: buildRefusedPatternsPromptSection returns empty string when no refused patterns', () => {
    const store: RefusedPatternsStore = { version: '1.0.0', patterns: [], updatedAt: '' };
    assert.equal(buildRefusedPatternsPromptSection(store), '');
  });

  it('T6: buildRefusedPatternsPromptSection includes pattern names and reasons', () => {
    const store: RefusedPatternsStore = {
      version: '1.0.0',
      patterns: [
        makeEntry({ patternName: 'retry-logic', reason: 'hypothesis-falsified', laggingDelta: -1.2 }),
        makeEntry({ patternName: 'dead-letter-queue', reason: 'verify-failed' }),
      ],
      updatedAt: '',
    };
    const section = buildRefusedPatternsPromptSection(store);
    assert.ok(section.includes('retry-logic'), 'should include first pattern');
    assert.ok(section.includes('dead-letter-queue'), 'should include second pattern');
    assert.ok(section.includes('REFUSED'), 'should have header');
    assert.ok(section.includes('falsified'), 'should describe reason');
  });

  it('T7: removeRefusedPattern removes the entry and returns true', async () => {
    const store: RefusedPatternsStore = { version: '1.0.0', patterns: [makeEntry()], updatedAt: '' };
    const mem = makeMemoryStore(store);

    const removed = await removeRefusedPattern('circuit-breaker', '/fake', {
      _fsRead: mem.fsRead,
      _fsWrite: mem.fsWrite,
    });

    assert.equal(removed, true);
    assert.equal(mem.getStored()!.patterns.length, 0);
  });

  it('T8: removeRefusedPattern returns false when pattern not found', async () => {
    const mem = makeMemoryStore();
    const removed = await removeRefusedPattern('nonexistent', '/fake', {
      _fsRead: mem.fsRead,
      _fsWrite: mem.fsWrite,
    });
    assert.equal(removed, false);
  });
});
