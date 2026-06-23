import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHonestTarget, dimFinishStatus, fleetFinishSummary } from '../src/core/finish-ceiling.js';

test('resolveHonestTarget: market/adoption dims cap at 5.0', () => {
  assert.equal(resolveHonestTarget('token_economy').target, 5.0);
  assert.equal(resolveHonestTarget('community_adoption').profile, 'market-capped');
});

test('resolveHonestTarget: no demand → 8.0 BUILD-COMPLETE; demand bound → 9.0 demand-frontier', () => {
  assert.equal(resolveHonestTarget('functionality').target, 8.0);
  assert.equal(resolveHonestTarget('functionality').profile, 'build-complete');
  assert.equal(resolveHonestTarget('functionality', { demandBound: true }).target, 9.0);
  assert.equal(resolveHonestTarget('functionality', { demandBound: true }).profile, 'demand-frontier');
});

test('dimFinishStatus: an 8.0 no-demand dim WITH a harvest attempt is FINISHED', () => {
  const s = dimFinishStatus({ id: 'autonomy', score: 8.0, demandHarvestAttempted: true });
  assert.equal(s.finished, true);
  assert.equal(s.gap, 0);
  assert.equal(s.unobservedNoDemand, false);
});

test('dimFinishStatus: a 6.5 dim is NOT finished and reports the gap to its honest ceiling', () => {
  const s = dimFinishStatus({ id: 'security', score: 6.5, demandHarvestAttempted: true });
  assert.equal(s.finished, false);
  assert.equal(s.target, 8.0);
  assert.equal(s.gap, 1.5);
});

test('dimFinishStatus: "no demand" WITHOUT a harvest attempt is flagged unobserved (gameable)', () => {
  const s = dimFinishStatus({ id: 'autonomy', score: 8.0 }); // never harvested
  assert.equal(s.unobservedNoDemand, true);
});

test('a market dim at 5.0 is FINISHED (its honest ceiling), not "3 below 8"', () => {
  const s = dimFinishStatus({ id: 'token_economy', score: 5.0 });
  assert.equal(s.finished, true);
  assert.equal(s.profile, 'market-capped');
  assert.equal(s.unobservedNoDemand, false); // market dims need no harvest
});

test('fleetFinishSummary: FINISHED only when ALL dims at target AND no unobserved no-demand', () => {
  const all = fleetFinishSummary([
    { id: 'functionality', score: 8.0, demandHarvestAttempted: true },
    { id: 'token_economy', score: 5.0 },
  ]);
  assert.equal(all.finished, true);
  assert.equal(all.doneCount, 2);

  const partial = fleetFinishSummary([{ id: 'security', score: 6.0, demandHarvestAttempted: true }]);
  assert.equal(partial.finished, false);

  const unobserved = fleetFinishSummary([{ id: 'autonomy', score: 8.0 }]); // no harvest attempted
  assert.equal(unobserved.finished, false);
  assert.equal(unobserved.unobservedCount, 1);
});
