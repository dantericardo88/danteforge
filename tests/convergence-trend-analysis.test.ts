import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeConvergenceTrend } from '../src/core/convergence-trend-analysis.js';

describe('analyzeConvergenceTrend', () => {
  it('classifies steady improvement as improving', () => {
    const result = analyzeConvergenceTrend([
      { score: 7.0, ts: 'a' },
      { score: 7.4, ts: 'b' },
      { score: 7.8, ts: 'c' },
    ]);

    assert.equal(result.status, 'improving');
    assert.equal(result.directionChanges, 0);
  });

  it('classifies repeated give-back after gains as oscillating', () => {
    const result = analyzeConvergenceTrend([
      { score: 8.0, ts: 'a' },
      { score: 8.4, ts: 'b' },
      { score: 8.1, ts: 'c' },
      { score: 8.5, ts: 'd' },
      { score: 8.2, ts: 'e' },
    ]);

    assert.equal(result.status, 'oscillating');
    assert.equal(result.directionChanges, 3);
    assert.ok(result.drawdown >= 0.2, `expected meaningful drawdown, got ${result.drawdown}`);
  });
});
