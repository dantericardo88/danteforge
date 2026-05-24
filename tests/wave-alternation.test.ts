import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getWaveGuard, computeWaveType, BREADTH_SCORE_CEILING } from '../src/core/wave-alternation.js';

describe('wave-alternation', () => {
  describe('computeWaveType', () => {
    it('index 0 is breadth (first wave writes code)', () => {
      assert.equal(computeWaveType(0), 'breadth');
    });

    it('index 1 is depth (second wave validates)', () => {
      assert.equal(computeWaveType(1), 'depth');
    });

    it('alternates consistently: even=breadth, odd=depth', () => {
      for (let i = 0; i < 10; i++) {
        const expected = i % 2 === 0 ? 'breadth' : 'depth';
        assert.equal(computeWaveType(i), expected, `index ${i} should be ${expected}`);
      }
    });
  });

  describe('getWaveGuard', () => {
    it('breadth wave allows new code, ceiling 6.0', () => {
      const guard = getWaveGuard(0);
      assert.equal(guard.type, 'breadth');
      assert.equal(guard.scoreCeiling, BREADTH_SCORE_CEILING);
      assert.equal(guard.allowNewCode, true);
      assert.equal(guard.allowOutcomeRun, false);
    });

    it('depth wave allows outcome runs, no ceiling', () => {
      const guard = getWaveGuard(1);
      assert.equal(guard.type, 'depth');
      assert.equal(guard.scoreCeiling, Infinity);
      assert.equal(guard.allowNewCode, false);
      assert.equal(guard.allowOutcomeRun, true);
    });

    it('BREADTH_SCORE_CEILING is 6.0', () => {
      assert.equal(BREADTH_SCORE_CEILING, 6.0);
    });
  });
});
