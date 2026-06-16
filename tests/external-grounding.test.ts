import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { externalGroundingReport, isExternallyGrounded } from '../src/core/external-grounding.ts';
import { makeEvidenceKey, type OutcomeEvidence, type OutcomeEvidenceEntry } from '../src/matrix/types/outcome.ts';
import type { CompeteMatrix } from '../src/core/compete-matrix.ts';

function dim(id: string, weight: number, inputSourceTypes: string[]): unknown {
  return {
    id, weight, label: id, scores: { self: 8 },
    outcomes: inputSourceTypes.map((t, i) => ({
      id: `${id}-o${i}`, tier: 'T7',
      kind: t === 'external-benchmark' ? 'external-benchmark' : 'shell',
      benchmark: t === 'external-benchmark' ? 'humaneval' : undefined,
      input_source: { type: t },
    })),
  };
}

function matrix(dims: unknown[]): CompeteMatrix {
  return { project: 't', competitors: [], dimensions: dims, overallSelfScore: 8, lastUpdated: '' } as unknown as CompeteMatrix;
}

/** Evidence snapshot marking the given (dimId, outcomeId) pairs passing (or failing). */
function evidenceFor(pairs: Array<[string, string]>, passed = true): OutcomeEvidence {
  const m: OutcomeEvidence = new Map();
  for (const [d, o] of pairs) m.set(makeEvidenceKey(d, o), { passed, exitCode: 0 } as OutcomeEvidenceEntry);
  return m;
}
const NONE: OutcomeEvidence = new Map();

describe('external-grounding — the self-vs-world honesty signal (grading-integrity #6)', () => {
  test('a fully self-attested matrix reports 0% grounding', () => {
    const m = matrix([
      dim('a', 2, ['real-user-path', 'real-user-path']),
      dim('b', 1, ['real-user-path']),
      dim('c', 1, ['synthetic-fixture']),
    ]);
    const r = externalGroundingReport(m, NONE);
    assert.equal(r.externallyGroundedDims, 0);
    assert.equal(r.weightedGroundingRatio, 0);
    assert.match(r.summary, /0% externally grounded|self-CONSISTENT/);
  });

  test('CH-032: a DECLARED external-benchmark outcome with NO passing receipt is NOT grounded', () => {
    const m = matrix([dim('functionality', 3, ['external-benchmark']), dim('testing', 1, ['real-user-path'])]);
    const r = externalGroundingReport(m, NONE); // declared, but no receipt loaded
    assert.equal(r.externallyGroundedDims, 0, 'declaration alone must not count as grounding');
    assert.equal(r.weightedGroundingRatio, 0);
  });

  test('CH-032: a FAILING external-benchmark receipt is NOT grounded', () => {
    const m = matrix([dim('functionality', 3, ['external-benchmark'])]);
    const ev = evidenceFor([['functionality', 'functionality-o0']], false); // ran, but failed
    assert.equal(externalGroundingReport(m, ev).externallyGroundedDims, 0);
  });

  test('a PASSING external-benchmark receipt grounds its dim; ratio is WEIGHTED', () => {
    const m = matrix([
      dim('functionality', 3, ['real-user-path', 'external-benchmark']), // grounded, weight 3
      dim('testing', 1, ['real-user-path']),                              // not, weight 1
    ]);
    const ev = evidenceFor([['functionality', 'functionality-o1']]); // the external-benchmark outcome passed
    const r = externalGroundingReport(m, ev);
    assert.equal(r.externallyGroundedDims, 1);
    assert.deepEqual(r.groundedDimIds, ['functionality']);
    assert.equal(r.weightedGroundingRatio, 0.75, '3 of 4 weight is grounded');
    assert.equal(r.dimGroundingRatio, 0.5);
    assert.match(r.summary, /external-benchmark receipt/);
  });

  test('isExternallyGrounded requires a PASSING receipt, not mere declaration', () => {
    const d = dim('x', 1, ['external-benchmark']);
    assert.equal(isExternallyGrounded(d as never, evidenceFor([['x', 'x-o0']])), true);
    assert.equal(isExternallyGrounded(d as never, NONE), false);                       // declared, no receipt
    assert.equal(isExternallyGrounded(d as never, evidenceFor([['x', 'x-o0']], false)), false); // failed
    assert.equal(isExternallyGrounded(dim('x', 1, ['real-user-path']) as never, evidenceFor([['x', 'x-o0']])), false);
  });
});
