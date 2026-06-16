// Master-plan Phase 1c: the external-grounding gate — a score >7 requires a PASSING registered
// external-benchmark receipt (evidence the grader cannot author). DEFAULT-OFF until the first benchmark
// lands. CH-032 follow-through: declaration of an external-benchmark outcome is NOT grounding — the gate
// requires the same passing, loaded receipt the score derives from, or it can be fooled by an unrun outcome.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyGroundingGate, GROUNDING_GATE_THRESHOLD } from '../src/core/frontier-spec.ts';
import { makeEvidenceKey, type OutcomeEvidence, type OutcomeEvidenceEntry } from '../src/matrix/types/outcome.ts';

const grounded = { id: 'g', outcomes: [{ id: 'g-o0', kind: 'external-benchmark', benchmark: 'humaneval', input_source: { type: 'external-benchmark' } }] };
const ungrounded = { id: 'u', outcomes: [{ id: 'u-o0', kind: 'shell', input_source: { type: 'real-user-path' } }] };
const noOutcomes = { id: 'n' };

function ev(pairs: Array<[string, string]>, passed = true): OutcomeEvidence {
  const m: OutcomeEvidence = new Map();
  for (const [d, o] of pairs) m.set(makeEvidenceKey(d, o), { passed, exitCode: 0 } as OutcomeEvidenceEntry);
  return m;
}
const PASS = ev([['g', 'g-o0']]);          // the grounded dim's external-benchmark outcome PASSED
const FAIL = ev([['g', 'g-o0']], false);   // ran, but failed
const NONE: OutcomeEvidence = new Map();   // no receipt at all (declared but unrun)

describe('applyGroundingGate (Phase 1c) — explicit enabled flag', () => {
  it('disabled → never caps (the default; smoke suite + live matrix unaffected)', () => {
    assert.deepEqual(applyGroundingGate(9.0, ungrounded, NONE, false), { score: 9.0, capped: false });
    assert.deepEqual(applyGroundingGate(8.5, noOutcomes, NONE, false), { score: 8.5, capped: false });
  });

  it('enabled + score <= 7 → unchanged (the gate only guards >7)', () => {
    assert.deepEqual(applyGroundingGate(GROUNDING_GATE_THRESHOLD, ungrounded, NONE, true), { score: 7.0, capped: false });
    assert.deepEqual(applyGroundingGate(6.0, noOutcomes, NONE, true), { score: 6.0, capped: false });
  });

  it('enabled + >7 + NOT externally grounded → capped to 7.0', () => {
    assert.deepEqual(applyGroundingGate(9.0, ungrounded, NONE, true), { score: 7.0, capped: true });
    assert.deepEqual(applyGroundingGate(8.0, noOutcomes, NONE, true), { score: 7.0, capped: true });
  });

  it('CH-032: enabled + >7 + DECLARED external-benchmark but NO passing receipt → STILL capped', () => {
    assert.deepEqual(applyGroundingGate(9.0, grounded, NONE, true), { score: 7.0, capped: true }, 'declaration without a receipt must not lift the gate');
    assert.deepEqual(applyGroundingGate(9.0, grounded, FAIL, true), { score: 7.0, capped: true }, 'a FAILING receipt must not lift the gate');
  });

  it('enabled + >7 + a PASSING external-benchmark receipt → allowed through', () => {
    assert.deepEqual(applyGroundingGate(9.0, grounded, PASS, true), { score: 9.0, capped: false });
  });
});

describe('applyGroundingGate — env-driven default (DANTEFORGE_GROUNDING_GATE)', () => {
  it('respects the env flag when no explicit enabled arg is passed', () => {
    const saved = process.env['DANTEFORGE_GROUNDING_GATE'];
    try {
      delete process.env['DANTEFORGE_GROUNDING_GATE'];
      assert.equal(applyGroundingGate(9.0, ungrounded, NONE).capped, false, 'default-off: env unset → no cap');
      process.env['DANTEFORGE_GROUNDING_GATE'] = '1';
      assert.equal(applyGroundingGate(9.0, ungrounded, NONE).capped, true, 'env=1 → caps an ungrounded >7');
      assert.equal(applyGroundingGate(9.0, grounded, NONE).capped, true, 'env=1 → declared-but-unrun is STILL capped (CH-032)');
      assert.equal(applyGroundingGate(9.0, grounded, PASS).capped, false, 'env=1 → a PASSING receipt passes');
    } finally {
      if (saved === undefined) delete process.env['DANTEFORGE_GROUNDING_GATE']; else process.env['DANTEFORGE_GROUNDING_GATE'] = saved;
    }
  });
});
