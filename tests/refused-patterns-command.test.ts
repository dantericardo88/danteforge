import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRefusedPatterns } from '../src/cli/commands/refused-patterns.js';
import type { RefusedPatternsStore } from '../src/core/refused-patterns.js';

function makeStore(patterns: RefusedPatternsStore['patterns'] = []): RefusedPatternsStore {
  return { version: '1.0.0', patterns, updatedAt: new Date().toISOString() };
}

describe('refused-patterns command', () => {
  it('T1: lists patterns from a non-empty store', async () => {
    const store = makeStore([{
      patternName: 'lazy-caching',
      sourceRepo: 'acme/repo',
      refusedAt: new Date().toISOString(),
      reason: 'hypothesis-falsified',
      laggingDelta: -0.3,
    }]);
    const result = await runRefusedPatterns({
      _load: async () => store,
      _save: async () => {},
    });
    assert.strictEqual(result.action, 'list');
    assert.strictEqual(result.patternCount, 1);
    assert.strictEqual(result.changed, false);
  });

  it('T2: empty store returns list action with count 0', async () => {
    const result = await runRefusedPatterns({
      _load: async () => makeStore([]),
      _save: async () => {},
    });
    assert.strictEqual(result.action, 'list');
    assert.strictEqual(result.patternCount, 0);
  });

  it('T3: --add creates a manual refusal entry', async () => {
    let saved: RefusedPatternsStore | null = null;
    const result = await runRefusedPatterns({
      add: 'retry-storm',
      _load: async () => makeStore([]),
      _save: async (store) => { saved = store; },
    });
    assert.strictEqual(result.action, 'add');
    assert.strictEqual(result.changed, true);
    assert.ok(saved !== null);
    assert.strictEqual((saved as RefusedPatternsStore).patterns.length, 1);
    assert.strictEqual((saved as RefusedPatternsStore).patterns[0].patternName, 'retry-storm');
    assert.strictEqual((saved as RefusedPatternsStore).patterns[0].reason, 'manual');
  });

  it('T4: --remove deletes the named entry, returns changed=true', async () => {
    const store = makeStore([{
      patternName: 'bad-cache',
      sourceRepo: 'x/y',
      refusedAt: new Date().toISOString(),
      reason: 'manual',
    }]);
    let saved: RefusedPatternsStore | null = null;
    const result = await runRefusedPatterns({
      remove: 'bad-cache',
      _load: async () => store,
      _save: async (s) => { saved = s; },
    });
    assert.strictEqual(result.action, 'remove');
    assert.strictEqual(result.changed, true);
    assert.strictEqual((saved as RefusedPatternsStore | null)?.patterns.length, 0);
  });

  it('T4b: --remove returns changed=false when pattern not found', async () => {
    const result = await runRefusedPatterns({
      remove: 'nonexistent',
      _load: async () => makeStore([]),
      _save: async () => {},
    });
    assert.strictEqual(result.action, 'remove');
    assert.strictEqual(result.changed, false);
  });

  it('T5: --clear empties the list and returns patternCount 0', async () => {
    const store = makeStore([
      { patternName: 'a', sourceRepo: 'x', refusedAt: '', reason: 'manual' },
      { patternName: 'b', sourceRepo: 'y', refusedAt: '', reason: 'manual' },
    ]);
    let saved: RefusedPatternsStore | null = null;
    const result = await runRefusedPatterns({
      clear: true,
      _load: async () => store,
      _save: async (s) => { saved = s; },
    });
    assert.strictEqual(result.action, 'clear');
    assert.strictEqual(result.patternCount, 0);
    assert.strictEqual(result.changed, true);
    assert.strictEqual((saved as RefusedPatternsStore | null)?.patterns.length, 0);
  });

  it('T6: _load/_save injection works — does not touch filesystem', async () => {
    let loadCalled = false;
    let saveCalled = false;
    await runRefusedPatterns({
      add: 'test-pattern',
      _load: async () => { loadCalled = true; return makeStore([]); },
      _save: async () => { saveCalled = true; },
    });
    assert.ok(loadCalled, '_load must be called');
    assert.ok(saveCalled, '_save must be called');
  });
});
