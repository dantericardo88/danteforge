import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planNextAction, isDimDone, type DimState } from '../src/core/ascend-frontier-engine.js';
import type { CeilingReceipt } from '../src/core/ceiling-receipt.js';

const NOW = '2026-06-03T00:00:00.000Z';
const OPTS = { maxAttemptsPerDim: 3, nowIso: NOW };

function dim(over: Partial<DimState> = {}): DimState {
  return { id: 'd', effectiveScore: 7.0, frontierStatus: 'frozen', ceiling: null, attempts: 0, isMarketCapped: false, ...over };
}
function ceiling(over: Partial<CeilingReceipt> = {}): CeilingReceipt {
  return { dimId: 'd', cap: 5.0, cause: 'market-cap', detail: '', failedGates: [], recordedAt: NOW, ...over };
}

describe('planNextAction — honest autonomous sequencing', () => {
  test('dims needing setup → setup first', () => {
    const a = planNextAction([dim({ id: 'a', needsSetup: true }), dim({ id: 'b' })], OPTS);
    assert.deepEqual(a, { type: 'setup', dims: ['a'] });
  });

  test('market-capped dim → write a market-cap ceiling (not pushed forever)', () => {
    const a = planNextAction([dim({ id: 'enterprise', effectiveScore: 5.0, isMarketCapped: true })], OPTS);
    assert.equal(a.type, 'ceiling');
    assert.equal((a as { cause: string }).cause, 'market-cap');
  });

  test('any dim below 7 → build-to-7 (breadth phase)', () => {
    const a = planNextAction([dim({ id: 'a', effectiveScore: 5.5 }), dim({ id: 'b', effectiveScore: 7.0 })], OPTS);
    assert.deepEqual(a, { type: 'build-to-7', dims: ['a'] });
  });

  test('all ≥7, not done → push the WEAKEST incomplete dim', () => {
    const a = planNextAction([dim({ id: 'a', effectiveScore: 8.0 }), dim({ id: 'b', effectiveScore: 7.0 })], OPTS);
    assert.deepEqual(a, { type: 'push-to-9', dimId: 'b' });
  });

  test('a dim that exhausted novel attempts → generator-ceiling (no infinite grind)', () => {
    const a = planNextAction([dim({ id: 'a', effectiveScore: 8.0, attempts: 3 })], OPTS);
    assert.equal(a.type, 'ceiling');
    assert.equal((a as { cause: string }).cause, 'generator-ceiling');
  });

  test('validated-at-9 and active-ceiling dims are complete → done', () => {
    const dims = [
      dim({ id: 'a', effectiveScore: 9.0, frontierStatus: 'validated' }),
      dim({ id: 'b', effectiveScore: 5.0, ceiling: ceiling({ dimId: 'b' }) }),
    ];
    const a = planNextAction(dims, OPTS);
    assert.equal(a.type, 'done');
  });

  test('an EXPIRED env ceiling is not done → the dim is re-attempted', () => {
    const expired = ceiling({ dimId: 'a', cause: 'environment', reviewAfter: '2026-05-01T00:00:00.000Z' });
    const a = planNextAction([dim({ id: 'a', effectiveScore: 7.0, ceiling: expired })], OPTS);
    assert.equal(a.type, 'push-to-9', 'expired ceiling re-opens the dim');
  });

  test('isDimDone: validated-9 OR active ceiling; frozen-8 is NOT done', () => {
    assert.equal(isDimDone(dim({ effectiveScore: 9.0, frontierStatus: 'validated' }), NOW), true);
    assert.equal(isDimDone(dim({ effectiveScore: 8.0, frontierStatus: 'frozen' }), NOW), false);
    assert.equal(isDimDone(dim({ ceiling: ceiling() }), NOW), true);
  });
});
