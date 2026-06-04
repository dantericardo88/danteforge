// dim-band.test.ts — normalize dims into score-band state for the sweep orchestrator.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bandFor, dimBandState, snapshotBands, bandCounts } from '../src/core/dim-band.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

const dim = (id: string, scores: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ({ id, label: id, weight: 1, scores, ...extra }) as unknown;

describe('bandFor', () => {
  it('maps scores to bands (9.0 = done, the autonomy ceiling)', () => {
    assert.equal(bandFor(2), 'below5');
    assert.equal(bandFor(5), 'fiveToSeven');
    assert.equal(bandFor(6.9), 'fiveToSeven');
    assert.equal(bandFor(7), 'sevenToNine');
    assert.equal(bandFor(8.9), 'sevenToNine');
    assert.equal(bandFor(9), 'done');
  });
});

describe('dimBandState', () => {
  it('uses the effective (min self/derived) score', () => {
    const s = dimBandState(dim('a', { self: 8, derived: 4 }) as never);
    assert.equal(s.effectiveScore, 4);
    assert.equal(s.band, 'below5');
  });

  it('marks an operator-ceilinged dim as done even below 9', () => {
    const s = dimBandState(dim('a', { self: 6 }, { ceiling: 6 }) as never);
    assert.equal(s.atCeiling, true);
    assert.equal(s.band, 'done');
  });

  it('marks a market dim at its cap as done', () => {
    const s = dimBandState(dim('community_adoption', { self: 5 }) as never);
    assert.equal(s.atCeiling, true);
    assert.equal(s.band, 'done');
  });

  it('marks a human-closing-strategy dim as done', () => {
    const s = dimBandState(dim('a', { self: 4 }, { closingStrategy: 'human' }) as never);
    assert.equal(s.band, 'done');
  });

  it('reports capability_test + outcomes presence', () => {
    const s = dimBandState(dim('a', { self: 5 }, { capability_test: { command: 'node x.mjs' }, outcomes: [{ id: 'o' }] }) as never);
    assert.equal(s.hasCapabilityTest, true);
    assert.equal(s.hasOutcomes, true);
  });
});

describe('snapshot + counts', () => {
  it('counts dims per band', () => {
    const matrix = { dimensions: [dim('a', { self: 2 }), dim('b', { self: 6 }), dim('c', { self: 8 }), dim('d', { self: 9 })] } as unknown as CompeteMatrix;
    const counts = bandCounts(snapshotBands(matrix));
    assert.deepEqual(counts, { below5: 1, fiveToSeven: 1, sevenToNine: 1, done: 1 });
  });
});
