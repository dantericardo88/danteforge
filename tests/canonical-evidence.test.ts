// canonical evidence command — injection-seam tests
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { canonicalEvidence } from '../src/cli/commands/canonical.js';

describe('canonicalEvidence', () => {
  it('dispatches verify action', async () => {
    let called = false;
    await canonicalEvidence({ action: 'verify', _fns: { verify: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('dispatches export action', async () => {
    let called = false;
    await canonicalEvidence({ action: 'export', _fns: { export: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('dispatches certify action', async () => {
    let called = false;
    await canonicalEvidence({ action: 'certify', _fns: { certify: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('dispatches timeline action', async () => {
    let called = false;
    await canonicalEvidence({ action: 'timeline', _fns: { timeline: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('dispatches branch action with nodeId', async () => {
    let receivedId = '';
    await canonicalEvidence({
      action: 'branch',
      nodeId: 'node-42',
      _fns: { branch: async (nodeId: string) => { receivedId = nodeId; } },
    });
    assert.strictEqual(receivedId, 'node-42');
  });

  it('dispatches causal action', async () => {
    let called = false;
    await canonicalEvidence({ action: 'causal', _fns: { causal: async () => { called = true; } } });
    assert.strictEqual(called, true);
  });

  it('no-op default when no action provided', async () => {
    // Should not throw; logs usage hints
    await assert.doesNotReject(() => canonicalEvidence({ _fns: {} }));
  });
});
