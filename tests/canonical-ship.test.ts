// canonical ship command — injection-seam tests
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalShip } from '../src/cli/commands/canonical.js';

function noopFns() {
  return {
    verify: async () => {},
    qa: async () => {},
    browse: async () => {},
    publishCheck: async () => {},
    ciSetup: async () => {},
  };
}

describe('canonicalShip', () => {
  it('light level calls only verify', async () => {
    const calls: string[] = [];
    await canonicalShip({
      level: 'light',
      _fns: {
        ...noopFns(),
        verify: async () => { calls.push('verify'); },
        qa: async () => { calls.push('qa'); },
      },
    });
    assert.deepStrictEqual(calls, ['verify']);
  });

  it('standard level calls verify + qa', async () => {
    const calls: string[] = [];
    await canonicalShip({
      level: 'standard',
      _fns: {
        ...noopFns(),
        verify: async () => { calls.push('verify'); },
        qa: async () => { calls.push('qa'); },
        publishCheck: async () => { calls.push('publishCheck'); },
      },
    });
    assert.ok(calls.includes('verify'));
    assert.ok(calls.includes('qa'));
    assert.ok(!calls.includes('publishCheck'));
  });

  it('deep level calls verify + qa + publishCheck', async () => {
    const calls: string[] = [];
    await canonicalShip({
      level: 'deep',
      _fns: {
        ...noopFns(),
        verify: async () => { calls.push('verify'); },
        qa: async () => { calls.push('qa'); },
        publishCheck: async () => { calls.push('publishCheck'); },
      },
    });
    assert.ok(calls.includes('verify'));
    assert.ok(calls.includes('qa'));
    assert.ok(calls.includes('publishCheck'));
  });

  it('withBrowse adds browse step on standard+', async () => {
    const calls: string[] = [];
    await canonicalShip({
      level: 'standard',
      withBrowse: true,
      _fns: {
        ...noopFns(),
        browse: async () => { calls.push('browse'); },
      },
    });
    assert.ok(calls.includes('browse'));
  });

  it('ci-setup action dispatches ciSetup only', async () => {
    const calls: string[] = [];
    await canonicalShip({
      action: 'ci-setup',
      _fns: {
        ...noopFns(),
        verify: async () => { calls.push('verify'); },
        ciSetup: async () => { calls.push('ciSetup'); },
      },
    });
    assert.deepStrictEqual(calls, ['ciSetup']);
  });
});
