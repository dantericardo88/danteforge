import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { externalGroundingReport, isExternallyGrounded } from '../src/core/external-grounding.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function dim(id: string, weight: number, inputSourceTypes: string[]): unknown {
  return {
    id, weight, label: id, scores: { self: 8 },
    outcomes: inputSourceTypes.map((t, i) => ({ id: `${id}-o${i}`, tier: 'T7', input_source: { type: t } })),
  };
}

function matrix(dims: unknown[]): CompeteMatrix {
  return { project: 't', competitors: [], dimensions: dims, overallSelfScore: 8, lastUpdated: '' } as unknown as CompeteMatrix;
}

describe('external-grounding — the self-vs-world honesty signal (grading-integrity #6)', () => {
  test('a fully self-attested matrix reports 0% grounding', () => {
    const m = matrix([
      dim('a', 2, ['real-user-path', 'real-user-path']),
      dim('b', 1, ['real-user-path']),
      dim('c', 1, ['synthetic-fixture']),
    ]);
    const r = externalGroundingReport(m);
    assert.equal(r.externallyGroundedDims, 0);
    assert.equal(r.weightedGroundingRatio, 0);
    assert.match(r.summary, /0% externally grounded|self-CONSISTENT/);
  });

  test('an external-benchmark outcome grounds its dim; ratio is WEIGHTED', () => {
    const m = matrix([
      dim('functionality', 3, ['real-user-path', 'external-benchmark']), // grounded, weight 3
      dim('testing', 1, ['real-user-path']),                              // not, weight 1
    ]);
    const r = externalGroundingReport(m);
    assert.equal(r.externallyGroundedDims, 1);
    assert.deepEqual(r.groundedDimIds, ['functionality']);
    assert.equal(r.weightedGroundingRatio, 0.75, '3 of 4 weight is grounded');
    assert.equal(r.dimGroundingRatio, 0.5);
  });

  test('isExternallyGrounded is true only with an external-benchmark outcome', () => {
    assert.equal(isExternallyGrounded(dim('x', 1, ['external-benchmark']) as never), true);
    assert.equal(isExternallyGrounded(dim('x', 1, ['real-user-path']) as never), false);
    assert.equal(isExternallyGrounded(dim('x', 1, []) as never), false);
  });
});
