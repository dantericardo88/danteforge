import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessGroundingGate, assessSignedEvidence } from '../src/core/gate-readiness.ts';

test('grounding gate: UNSAFE when 0 dims grounded (would cap everything at 7 and stall)', () => {
  const a = assessGroundingGate([]);
  assert.equal(a.safeToEnable, false);
  assert.match(a.reason, /STALLS the climb loop/);
});

test('grounding gate: SAFE once ≥1 dim carries a passing external receipt', () => {
  const a = assessGroundingGate(['code_generation']);
  assert.equal(a.safeToEnable, true);
  assert.equal(a.groundedDims, 1);
  assert.match(a.reason, /code_generation/);
});

test('signed evidence: UNSAFE with unsigned receipts (would drop scores); names the re-sign script', () => {
  const a = assessSignedEvidence([{ sig: 'abc' }, {}, { sig: '' }]);
  assert.equal(a.safeToEnable, false);
  assert.equal(a.unsignedReceipts, 2);
  assert.match(a.reason, /sign-outcome-evidence\.mjs/);
});

test('signed evidence: SAFE when all receipts signed; no-op when none exist', () => {
  assert.equal(assessSignedEvidence([{ sig: 'a' }, { sig: 'b' }]).safeToEnable, true);
  const none = assessSignedEvidence([]);
  assert.equal(none.safeToEnable, true);
  assert.match(none.reason, /no-op/);
});
