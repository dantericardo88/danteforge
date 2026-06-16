// Master-plan Phase 1c: the external-grounding gate — a score >7 requires a registered external-benchmark
// receipt (evidence the grader cannot author). DEFAULT-OFF until the first benchmark lands; the operator
// flips DANTEFORGE_GROUNDING_GATE=1 alongside Phase 1b.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyGroundingGate, GROUNDING_GATE_THRESHOLD } from '../src/core/frontier-spec.js';

const grounded = { id: 'g', outcomes: [{ input_source: { type: 'external-benchmark' } }] };
const ungrounded = { id: 'u', outcomes: [{ input_source: { type: 'real-user-path' } }] };
const noOutcomes = { id: 'n' };

describe('applyGroundingGate (Phase 1c) — explicit enabled flag', () => {
  it('disabled → never caps (the default; smoke suite + live matrix unaffected)', () => {
    assert.deepEqual(applyGroundingGate(9.0, ungrounded, false), { score: 9.0, capped: false });
    assert.deepEqual(applyGroundingGate(8.5, noOutcomes, false), { score: 8.5, capped: false });
  });

  it('enabled + score <= 7 → unchanged (the gate only guards >7)', () => {
    assert.deepEqual(applyGroundingGate(GROUNDING_GATE_THRESHOLD, ungrounded, true), { score: 7.0, capped: false });
    assert.deepEqual(applyGroundingGate(6.0, noOutcomes, true), { score: 6.0, capped: false });
  });

  it('enabled + >7 + NOT externally grounded → capped to 7.0', () => {
    assert.deepEqual(applyGroundingGate(9.0, ungrounded, true), { score: 7.0, capped: true });
    assert.deepEqual(applyGroundingGate(8.0, noOutcomes, true), { score: 7.0, capped: true });
  });

  it('enabled + >7 + externally grounded (a registered external-benchmark outcome) → allowed through', () => {
    assert.deepEqual(applyGroundingGate(9.0, grounded, true), { score: 9.0, capped: false });
  });
});

describe('applyGroundingGate — env-driven default (DANTEFORGE_GROUNDING_GATE)', () => {
  it('respects the env flag when no explicit enabled arg is passed', () => {
    const saved = process.env['DANTEFORGE_GROUNDING_GATE'];
    try {
      delete process.env['DANTEFORGE_GROUNDING_GATE'];
      assert.equal(applyGroundingGate(9.0, ungrounded).capped, false, 'default-off: env unset → no cap');
      process.env['DANTEFORGE_GROUNDING_GATE'] = '1';
      assert.equal(applyGroundingGate(9.0, ungrounded).capped, true, 'env=1 → caps an ungrounded >7');
      assert.equal(applyGroundingGate(9.0, grounded).capped, false, 'env=1 → a grounded dim still passes');
    } finally {
      if (saved === undefined) delete process.env['DANTEFORGE_GROUNDING_GATE']; else process.env['DANTEFORGE_GROUNDING_GATE'] = saved;
    }
  });
});
