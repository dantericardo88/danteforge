import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  captureObjectiveMetrics,
  scoreObjectiveMetrics,
  hybridScore,
  buildSnapshot,
  diffSnapshots,
  loadLatestSnapshot,
  saveSnapshot,
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
    testCount: 100,
    bundleSizeBytes: 500_000,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSnapshot(llmScore = 8.0, overrides: Partial<ObjectiveMetrics> = {}): QualitySnapshot {
  return buildSnapshot(makeMetrics(overrides), llmScore);
}

// ── captureObjectiveMetrics ───────────────────────────────────────────────────

describe('captureObjectiveMetrics', () => {
  it('T1: uses injected functions and returns populated ObjectiveMetrics', async () => {
    const metrics = await captureObjectiveMetrics({
      cwd: '/fake',
      _runLint: async () => JSON.stringify([
        { errorCount: 3, warningCount: 5 },
        { errorCount: 1, warningCount: 2 },
      ]),
      _runTypecheck: async () => 'src/foo.ts(10,1): error TS2345: bad type\nsrc/bar.ts(5,3): error TS2322: other',
      _runTests: async () => ({ passed: 95, total: 100 }),
      _getBundleSize: async () => 800_000,
    });

    assert.equal(metrics.eslintErrors, 4, 'should sum errorCount across files');
    assert.equal(metrics.eslintWarnings, 7, 'should sum warningCount across files');
    assert.equal(metrics.typescriptErrors, 2, 'should count TS error lines');
    assert.equal(metrics.testPassRate, 0.95, 'should compute pass rate');
    assert.equal(metrics.testCount, 100);
    assert.equal(metrics.bundleSizeBytes, 800_000);
    assert.ok(metrics.capturedAt, 'capturedAt should be set');
  });

  it('T2: handles zero errors gracefully (perfect project)', async () => {
    const metrics = await captureObjectiveMetrics({
      cwd: '/fake',
      _runLint: async () => '[]',
      _runTypecheck: async () => '',
      _runTests: async () => ({ passed: 50, total: 50 }),
      _getBundleSize: async () => 300_000,
    });

    assert.equal(metrics.eslintErrors, 0);
    assert.equal(metrics.typescriptErrors, 0);
    assert.equal(metrics.testPassRate, 1.0);
  });

  it('T3: sets testPassRate=-1 when no tests exist', async () => {
    const metrics = await captureObjectiveMetrics({
      cwd: '/fake',
      _runLint: async () => '[]',
      _runTypecheck: async () => '',
      _runTests: async () => ({ passed: 0, total: 0 }),
      _getBundleSize: async () => 0,
    });

    assert.equal(metrics.testPassRate, -1, 'no tests → -1 sentinel');
  });

  it('T4: survives all sub-commands throwing (best-effort capture)', async () => {
    const metrics = await captureObjectiveMetrics({
      cwd: '/fake',
      _runLint: async () => { throw new Error('lint crashed'); },
      _runTypecheck: async () => { throw new Error('tsc crashed'); },
      _runTests: async () => { throw new Error('tests crashed'); },
      _getBundleSize: async () => { throw new Error('stat failed'); },
    });

    assert.equal(metrics.eslintErrors, 0, 'errors default to 0 on failure');
    assert.equal(metrics.typescriptErrors, 0);
    assert.equal(metrics.bundleSizeBytes, 0);
  });
});

// ── scoreObjectiveMetrics ─────────────────────────────────────────────────────

describe('scoreObjectiveMetrics', () => {
  it('T5: perfect project scores 10.0', () => {
    const score = scoreObjectiveMetrics(makeMetrics());
    assert.equal(score, 10.0);
  });

  it('T6: eslint errors reduce score (capped at -2.0)', () => {
    const clean = scoreObjectiveMetrics(makeMetrics({ eslintErrors: 0 }));
    const dirty = scoreObjectiveMetrics(makeMetrics({ eslintErrors: 10 })); // 10 × 0.3 = 3.0, capped 2.0
    assert.ok(clean - dirty <= 2.0 + 1e-9, 'deduction capped at 2.0');
    assert.ok(dirty < clean, 'errors should reduce score');
  });

  it('T7: typescript errors have higher penalty per error than eslint', () => {
    const oneEslint = scoreObjectiveMetrics(makeMetrics({ eslintErrors: 1 }));
    const oneTs = scoreObjectiveMetrics(makeMetrics({ typescriptErrors: 1 }));
    assert.ok(oneTs < oneEslint, 'TS error should penalise more than ESLint error');
  });

  it('T8: all tests failing causes severe deduction (up to -4.0)', () => {
    const perfect = scoreObjectiveMetrics(makeMetrics({ testPassRate: 1.0 }));
    const failing = scoreObjectiveMetrics(makeMetrics({ testPassRate: 0.0 }));
    assert.ok(perfect - failing >= 3.9, 'all tests failing should deduct ~4 points');
  });

  it('T9: score is always in [0, 10] regardless of inputs', () => {
    const extreme = scoreObjectiveMetrics(makeMetrics({
      eslintErrors: 1000,
      typescriptErrors: 1000,
      testPassRate: 0.0,
      bundleSizeBytes: 100_000_000,
    }));
    assert.ok(extreme >= 0, 'score must not go below 0');
    assert.ok(extreme <= 10, 'score must not exceed 10');
  });
});

// ── hybridScore ───────────────────────────────────────────────────────────────

describe('hybridScore', () => {
  it('T10: weights 60% objective + 40% LLM', () => {
    const result = hybridScore(8.0, 6.0);
    // 0.6 × 8.0 + 0.4 × 6.0 = 4.8 + 2.4 = 7.2
    assert.equal(result, 7.2);
  });

  it('T10b: objective score dominates when LLM is optimistic', () => {
    const pessimisticObjective = hybridScore(4.0, 9.0); // 2.4 + 3.6 = 6.0
    assert.equal(pessimisticObjective, 6.0, 'bad objective score limits hybrid even with good LLM score');
  });
});

// ── diffSnapshots ─────────────────────────────────────────────────────────────

describe('diffSnapshots', () => {
  it('T11: detects eslint error regression', () => {
    const baseline = makeSnapshot(8.0, { eslintErrors: 2 });
    const current = makeSnapshot(8.0, { eslintErrors: 5 });
    const diff = diffSnapshots(baseline, current);
    assert.equal(diff.deltaEslintErrors, 3);
    assert.equal(diff.hasRegression, true);
    assert.ok(diff.regressions.some(r => r.includes('ESLint')));
  });

  it('T12: no regression when metrics improve', () => {
    const baseline = makeSnapshot(7.0, { eslintErrors: 5, typescriptErrors: 2 });
    const current = makeSnapshot(8.5, { eslintErrors: 0, typescriptErrors: 0 });
    const diff = diffSnapshots(baseline, current);
    assert.equal(diff.hasRegression, false);
    assert.equal(diff.regressions.length, 0);
    assert.ok(diff.deltaObjectiveScore > 0, 'objective score should improve');
  });
});

// ── saveSnapshot / loadLatestSnapshot ─────────────────────────────────────────

describe('snapshot persistence', () => {
  it('T13: save then load returns same snapshot', async () => {
    const snapshot = makeSnapshot(7.5, { eslintErrors: 1 });
    let stored: Record<string, string> = {};

    await saveSnapshot(snapshot, '/fake', async (p, d) => { stored[p] = d; });

    const storedPath = Object.keys(stored)[0];
    const basename = path.basename(storedPath);
    assert.ok(basename.includes('snapshot-'), 'filename should include snapshot-');

    const loaded = await loadLatestSnapshot(
      '/fake',
      async (p) => {
        if (stored[p]) return stored[p];
        throw new Error('ENOENT');
      },
      async () => [basename],
    );

    assert.ok(loaded !== null, 'should load saved snapshot');
    assert.equal(loaded!.hybridScore, snapshot.hybridScore);
    assert.equal(loaded!.metrics.eslintErrors, 1);
  });

  it('T14: loadLatestSnapshot returns null when directory is empty', async () => {
    const result = await loadLatestSnapshot(
      '/fake',
      async () => { throw new Error('ENOENT'); },
      async () => [],
    );
    assert.equal(result, null);
  });
});

// ── Mutation-killing boundary tests ──────────────────────────────────────────

describe('scoreObjectiveMetrics + hybridScore — mutation boundaries', () => {
  it('Tmut1: hybridScore(10, 0) === 6.0 exactly — kills 0.6/0.4 ratio flip', () => {
    // If ratio were flipped to 0.4×obj + 0.6×llm, result would be 4.0 not 6.0
    assert.equal(hybridScore(10, 0), 6.0);
    // Additional: hybridScore(0, 10) must be 4.0
    assert.equal(hybridScore(0, 10), 4.0);
  });

  it('Tmut2: eslint cap at exactly 7 errors → -2.1 uncapped, -2.0 capped', () => {
    // 7 errors × 0.3 = 2.1, capped at 2.0 → score = 10 - 2.0 = 8.0
    // If cap were removed: 10 - 2.1 = 7.9
    // Kills mutations to the cap value or the 0.3 coefficient
    const score7 = scoreObjectiveMetrics(makeMetrics({ eslintErrors: 7 }));
    const score8 = scoreObjectiveMetrics(makeMetrics({ eslintErrors: 8 }));
    assert.equal(score7, 8.0, '7 eslint errors → score 8.0 (cap hits at 6.67 errors)');
    assert.equal(score8, 8.0, '8 eslint errors → same 8.0 (cap applies to both)');
    // 6 errors = 1.8 deduction (below cap)
    const score6 = scoreObjectiveMetrics(makeMetrics({ eslintErrors: 6 }));
    assert.equal(score6, 8.2, '6 errors = 1.8 deduction → 8.2');
  });

  it('Tmut3: bundle size threshold — 10_000_000 bytes exact boundary', () => {
    // Kills: `> 10_000_000` mutated to `>= 10_000_000` or constant changed
    const scoreAt10M = scoreObjectiveMetrics(makeMetrics({ bundleSizeBytes: 10_000_000 }));
    const scoreAt10MPlus1 = scoreObjectiveMetrics(makeMetrics({ bundleSizeBytes: 10_000_001 }));

    // Exactly 10_000_000: should NOT trigger penalty (> not >=)
    assert.equal(scoreAt10M, 10.0, 'exactly 10MB should have no bundle penalty');
    // 10_000_001: should trigger penalty (tiny but nonzero)
    assert.ok(scoreAt10MPlus1 < 10.0, '10MB+1 byte should trigger bundle size penalty');
  });
});
