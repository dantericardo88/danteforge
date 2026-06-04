// promote-score.test.ts — raising self to the evidence-justified value, but only through the gate.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promoteVerifiedScore, CAPABILITY_TEST_TIER_CAP } from '../src/core/promote-score.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function matrixWith(dimId: string, scores: Record<string, number>): CompeteMatrix {
  return {
    project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: '', overallSelfScore: 0,
    dimensions: [{ id: dimId, label: dimId, weight: 1, category: 'features', frequency: 'high', scores, status: 'in-progress', sprint_history: [], next_sprint_target: 9, gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '', gap_to_oss_leader: 0, oss_leader: '' }],
  } as unknown as CompeteMatrix;
}

describe('promoteVerifiedScore', () => {
  it('promotes self up to derived when the capability_test passed', () => {
    const m = matrixWith('d', { self: 5, derived: 7 });
    const r = promoteVerifiedScore(m, 'd', { capabilityTestPassed: true });
    assert.equal(r.after, 7);
    assert.equal(r.promoted, true);
    assert.equal(m.dimensions[0].scores.self, 7);
  });

  it('the gate backstop caps self at 5.0 when the capability_test did NOT pass', () => {
    const m = matrixWith('d', { self: 5, derived: 7 });
    const r = promoteVerifiedScore(m, 'd', { capabilityTestPassed: false });
    assert.equal(r.after, 5, 'an unproven >5 promotion is clamped to 5');
    assert.equal(r.promoted, false);
  });

  it('a bare passing capability_test with no outcomes justifies the T2 cap (5.0)', () => {
    const m = matrixWith('d', { self: 3 }); // no derived
    const r = promoteVerifiedScore(m, 'd', { capabilityTestPassed: true });
    assert.equal(r.after, CAPABILITY_TEST_TIER_CAP);
    assert.equal(r.promoted, true);
  });

  it('does nothing when there is no derived evidence and the test did not pass', () => {
    const m = matrixWith('d', { self: 3 });
    const r = promoteVerifiedScore(m, 'd', { capabilityTestPassed: false });
    assert.equal(r.promoted, false);
    assert.equal(m.dimensions[0].scores.self, 3, 'self untouched');
  });

  it('never lowers self (derived below self is a no-op — calibration owns downgrades)', () => {
    const m = matrixWith('d', { self: 6, derived: 4 });
    const r = promoteVerifiedScore(m, 'd', { capabilityTestPassed: true });
    assert.equal(r.promoted, false);
    assert.equal(m.dimensions[0].scores.self, 6);
  });

  it('respects the market-dim cap (community_adoption can never exceed 5.0)', () => {
    const m = matrixWith('community_adoption', { self: 3, derived: 8 });
    const r = promoteVerifiedScore(m, 'community_adoption', { capabilityTestPassed: true });
    assert.equal(r.after, 5, 'market cap wins over derived');
    assert.equal(r.promoted, true);
  });

  it('records a provenance entry for the write (audit trail)', () => {
    const m = matrixWith('d', { self: 5, derived: 7 });
    promoteVerifiedScore(m, 'd', { capabilityTestPassed: true, agent: 'dispatch-promote' });
    const entry = (m.scoreProvenance ?? []).at(-1);
    assert.equal(entry?.dimensionId, 'd');
    assert.equal(entry?.agent, 'dispatch-promote');
    assert.equal(entry?.gatesPassed?.capability_test, true);
    assert.equal(entry?.after, 7);
  });

  it('is a clean no-op for an unknown dimension', () => {
    const m = matrixWith('d', { self: 5, derived: 7 });
    const r = promoteVerifiedScore(m, 'nope', { capabilityTestPassed: true });
    assert.equal(r.promoted, false);
    assert.match(r.reason, /not found/);
  });
});
