// autoresearch tests — pure-function coverage for autoresearch-engine
// Uses only Node.js built-in test runner. No DanteForge runtime imports.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  shouldKeep,
  formatResultsTsv,
  formatReport,
  type ExperimentResult,
  type AutoResearchReport,
} from '../src/core/autoresearch-engine.js';

// ── shouldKeep ────────────────────────────────────────────────────────────────

describe('shouldKeep', () => {
  it('returns true when improvement exceeds noise margin (1%)', () => {
    // current = 98, best = 100, improvement = 2% > 1%
    assert.strictEqual(shouldKeep(98, 100, 0.01), true);
  });

  it('returns false when improvement is within noise margin (1%)', () => {
    // current = 99.5, best = 100, improvement = 0.5% < 1%
    assert.strictEqual(shouldKeep(99.5, 100, 0.01), false);
  });

  it('returns false when improvement is exactly at noise margin boundary', () => {
    // current = 99, best = 100, improvement = 1% — not strictly greater
    assert.strictEqual(shouldKeep(99, 100, 0.01), false);
  });

  it('returns true for 0.6% improvement against a 0.5% noise margin', () => {
    // current = 99.4, best = 100, relative change = 0.6% > 0.5%
    assert.strictEqual(shouldKeep(99.4, 100, 0.005), true);
  });

  it('returns false for 0.4% improvement against a 0.5% noise margin', () => {
    // current = 99.6, best = 100, relative change = 0.4% < 0.5%
    assert.strictEqual(shouldKeep(99.6, 100, 0.005), false);
  });

  it('returns false when current is equal to best', () => {
    assert.strictEqual(shouldKeep(100, 100, 0.01), false);
  });

  it('returns false when current is worse than best (higher value)', () => {
    assert.strictEqual(shouldKeep(110, 100, 0.01), false);
  });

  it('handles negative best values correctly (e.g. negative scores where higher is better inverted)', () => {
    // best = -100, current = -105 — relative change from -100 to -105 is negative (worse)
    // shouldKeep expects "lower is better" so -105 < -100 is "better"
    // (best - current) / abs(best) = (-100 - -105) / 100 = 5 / 100 = 0.05 = 5% > 1%
    assert.strictEqual(shouldKeep(-105, -100, 0.01), true);
  });

  it('returns false when best is 0 and current is 0', () => {
    // No improvement possible from zero baseline with zero current
    assert.strictEqual(shouldKeep(0, 0, 0.01), false);
  });

  it('handles large improvement (50%) well above threshold', () => {
    assert.strictEqual(shouldKeep(50, 100, 0.01), true);
  });
});

// ── formatResultsTsv ──────────────────────────────────────────────────────────

describe('formatResultsTsv', () => {
  it('produces a header row as the first line', () => {
    const tsv = formatResultsTsv([]);
    const firstLine = tsv.split('\n')[0]!;
    assert.strictEqual(firstLine, 'experiment\tmetric_value\tstatus\tdescription');
  });

  it('produces exactly one data row per experiment', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'test change', metricValue: 42.5, status: 'keep' },
      { id: 2, description: 'another change', metricValue: 40.0, status: 'discard' },
    ];
    const tsv = formatResultsTsv(experiments);
    const lines = tsv.split('\n');
    // header + 2 data rows
    assert.strictEqual(lines.length, 3);
  });

  it('uses "crash" as the metric_value when metricValue is null', () => {
    const experiments: ExperimentResult[] = [
      { id: 3, description: 'crashed experiment', metricValue: null, status: 'crash' },
    ];
    const tsv = formatResultsTsv(experiments);
    const dataLine = tsv.split('\n')[1]!;
    assert.ok(dataLine.includes('crash'), `Expected "crash" in data line: ${dataLine}`);
  });

  it('uses tab characters as delimiters', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'change', metricValue: 10, status: 'keep' },
    ];
    const tsv = formatResultsTsv(experiments);
    const dataLine = tsv.split('\n')[1]!;
    const columns = dataLine.split('\t');
    assert.strictEqual(columns.length, 4);
  });

  it('includes the experiment id, metric value, status, and description in each row', () => {
    const experiments: ExperimentResult[] = [
      { id: 7, description: 'reduce imports', metricValue: 123.45, status: 'keep' },
    ];
    const tsv = formatResultsTsv(experiments);
    const dataLine = tsv.split('\n')[1]!;
    assert.ok(dataLine.startsWith('7\t'), `Expected row to start with "7\t": ${dataLine}`);
    assert.ok(dataLine.includes('123.45'), `Expected metric value in row: ${dataLine}`);
    assert.ok(dataLine.includes('keep'), `Expected status in row: ${dataLine}`);
    assert.ok(dataLine.includes('reduce imports'), `Expected description in row: ${dataLine}`);
  });

  it('returns only the header when experiments array is empty', () => {
    const tsv = formatResultsTsv([]);
    const lines = tsv.split('\n');
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0], 'experiment\tmetric_value\tstatus\tdescription');
  });
});

// ── formatReport ──────────────────────────────────────────────────────────────

describe('formatReport', () => {
  function makeReport(overrides: Partial<AutoResearchReport> = {}): AutoResearchReport {
    return {
      goal: 'reduce startup time',
      metric: 'startup time ms',
      duration: '2h 15m 30s',
      baseline: 1000,
      final: 850,
      improvement: 150,
      improvementPercent: 15,
      experiments: [],
      kept: 0,
      discarded: 0,
      crashed: 0,
      insights: [],
      ...overrides,
    };
  }

  it('includes the goal in the report title', () => {
    const report = formatReport(makeReport({ goal: 'improve test coverage' }));
    assert.ok(report.includes('improve test coverage'), 'Expected goal in report title');
  });

  it('includes a Metric Progress section with baseline and final values', () => {
    const report = formatReport(makeReport({ baseline: 500, final: 400 }));
    assert.ok(report.includes('Metric Progress'), 'Expected "Metric Progress" section');
    assert.ok(report.includes('500'), 'Expected baseline value');
    assert.ok(report.includes('400'), 'Expected final value');
  });

  it('includes a Winning Experiments section', () => {
    const report = formatReport(makeReport());
    assert.ok(report.includes('Winning Experiments'), 'Expected "Winning Experiments" section');
  });

  it('includes a Key Insights section', () => {
    const report = formatReport(makeReport());
    assert.ok(report.includes('Key Insights'), 'Expected "Key Insights" section');
  });

  it('includes a Full Results Log section', () => {
    const report = formatReport(makeReport());
    assert.ok(report.includes('Full Results Log'), 'Expected "Full Results Log" section');
  });

  it('lists winning experiments in the table', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'memoize expensive call', metricValue: 850, status: 'keep', commitHash: 'abc1234' },
      { id: 2, description: 'add caching layer', metricValue: 800, status: 'keep', commitHash: 'def5678' },
    ];
    const report = formatReport(makeReport({ experiments, kept: 2 }));
    assert.ok(report.includes('memoize expensive call'), 'Expected first winner description');
    assert.ok(report.includes('add caching layer'), 'Expected second winner description');
    assert.ok(report.includes('abc1234'), 'Expected first commit hash');
  });

  it('lists notable failures in the report', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'risky refactor', metricValue: 1100, status: 'discard' },
      { id: 2, description: 'broken change', metricValue: null, status: 'crash' },
    ];
    const report = formatReport(makeReport({ experiments, discarded: 1, crashed: 1 }));
    assert.ok(report.includes('Notable Failures'), 'Expected "Notable Failures" section');
    assert.ok(report.includes('risky refactor'), 'Expected discarded experiment description');
    assert.ok(report.includes('broken change'), 'Expected crashed experiment description');
  });

  it('includes insights when provided', () => {
    const insights = [
      'Memoization provided the largest gains',
      'Database queries were not the bottleneck',
    ];
    const report = formatReport(makeReport({ insights }));
    assert.ok(report.includes('Memoization provided the largest gains'), 'Expected first insight');
    assert.ok(report.includes('Database queries were not the bottleneck'), 'Expected second insight');
  });

  it('handles zero experiments gracefully without throwing', () => {
    const report = formatReport(makeReport({
      experiments: [],
      kept: 0,
      discarded: 0,
      crashed: 0,
      insights: [],
    }));
    // Should not throw and should still have all sections
    assert.ok(report.includes('Metric Progress'), 'Missing Metric Progress');
    assert.ok(report.includes('Winning Experiments'), 'Missing Winning Experiments');
    assert.ok(report.includes('Notable Failures'), 'Missing Notable Failures');
    assert.ok(report.includes('Key Insights'), 'Missing Key Insights');
    assert.ok(report.includes('Full Results Log'), 'Missing Full Results Log');
  });

  it('shows keep rate as 0.0% when no experiments ran', () => {
    const report = formatReport(makeReport({ experiments: [], kept: 0 }));
    assert.ok(report.includes('0.0%'), 'Expected 0.0% keep rate');
  });

  it('shows duration in the report header', () => {
    const report = formatReport(makeReport({ duration: '4h 0m 0s' }));
    assert.ok(report.includes('4h 0m 0s'), 'Expected duration in report');
  });

  it('shows total experiment count', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'exp one', metricValue: 90, status: 'keep' },
      { id: 2, description: 'exp two', metricValue: 95, status: 'discard' },
      { id: 3, description: 'exp three', metricValue: null, status: 'crash' },
    ];
    const report = formatReport(makeReport({
      experiments,
      kept: 1,
      discarded: 1,
      crashed: 1,
    }));
    assert.ok(report.includes('Experiments run**: 3'), 'Expected total experiment count');
  });

  it('shows improvement percentage correctly', () => {
    const report = formatReport(makeReport({
      improvement: 150,
      improvementPercent: 15,
    }));
    assert.ok(report.includes('15.00%'), 'Expected improvement percentage');
  });
});
