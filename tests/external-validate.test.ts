import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runExternalValidation,
  type ExternalProject,
  type ExternalValidateOptions,
} from '../src/cli/commands/external-validate.js';
import type { ObjectiveMetrics } from '../src/core/objective-metrics.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<ObjectiveMetrics> = {}): ObjectiveMetrics {
  return {
    eslintErrors: 0,
    eslintWarnings: 0,
    typescriptErrors: 0,
    testPassRate: 1.0,
    testCount: 50,
    bundleSizeBytes: 100_000,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

const HIGH_QUALITY_METRICS = makeMetrics({ eslintErrors: 0, typescriptErrors: 0, testPassRate: 1.0 });
const LOW_QUALITY_METRICS = makeMetrics({ eslintErrors: 20, typescriptErrors: 10, testPassRate: 0.3 });

function makeBaseOpts(overrides: Partial<ExternalValidateOptions> = {}): ExternalValidateOptions {
  const reports: Record<string, string> = {};
  return {
    cwd: '/fake',
    _tmpDir: '/tmp/ext-validate-test',
    _cloneRepo: async () => {},
    _captureMetrics: async () => HIGH_QUALITY_METRICS,
    _captureLocalMetrics: async () => HIGH_QUALITY_METRICS,
    _removeDir: async () => {},
    _writeReport: async (p, c) => { reports[p] = c; },
    ...overrides,
  };
}

const HIGH_TIER_PROJECT: ExternalProject = {
  label: 'high-quality-lib',
  url: 'https://github.com/example/high',
  expectedTier: 'high',
};

const LOW_TIER_PROJECT: ExternalProject = {
  label: 'low-quality-lib',
  url: 'https://github.com/example/low',
  expectedTier: 'low',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runExternalValidation', () => {
  it('T1: returns empty entries for empty project list', async () => {
    const report = await runExternalValidation([], makeBaseOpts());
    assert.equal(report.entries.length, 0);
    assert.equal(report.calibrationRate, 1.0);
  });

  it('T2: clones and captures metrics for each project', async () => {
    const clonesStarted: string[] = [];

    const report = await runExternalValidation(
      [HIGH_TIER_PROJECT],
      makeBaseOpts({
        _cloneRepo: async (url, _dir) => { clonesStarted.push(url); },
      }),
    );

    assert.equal(clonesStarted.length, 1);
    assert.equal(clonesStarted[0], HIGH_TIER_PROJECT.url);
    assert.equal(report.entries.length, 1);
  });

  it('T3: marks high-quality project as calibrated when score is in high tier', async () => {
    const report = await runExternalValidation(
      [HIGH_TIER_PROJECT],
      makeBaseOpts({ _captureMetrics: async () => HIGH_QUALITY_METRICS }),
    );

    assert.equal(report.entries[0].calibrated, true);
    assert.ok(report.entries[0].score >= 6.5, `expected high score, got ${report.entries[0].score}`);
  });

  it('T4: marks low-quality project as calibrated when score is in low tier', async () => {
    const report = await runExternalValidation(
      [LOW_TIER_PROJECT],
      makeBaseOpts({ _captureMetrics: async () => LOW_QUALITY_METRICS }),
    );

    assert.equal(report.entries[0].calibrated, true);
    assert.ok(report.entries[0].score <= 5.5, `expected low score, got ${report.entries[0].score}`);
  });

  it('T5: rankingValid is true when high-tier scores above low-tier', async () => {
    let callIdx = 0;
    const report = await runExternalValidation(
      [HIGH_TIER_PROJECT, LOW_TIER_PROJECT],
      makeBaseOpts({
        _captureMetrics: async () => {
          callIdx++;
          return callIdx === 1 ? HIGH_QUALITY_METRICS : LOW_QUALITY_METRICS;
        },
      }),
    );

    assert.equal(report.rankingValid, true);
  });

  it('T6: skips project gracefully when clone fails', async () => {
    const report = await runExternalValidation(
      [HIGH_TIER_PROJECT, LOW_TIER_PROJECT],
      makeBaseOpts({
        _cloneRepo: async (url) => {
          if (url === HIGH_TIER_PROJECT.url) throw new Error('network error');
        },
      }),
    );

    // Only the low-tier project should be in entries
    assert.equal(report.entries.length, 1);
    assert.equal(report.entries[0].label, LOW_TIER_PROJECT.label);
  });

  it('T7: writes external-validation.json report', async () => {
    const reports: Record<string, string> = {};

    await runExternalValidation(
      [HIGH_TIER_PROJECT],
      makeBaseOpts({ _writeReport: async (p, c) => { reports[p] = c; } }),
    );

    const reportPaths = Object.keys(reports);
    assert.ok(reportPaths.some(p => p.includes('external-validation.json')));

    const parsed = JSON.parse(Object.values(reports)[0]) as { capturedAt: string };
    assert.ok(parsed.capturedAt);
  });

  it('T8: calibrationRate is 1.0 when all entries are calibrated', async () => {
    const report = await runExternalValidation(
      [HIGH_TIER_PROJECT],
      makeBaseOpts({ _captureMetrics: async () => HIGH_QUALITY_METRICS }),
    );

    assert.equal(report.calibrationRate, 1.0);
  });
});
