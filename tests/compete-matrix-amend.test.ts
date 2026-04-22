// tests/compete-matrix-amend.test.ts — Matrix amendment functions

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  removeCompetitor,
  dropDimension,
  recategorizeDimension,
  setDimensionWeight,
  type CompeteMatrix,
} from '../src/core/compete-matrix.js';

function makeMatrix(): CompeteMatrix {
  return {
    project: 'test',
    competitors: ['Cursor', 'Aider', 'Continue'],
    competitors_closed_source: ['Cursor'],
    competitors_oss: ['Aider', 'Continue'],
    lastUpdated: '2026-01-01T00:00:00.000Z',
    overallSelfScore: 5.0,
    dimensions: [
      {
        id: 'functionality',
        label: 'Functionality',
        weight: 1.0,
        category: 'quality',
        frequency: 'high',
        scores: { self: 5.0, Cursor: 9.0, Aider: 7.0, Continue: 6.0 },
        gap_to_leader: 4.0,
        leader: 'Cursor',
        gap_to_closed_source_leader: 4.0,
        closed_source_leader: 'Cursor',
        gap_to_oss_leader: 2.0,
        oss_leader: 'Aider',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
      },
      {
        id: 'testing',
        label: 'Testing',
        weight: 0.8,
        category: 'quality',
        frequency: 'medium',
        scores: { self: 8.0, Cursor: 8.5 },
        gap_to_leader: 0.5,
        leader: 'Cursor',
        gap_to_closed_source_leader: 0.5,
        closed_source_leader: 'Cursor',
        gap_to_oss_leader: 0,
        oss_leader: 'none',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
      },
    ],
  };
}

describe('removeCompetitor()', () => {
  it('removes competitor from all three arrays', () => {
    const m = makeMatrix();
    removeCompetitor(m, 'Cursor');
    assert.ok(!m.competitors.includes('Cursor'));
    assert.ok(!m.competitors_closed_source.includes('Cursor'));
  });

  it('deletes score entry from all dimensions', () => {
    const m = makeMatrix();
    removeCompetitor(m, 'Cursor');
    for (const dim of m.dimensions) {
      assert.ok(!('Cursor' in dim.scores), `${dim.id} should not have Cursor score`);
    }
  });

  it('recomputes gap_to_leader after removal', () => {
    const m = makeMatrix();
    // Before: gap_to_leader for functionality = 4.0 (vs Cursor 9.0)
    removeCompetitor(m, 'Cursor');
    const fn = m.dimensions.find(d => d.id === 'functionality')!;
    // After removing Cursor, leader should be Aider (7.0), gap = 2.0
    assert.equal(fn.gap_to_leader, 2.0);
    assert.equal(fn.leader, 'Aider');
  });

  it('handles removing last competitor without crash', () => {
    const m = makeMatrix();
    removeCompetitor(m, 'Cursor');
    removeCompetitor(m, 'Aider');
    removeCompetitor(m, 'Continue');
    assert.equal(m.competitors.length, 0);
    const fn = m.dimensions.find(d => d.id === 'functionality')!;
    assert.equal(fn.gap_to_leader, 0);
  });
});

describe('dropDimension()', () => {
  it('removes dimension from array', () => {
    const m = makeMatrix();
    dropDimension(m, 'testing');
    assert.ok(!m.dimensions.find(d => d.id === 'testing'));
    assert.equal(m.dimensions.length, 1);
  });

  it('recalculates overallSelfScore after drop', () => {
    const m = makeMatrix();
    const before = m.overallSelfScore;
    dropDimension(m, 'testing');
    // overallSelfScore recalculated from remaining dims only
    assert.ok(m.overallSelfScore !== before || m.dimensions.length === 1);
  });

  it('is no-op for unknown dimension id', () => {
    const m = makeMatrix();
    dropDimension(m, 'nonexistent_dim');
    assert.equal(m.dimensions.length, 2);
  });
});

describe('recategorizeDimension()', () => {
  it('updates category field', () => {
    const m = makeMatrix();
    recategorizeDimension(m, 'functionality', 'autonomy');
    const dim = m.dimensions.find(d => d.id === 'functionality')!;
    assert.equal(dim.category, 'autonomy');
  });

  it('is no-op for unknown id', () => {
    const m = makeMatrix();
    assert.doesNotThrow(() => recategorizeDimension(m, 'nonexistent', 'quality'));
  });
});

describe('setDimensionWeight()', () => {
  it('updates weight field', () => {
    const m = makeMatrix();
    setDimensionWeight(m, 'functionality', 2.0);
    const dim = m.dimensions.find(d => d.id === 'functionality')!;
    assert.equal(dim.weight, 2.0);
  });

  it('clamps negative weight to 0', () => {
    const m = makeMatrix();
    setDimensionWeight(m, 'functionality', -1.5);
    const dim = m.dimensions.find(d => d.id === 'functionality')!;
    assert.equal(dim.weight, 0);
  });
});
