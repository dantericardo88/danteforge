// harden-bridge.test.ts — the 5→7 decision: depth-wave-ready vs needs-feature re-route.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideHardenBridge, inBridgeBand } from '../src/core/harden-bridge.js';

describe('inBridgeBand', () => {
  it('is true only in [5, 7)', () => {
    assert.equal(inBridgeBand(4.9), false);
    assert.equal(inBridgeBand(5), true);
    assert.equal(inBridgeBand(6.9), true);
    assert.equal(inBridgeBand(7), false);
  });
});

describe('decideHardenBridge', () => {
  it('not-applicable outside the bridge band', () => {
    assert.equal(decideHardenBridge('d', 4, { clean: true, failedChecks: [] }).decision, 'not-applicable');
    assert.equal(decideHardenBridge('d', 7, { clean: true, failedChecks: [] }).decision, 'not-applicable');
  });

  it('harden-ready when the gate is clean in the bridge band', () => {
    const v = decideHardenBridge('d', 5.5, { clean: true, failedChecks: [] });
    assert.equal(v.decision, 'harden-ready');
  });

  it('needs-feature (re-route) when the harden gate is dirty — surgical edits cannot wire a callsite', () => {
    const v = decideHardenBridge('d', 6, { clean: false, failedChecks: ['orphan-audit'] });
    assert.equal(v.decision, 'needs-feature');
    assert.deepEqual(v.failedChecks, ['orphan-audit']);
    assert.match(v.note, /orphan-audit/);
  });
});
