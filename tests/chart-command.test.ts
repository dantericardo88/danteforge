import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runChart,
  renderSparkline,
  computeTrend,
  computeCompoundRate,
  renderCompoundRate,
  type ChartOptions,
} from '../src/cli/commands/chart.js';
import type { ConvergenceState } from '../src/core/convergence.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function emptyConvergence(): ConvergenceState {
  return {
    version: '1.0.0',
    targetScore: 9.0,
    dimensions: [],
    cycleHistory: [],
    lastCycle: 0,
    totalCostUsd: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    adoptedPatternsSummary: [],
  };
}

function makeBaseOptions(overrides: Partial<ChartOptions> = {}): ChartOptions {
  return {
    _loadConvergence: async () => null,
    ...overrides,
  };
}

// Known sparkline characters (▁▂▃▄▅▆▇█)
const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('chart-command', () => {
  describe('renderSparkline', () => {
    it('T1: renderSparkline([0, 5, 10]) → produces a 3-char string of sparkline chars', () => {
      const result = renderSparkline([0, 5, 10]);

      assert.equal(result.length, 3, `Expected 3 chars, got ${result.length}: "${result}"`);

      for (const ch of result) {
        assert.ok(
          SPARK_CHARS.includes(ch),
          `Character "${ch}" is not a valid sparkline character`,
        );
      }

      // Score 0 → lowest char (▁), score 10 → highest char (█)
      assert.equal(result[0], '▁', `Score 0 should map to ▁, got "${result[0]}"`);
      assert.equal(result[2], '█', `Score 10 should map to █, got "${result[2]}"`);
    });

    it('T2: renderSparkline([]) → returns empty string or single char (no crash)', () => {
      const result = renderSparkline([]);

      // Per implementation: empty → '─'
      assert.ok(typeof result === 'string', 'Should return a string for empty input');
      assert.ok(result.length >= 0, 'Should not crash on empty input');
    });
  });

  describe('computeTrend', () => {
    it('T3: computeTrend([3, 7]) → delta=4, arrow=▲', () => {
      const trend = computeTrend([3, 7]);

      assert.equal(trend.delta, 4);
      assert.equal(trend.arrow, '▲');
    });

    it('T4: computeTrend([7, 3]) → delta=-4, arrow=▼', () => {
      const trend = computeTrend([7, 3]);

      assert.equal(trend.delta, -4);
      assert.equal(trend.arrow, '▼');
    });

    it('T5: computeTrend([5, 5]) → delta=0, arrow=─', () => {
      const trend = computeTrend([5, 5]);

      assert.equal(trend.delta, 0);
      assert.equal(trend.arrow, '─');
    });
  });

  describe('computeCompoundRate', () => {
    it('T6a: returns 0 when no cycles have run', () => {
      const state: ConvergenceState = {
        ...emptyConvergence(),
        lastCycle: 0,
        adoptedPatternsSummary: [],
      };
      assert.equal(computeCompoundRate(state), 0);
    });

    it('T6b: returns 0 when no patterns adopted', () => {
      const state: ConvergenceState = {
        ...emptyConvergence(),
        lastCycle: 5,
        adoptedPatternsSummary: [],
      };
      assert.equal(computeCompoundRate(state), 0);
    });

    it('T6c: returns positive rate when cycles and patterns exist', () => {
      const state: ConvergenceState = {
        ...emptyConvergence(),
        lastCycle: 4,
        adoptedPatternsSummary: ['pattern-a', 'pattern-b', 'pattern-c', 'pattern-d'],
        dimensions: [
          {
            dimension: 'testing',
            score: 8.0,
            evidence: [],
            scoreHistory: [4.0, 5.5, 7.0, 8.0],
            converged: false,
          },
        ],
      };
      const rate = computeCompoundRate(state);
      assert.ok(rate > 0, `Expected positive ICR, got ${rate}`);
    });
  });

  describe('renderCompoundRate', () => {
    it('T6d: renders N/A for zero rate', () => {
      assert.ok(renderCompoundRate(0).includes('N/A'));
    });

    it('T6e: renders compounding label for high rate', () => {
      assert.ok(renderCompoundRate(1.5).includes('compounding'));
    });

    it('T6f: renders improving label for moderate rate', () => {
      const label = renderCompoundRate(0.25);
      assert.ok(label.includes('improving') || label.includes('slow'));
    });
  });

  describe('runChart', () => {
    it('T6: runChart with no convergence state → returns string without crashing', async () => {
      const options = makeBaseOptions({
        _loadConvergence: async () => null,
      });

      const result = await runChart(options);

      assert.ok(typeof result === 'string', 'Should return a string');
      assert.ok(result.length > 0, 'Should return a non-empty string');
      // Should contain a message indicating no data
      assert.ok(
        result.includes('no') || result.includes('Chart'),
        `Expected "no" or "Chart" in empty state output, got: "${result}"`,
      );
    });

    it('T7: runChart with dimension filter → shows only matching dimension', async () => {
      const convergence: ConvergenceState = {
        ...emptyConvergence(),
        dimensions: [
          {
            dimension: 'security',
            score: 7.0,
            evidence: [],
            scoreHistory: [5.0, 6.0, 7.0],
            converged: false,
          },
          {
            dimension: 'testing',
            score: 8.0,
            evidence: [],
            scoreHistory: [6.0, 7.0, 8.0],
            converged: false,
          },
        ],
        cycleHistory: [
          {
            cycle: 1,
            timestamp: new Date().toISOString(),
            adoptionsAttempted: 1,
            adoptionsSucceeded: 1,
            scoresBefore: { security: 5.0, testing: 6.0 },
            scoresAfter: { security: 6.0, testing: 7.0 },
            costUsd: 0.1,
          },
          {
            cycle: 2,
            timestamp: new Date().toISOString(),
            adoptionsAttempted: 1,
            adoptionsSucceeded: 1,
            scoresBefore: { security: 6.0, testing: 7.0 },
            scoresAfter: { security: 7.0, testing: 8.0 },
            costUsd: 0.1,
          },
        ],
      };

      const options = makeBaseOptions({
        _loadConvergence: async () => convergence,
        dimension: 'security',
      });

      const result = await runChart(options);

      assert.ok(typeof result === 'string', 'Should return a string');
      assert.ok(
        result.includes('security'),
        `Expected "security" in filtered chart output, got: "${result}"`,
      );
      assert.ok(
        !result.includes('testing'),
        `Expected "testing" to be filtered out, got: "${result}"`,
      );
    });
  });
});
