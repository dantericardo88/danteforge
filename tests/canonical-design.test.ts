// canonical design command — injection-seam tests
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalDesign } from '../src/cli/commands/canonical.js';

function noopFns() {
  return {
    tokens: async () => {},
    render: async () => {},
    figmaPush: async () => {},
    uxRefine: async () => {},
    canvas: async () => {},
    diff: async () => {},
  };
}

describe('canonicalDesign', () => {
  it('tokens action dispatches tokens only', async () => {
    let called = false;
    await canonicalDesign({
      action: 'tokens',
      _fns: { ...noopFns(), tokens: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('canvas action dispatches canvas only', async () => {
    let called = false;
    await canonicalDesign({
      action: 'canvas',
      _fns: { ...noopFns(), canvas: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('diff action dispatches diff only', async () => {
    let called = false;
    await canonicalDesign({
      action: 'diff',
      _fns: { ...noopFns(), diff: async () => { called = true; } },
    });
    assert.strictEqual(called, true);
  });

  it('light level calls only tokens', async () => {
    const calls: string[] = [];
    await canonicalDesign({
      level: 'light',
      _fns: {
        ...noopFns(),
        tokens: async () => { calls.push('tokens'); },
        render: async () => { calls.push('render'); },
      },
    });
    assert.deepStrictEqual(calls, ['tokens']);
  });

  it('standard level calls render + tokens + figmaPush', async () => {
    const calls: string[] = [];
    await canonicalDesign({
      level: 'standard',
      _fns: {
        ...noopFns(),
        tokens: async () => { calls.push('tokens'); },
        render: async () => { calls.push('render'); },
        figmaPush: async () => { calls.push('figmaPush'); },
        uxRefine: async () => { calls.push('uxRefine'); },
      },
    });
    assert.ok(calls.includes('render'));
    assert.ok(calls.includes('tokens'));
    assert.ok(calls.includes('figmaPush'));
    assert.ok(!calls.includes('uxRefine'));
  });

  it('deep level calls full loop including uxRefine', async () => {
    const calls: string[] = [];
    await canonicalDesign({
      level: 'deep',
      _fns: {
        ...noopFns(),
        tokens: async () => { calls.push('tokens'); },
        render: async () => { calls.push('render'); },
        figmaPush: async () => { calls.push('figmaPush'); },
        uxRefine: async () => { calls.push('uxRefine'); },
      },
    });
    assert.ok(calls.includes('uxRefine'));
  });
});
