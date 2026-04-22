import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSparkline,
  computeTrend,
  computeCompoundRate,
  renderCompoundRate,
} from '../src/cli/commands/chart.js';
import type { ConvergenceState } from '../src/core/convergence.js';

function makeConvergenceState(overrides: Partial<ConvergenceState> = {}): ConvergenceState {
  return {
    targetScore: 9.0,
    dimensions: [],
    lastCycle: 0,
    adoptedPatternsSummary: [],
    ...overrides,
  };
}

describe('renderSparkline', () => {
  it('returns single dash for empty array', () => {
    assert.equal(renderSparkline([]), '─');
  });

  it('returns single char for single score', () => {
    const result = renderSparkline([5]);
    assert.equal(result.length, 1);
  });

  it('returns chars for each score', () => {
    const result = renderSparkline([0, 5, 10]);
    assert.equal(result.length, 3);
  });

  it('score 0 maps to lowest char', () => {
    const result = renderSparkline([0]);
    assert.equal(result, '▁');
  });

  it('score 10 maps to highest char', () => {
    const result = renderSparkline([10]);
    assert.equal(result, '█');
  });

  it('score 5 maps to mid char', () => {
    const result = renderSparkline([5]);
    assert.ok(result.length === 1);
    assert.ok(['▄', '▅'].includes(result));
  });

  it('clamps below 0', () => {
    const result = renderSparkline([-5]);
    assert.equal(result, '▁');
  });

  it('clamps above 10', () => {
    const result = renderSparkline([15]);
    assert.equal(result, '█');
  });
});

describe('computeTrend', () => {
  it('returns neutral for empty array', () => {
    const result = computeTrend([]);
    assert.equal(result.delta, 0);
    assert.equal(result.arrow, '─');
  });

  it('returns neutral for single element', () => {
    const result = computeTrend([5]);
    assert.equal(result.delta, 0);
    assert.equal(result.arrow, '─');
  });

  it('detects upward trend', () => {
    const result = computeTrend([3, 5, 7, 9]);
    assert.equal(result.arrow, '▲');
    assert.ok(result.delta > 0);
  });

  it('detects downward trend', () => {
    const result = computeTrend([9, 7, 5, 3]);
    assert.equal(result.arrow, '▼');
    assert.ok(result.delta < 0);
  });

  it('detects flat trend', () => {
    const result = computeTrend([5, 6, 5]);
    assert.equal(result.arrow, '─');
    assert.equal(result.delta, 0);
  });

  it('computes delta as last minus first', () => {
    const result = computeTrend([2, 4, 6, 8]);
    assert.equal(result.delta, 6);
  });

  it('rounds delta to 2 decimal places', () => {
    const result = computeTrend([1.111, 4.444]);
    assert.ok(Number.isFinite(result.delta));
    const str = result.delta.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    assert.ok(decimals <= 2);
  });
});

describe('computeCompoundRate', () => {
  it('returns 0 when no cycles', () => {
    const state = makeConvergenceState({ lastCycle: 0 });
    assert.equal(computeCompoundRate(state), 0);
  });

  it('returns 0 when no adopted patterns', () => {
    const state = makeConvergenceState({ lastCycle: 5, adoptedPatternsSummary: [] });
    assert.equal(computeCompoundRate(state), 0);
  });

  it('returns 0 when dimensions have no history', () => {
    const state = makeConvergenceState({
      lastCycle: 3,
      adoptedPatternsSummary: ['pattern-a'],
      dimensions: [{ dimension: 'testing', score: 8, target: 9, converged: false, scoreHistory: [8] }],
    });
    assert.equal(computeCompoundRate(state), 0);
  });

  it('returns positive rate when dimensions improved', () => {
    const state = makeConvergenceState({
      lastCycle: 2,
      adoptedPatternsSummary: ['pattern-a', 'pattern-b'],
      dimensions: [
        { dimension: 'testing', score: 8, target: 9, converged: false, scoreHistory: [5, 8] },
      ],
    });
    const rate = computeCompoundRate(state);
    assert.ok(rate > 0);
  });

  it('rate is non-negative', () => {
    const state = makeConvergenceState({
      lastCycle: 3,
      adoptedPatternsSummary: ['p1'],
      dimensions: [
        { dimension: 'testing', score: 4, target: 9, converged: false, scoreHistory: [8, 4] },
      ],
    });
    const rate = computeCompoundRate(state);
    assert.ok(rate >= 0);
  });
});

describe('renderCompoundRate', () => {
  it('returns N/A for zero rate', () => {
    const result = renderCompoundRate(0);
    assert.ok(result.includes('N/A'));
  });

  it('labels fast compounding for rate >= 1.0', () => {
    const result = renderCompoundRate(1.5);
    assert.ok(result.includes('compounding fast'));
    assert.ok(result.includes('★'));
  });

  it('labels compounding for rate >= 0.5', () => {
    const result = renderCompoundRate(0.75);
    assert.ok(result.includes('compounding'));
    assert.ok(result.includes('↑'));
  });

  it('labels improving for rate >= 0.1', () => {
    const result = renderCompoundRate(0.3);
    assert.ok(result.includes('improving'));
    assert.ok(result.includes('→'));
  });

  it('labels slow for rate < 0.1', () => {
    const result = renderCompoundRate(0.05);
    assert.ok(result.includes('slow'));
    assert.ok(result.includes('↓'));
  });

  it('includes formatted rate value', () => {
    const result = renderCompoundRate(0.75);
    assert.ok(result.includes('0.75'));
  });
});
