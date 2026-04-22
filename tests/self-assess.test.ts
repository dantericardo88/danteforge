import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runSelfAssess,
  type SelfAssessOptions,
} from '../src/cli/commands/self-assess.js';
import {
  buildSnapshot,
  type ObjectiveMetrics,
  type QualitySnapshot,
} from '../src/core/objective-metrics.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<ObjectiveMetrics> = {}): ObjectiveMetrics {
  return {
    eslintErrors: 0,
    eslintWarnings: 0,
    typescriptErrors: 0,
    testPassRate: 1.0,
    testCount: 3773,
    bundleSizeBytes: 1_900_000,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeOpts(overrides: Partial<SelfAssessOptions> = {}): SelfAssessOptions {
  return {
    cwd: '/fake',
    llmScore: 8.0,
    compareBaseline: false,
    _captureMetrics: async () => makeMetrics(),
    _loadBaseline: async () => null,
    _saveSnapshot: async () => '/fake/.danteforge/quality-snapshots/snapshot-123.json',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSelfAssess', () => {
  it('T1: returns a QualitySnapshot with correct hybrid score', async () => {
    const result = await runSelfAssess(makeOpts({ llmScore: 8.0 }));

    assert.ok(result.current.hybridScore > 0, 'hybridScore should be positive');
    assert.ok(result.current.objectiveScore === 10.0, 'perfect metrics → 10.0 objective');
    // hybrid = 0.6×10 + 0.4×8 = 6+3.2 = 9.2
    assert.equal(result.current.hybridScore, 9.2);
  });

  it('T2: returns improved=false when no previous baseline', async () => {
    const result = await runSelfAssess(makeOpts({ compareBaseline: true }));

    assert.equal(result.previous, null);
    assert.equal(result.diff, null);
    assert.equal(result.improved, false);
  });

  it('T3: improved=true when current hybridScore > previous', async () => {
    const previous: QualitySnapshot = buildSnapshot(
      makeMetrics({ eslintErrors: 10, typescriptErrors: 5 }),
      5.0,
    );

    const result = await runSelfAssess(makeOpts({
      compareBaseline: true,
      llmScore: 8.0,
      _captureMetrics: async () => makeMetrics({ eslintErrors: 0, typescriptErrors: 0 }),
      _loadBaseline: async () => previous,
    }));

    assert.equal(result.improved, true);
    assert.ok(result.current.hybridScore > previous.hybridScore, 'current should be better');
    assert.ok(result.diff !== null, 'diff should be computed');
    assert.equal(result.diff!.hasRegression, false);
  });

  it('T4: detects regression and reports it in diff', async () => {
    const previous: QualitySnapshot = buildSnapshot(makeMetrics(), 8.0); // perfect

    const result = await runSelfAssess(makeOpts({
      compareBaseline: true,
      _captureMetrics: async () => makeMetrics({ eslintErrors: 5, typescriptErrors: 3 }),
      _loadBaseline: async () => previous,
    }));

    assert.ok(result.diff !== null);
    assert.equal(result.diff!.hasRegression, true, 'should detect regression');
    assert.ok(result.diff!.regressions.length > 0, 'should list regressions');
  });

  it('T5: summary string contains key metrics', async () => {
    const result = await runSelfAssess(makeOpts());

    assert.ok(result.summary.includes('Self-Assessment'), 'summary should have header');
    assert.ok(result.summary.includes('Objective score'), 'should show objective score');
    assert.ok(result.summary.includes('Hybrid score'), 'should show hybrid score');
  });

  it('T6: snapshotPath is returned from _saveSnapshot injection', async () => {
    const result = await runSelfAssess(makeOpts({
      _saveSnapshot: async () => '/fake/.danteforge/quality-snapshots/snapshot-999.json',
    }));

    assert.equal(result.snapshotPath, '/fake/.danteforge/quality-snapshots/snapshot-999.json');
  });
});
