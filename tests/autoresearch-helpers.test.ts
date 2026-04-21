// autoresearch-helpers.test.ts — pure helper function tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExperimentResult } from '../src/core/autoresearch-engine.js';
import {
  resolveNoiseMargin,
  slugify,
  parseTimeBudget,
  formatDuration,
  deriveMeasurementCommand,
  buildFallbackInsights,
  buildPromptModeOutput,
} from '../src/cli/commands/autoresearch.js';

// ── resolveNoiseMargin ────────────────────────────────────────────────────────

describe('resolveNoiseMargin', () => {
  it('returns 0.01 for timing keyword "ms"', () => {
    assert.strictEqual(resolveNoiseMargin('startup ms'), 0.01);
  });

  it('returns 0.01 for timing keyword "latency"', () => {
    assert.strictEqual(resolveNoiseMargin('p99 latency'), 0.01);
  });

  it('returns 0.005 for non-timing metric', () => {
    assert.strictEqual(resolveNoiseMargin('coverage percent'), 0.005);
  });
});

// ── slugify ───────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('lowercases and replaces spaces + special chars with dashes', () => {
    assert.strictEqual(slugify('Hello World!'), 'hello-world');
  });

  it('deduplicates multiple consecutive dashes', () => {
    assert.strictEqual(slugify('test --- coverage --- metric'), 'test-coverage-metric');
  });

  it('truncates to 50 characters', () => {
    const long = 'a'.repeat(60);
    assert.strictEqual(slugify(long).length, 50);
  });

  it('strips leading and trailing dashes', () => {
    assert.strictEqual(slugify('  hello  '), 'hello');
  });
});

// ── parseTimeBudget ───────────────────────────────────────────────────────────

describe('parseTimeBudget', () => {
  it('parses hours with "h" suffix', () => {
    assert.strictEqual(parseTimeBudget('4h'), 240);
  });

  it('parses minutes with "m" suffix', () => {
    assert.strictEqual(parseTimeBudget('30m'), 30);
  });

  it('parses minutes with "min" suffix', () => {
    assert.strictEqual(parseTimeBudget('15min'), 15);
  });

  it('treats bare number as minutes', () => {
    assert.strictEqual(parseTimeBudget('60'), 60);
  });

  it('returns 240 for invalid input', () => {
    assert.strictEqual(parseTimeBudget('xyz'), 240);
  });
});

// ── formatDuration ────────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats hours, minutes and seconds', () => {
    assert.strictEqual(formatDuration(3_661_000), '1h 1m 1s');
  });

  it('formats minutes and seconds (no hours)', () => {
    assert.strictEqual(formatDuration(65_000), '1m 5s');
  });

  it('formats seconds only', () => {
    assert.strictEqual(formatDuration(5_000), '5s');
  });
});

// ── deriveMeasurementCommand ──────────────────────────────────────────────────

describe('deriveMeasurementCommand', () => {
  it('returns npm test command for test passing rate', () => {
    assert.ok(deriveMeasurementCommand('test passing rate').includes('npm test'));
  });

  it('returns build command for bundle size', () => {
    assert.ok(deriveMeasurementCommand('bundle size kb').includes('npm run build'));
  });

  it('returns lint command for lint error count', () => {
    assert.ok(deriveMeasurementCommand('lint errors').includes('npm run lint'));
  });

  it('returns null for unknown metric so callers must provide an explicit command', () => {
    assert.strictEqual(deriveMeasurementCommand('some unknown metric'), null);
  });
});

// ── buildFallbackInsights ─────────────────────────────────────────────────────

describe('buildFallbackInsights', () => {
  it('returns single no-experiments message for empty array', () => {
    const insights = buildFallbackInsights([], 100, 100);
    assert.strictEqual(insights.length, 1);
    assert.ok(insights[0]!.includes('No experiments'));
  });

  it('includes improvement pct and crash warning when applicable', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'exp 1', metricValue: 80, status: 'keep' },
      { id: 2, description: 'exp 2', metricValue: 80, status: 'keep' },
      { id: 3, description: 'exp 3', metricValue: null, status: 'crash' },
    ];
    const insights = buildFallbackInsights(experiments, 100, 80);
    const allText = insights.join('\n');
    assert.ok(allText.includes('20.00'), 'should include improvement percentage');
    assert.ok(allText.includes('crash'), 'should mention crashes');
  });
});

// ── buildPromptModeOutput ─────────────────────────────────────────────────────

describe('buildPromptModeOutput', () => {
  it('includes goal, metric, time budget and measurement command', () => {
    const output = buildPromptModeOutput('reduce latency', 'p99 ms', 30, 'npm test');
    assert.ok(output.includes('reduce latency'));
    assert.ok(output.includes('p99 ms'));
    assert.ok(output.includes('30'));
    assert.ok(output.includes('npm test'));
  });

  it('contains autonomous instruction (no stopping for human)', () => {
    const output = buildPromptModeOutput('g', 'm', 10, 'cmd');
    assert.ok(output.toLowerCase().includes('autonomous'));
  });
});
