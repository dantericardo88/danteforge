// compete-display-nullsafe.test.ts — a real project's matrix can carry an unscored (null) field.
// The display/score primitives must degrade to a placeholder, never crash on `.toFixed` of null.
// Regression for: `compete status` dying on DanteCode with "Cannot read properties of null
// (reading 'toFixed')" because a dim had gap_to_leader: null.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatScore, gapBar } from '../src/cli/commands/compete-display.js';
import { computeGapPriority } from '../src/core/compete-matrix-score.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

describe('display primitives — null-safe (cross-project generality)', () => {
  test('formatScore renders a number, and a placeholder for null/undefined/NaN', () => {
    assert.equal(formatScore(7.25), '7.3');
    assert.equal(formatScore(0), '0.0');
    assert.equal(formatScore(null as unknown as number), '—');
    assert.equal(formatScore(undefined as unknown as number), '—');
    assert.equal(formatScore(NaN), '—');
  });

  test('gapBar does not throw on a null gap', () => {
    assert.doesNotThrow(() => gapBar(null as unknown as number));
    assert.ok(gapBar(null as unknown as number).length > 0);
    assert.ok(gapBar(3).length > 0);
  });
});

describe('computeGapPriority — total on a null/undefined gap (no NaN poisoning)', () => {
  const dim = (over: Partial<MatrixDimension>): MatrixDimension =>
    ({ id: 'd', label: 'D', weight: 1, frequency: 'medium', gap_to_leader: 1, scores: { self: 7 }, ...over } as unknown as MatrixDimension);

  test('a null gap_to_leader yields 0 priority, not NaN', () => {
    const p = computeGapPriority(dim({ gap_to_leader: null as unknown as number }));
    assert.equal(Number.isNaN(p), false);
    assert.equal(p, 0);
  });
  test('a real gap still computes weight * gap * frequency', () => {
    assert.equal(computeGapPriority(dim({ weight: 2, gap_to_leader: 3, frequency: 'medium' })), 6);
  });
});
