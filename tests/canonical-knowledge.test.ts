// canonical knowledge command — injection-seam tests
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalKnowledge } from '../src/cli/commands/canonical.js';

describe('canonicalKnowledge', () => {
  it('dispatches learn action with entry', async () => {
    let received = '';
    await canonicalKnowledge({
      action: 'learn',
      entry: 'always seed the DB before tests',
      _fns: { learn: async (e: string) => { received = e; } },
    });
    assert.strictEqual(received, 'always seed the DB before tests');
  });

  it('dispatches prime action', async () => {
    let called = false;
    await canonicalKnowledge({ action: 'prime', _fns: { prime: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('dispatches explain action with target', async () => {
    let received = '';
    await canonicalKnowledge({
      action: 'explain',
      target: 'src/core/llm.ts',
      _fns: { explain: async (t: string) => { received = t; } },
    });
    assert.strictEqual(received, 'src/core/llm.ts');
  });

  it('dispatches wiki action with topic', async () => {
    let received = '';
    await canonicalKnowledge({
      action: 'wiki',
      topic: 'autoforge',
      _fns: { wiki: async (t: string) => { received = t; } },
    });
    assert.strictEqual(received, 'autoforge');
  });

  it('dispatches synthesize action', async () => {
    let called = false;
    await canonicalKnowledge({ action: 'synthesize', _fns: { synthesize: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('dispatches share action', async () => {
    let called = false;
    await canonicalKnowledge({ action: 'share', _fns: { share: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('no-op default when no action provided', async () => {
    await assert.doesNotReject(() => canonicalKnowledge({ _fns: {} }));
  });
});
