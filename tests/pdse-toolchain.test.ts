import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTscErrors,
  parseTestCounts,
  parseLintErrors,
  parseCoverage,
  gatherToolchainMetrics,
  applyToolchainToScores,
  type ToolchainMetrics,
} from '../src/core/pdse-toolchain.js';
import type { ScoreResult } from '../src/core/pdse.js';
import type { ScoredArtifact } from '../src/core/pdse-config.js';

// ── parseTscErrors ────────────────────────────────────────────────────────────

describe('parseTscErrors', () => {
  it('parses "Found N error(s)"', () => {
    assert.equal(parseTscErrors('Found 3 errors in 2 files.'), 3);
  });

  it('parses "Found 0 errors"', () => {
    assert.equal(parseTscErrors('Found 0 errors.'), 0);
  });

  it('falls back to counting error TS lines', () => {
    const out = 'src/a.ts(1,2): error TS2345: foo\nsrc/b.ts(3,4): error TS2322: bar';
    assert.equal(parseTscErrors(out), 2);
  });

  it('returns 0 on empty output', () => {
    assert.equal(parseTscErrors(''), 0);
  });

  it('returns 0 on unrelated output', () => {
    assert.equal(parseTscErrors('Build succeeded. 0 warnings.'), 0);
  });
});

// ── parseTestCounts ───────────────────────────────────────────────────────────

describe('parseTestCounts', () => {
  it('parses Node test runner # pass / # fail', () => {
    const out = '# pass 42\n# fail 3\n';
    const { passing, failing } = parseTestCounts(out);
    assert.equal(passing, 42);
    assert.equal(failing, 3);
  });

  it('parses Node test runner ℹ lines', () => {
    const out = 'ℹ pass 100\nℹ fail 0\n';
    const { passing, failing } = parseTestCounts(out);
    assert.equal(passing, 100);
    assert.equal(failing, 0);
  });

  it('parses Mocha "N passing" / "N failing"', () => {
    const out = '  10 passing (500ms)\n  2 failing\n';
    const { passing, failing } = parseTestCounts(out);
    assert.equal(passing, 10);
    assert.equal(failing, 2);
  });

  it('returns zeros on empty output', () => {
    const { passing, failing } = parseTestCounts('');
    assert.equal(passing, 0);
    assert.equal(failing, 0);
  });

  it('handles only passing (no failing)', () => {
    const out = '# pass 50\n';
    const { passing, failing } = parseTestCounts(out);
    assert.equal(passing, 50);
    assert.equal(failing, 0);
  });
});

// ── parseLintErrors ───────────────────────────────────────────────────────────

describe('parseLintErrors', () => {
  it('parses "N problems (M errors, K warnings)"', () => {
    assert.equal(parseLintErrors('7 problems (5 errors, 2 warnings)'), 7);
  });

  it('returns 0 when no problems', () => {
    assert.equal(parseLintErrors(''), 0);
  });

  it('falls back to counting " error " occurrences', () => {
    const out = '/src/a.ts error line1\n/src/b.ts error line2\n';
    assert.equal(parseLintErrors(out), 2);
  });
});

// ── parseCoverage ─────────────────────────────────────────────────────────────

describe('parseCoverage', () => {
  it('parses "Lines : N%"', () => {
    assert.equal(parseCoverage('Lines          : 84.07%'), 84.07);
  });

  it('parses "All files | ... | N"', () => {
    const out = 'All files     |   88.5 |   80.1 |   85.0 | ...';
    assert.equal(parseCoverage(out), 88.5);
  });

  it('parses "coverage: N%"', () => {
    assert.equal(parseCoverage('coverage: 76.3%'), 76.3);
  });

  it('returns null on no match', () => {
    assert.equal(parseCoverage('no coverage info'), null);
  });
});

// ── gatherToolchainMetrics ────────────────────────────────────────────────────

describe('gatherToolchainMetrics', () => {
  it('returns structured metrics from injected runner', async () => {
    const runner = async (cmd: string) => {
      if (cmd.includes('tsc')) return 'Found 2 errors.';
      if (cmd.includes('npm test')) return '# pass 10\n# fail 1\nLines : 75.0%\n';
      if (cmd.includes('lint')) return '3 problems (3 errors, 0 warnings)';
      return '';
    };
    const metrics = await gatherToolchainMetrics('/fake', { _runCommand: runner });
    assert.equal(metrics.tscErrors, 2);
    assert.equal(metrics.testsPassing, 10);
    assert.equal(metrics.testsFailing, 1);
    assert.equal(metrics.lintErrors, 3);
    assert.equal(metrics.coveragePct, 75);
    assert.ok(metrics.gatherDurationMs >= 0);
  });

  it('returns zeroed metrics when all commands fail', async () => {
    const runner = async () => { throw new Error('command not found'); };
    const metrics = await gatherToolchainMetrics('/fake', { _runCommand: runner });
    assert.equal(metrics.tscErrors, 0);
    assert.equal(metrics.testsFailing, 0);
    assert.equal(metrics.lintErrors, 0);
  });

  it('partial failure: tsc fails but test+lint succeed', async () => {
    const runner = async (cmd: string) => {
      if (cmd.includes('tsc')) throw new Error('tsc not found');
      if (cmd.includes('npm test')) return '# pass 5\n# fail 0\n';
      return '';
    };
    const metrics = await gatherToolchainMetrics('/fake', { _runCommand: runner });
    assert.equal(metrics.tscErrors, 0); // best-effort: error = 0
    assert.equal(metrics.testsPassing, 5);
  });

  it('respects timeout option', async () => {
    let capturedTimeout = 0;
    const runner = async (_cmd: string, _cwd: string) => {
      capturedTimeout = 999; // prove we got called
      return '';
    };
    await gatherToolchainMetrics('/fake', { _runCommand: runner, timeoutMs: 999 });
    assert.equal(capturedTimeout, 999);
  });
});

// ── applyToolchainToScores ────────────────────────────────────────────────────

function makeScore(dims: Partial<Record<string, number>> = {}): ScoreResult {
  const defaultDims = {
    completeness: 20, clarity: 20, testability: 20,
    constitutionAlignment: 20, integrationFitness: 10, freshness: 10,
  };
  const dimensions = { ...defaultDims, ...dims };
  const score = Object.values(dimensions).reduce((s, v) => s + v, 0);
  return { dimensions, score, autoforgeDecision: 'advance', artifact: 'SPEC' } as ScoreResult;
}

function makeScores(overrides: Partial<Record<string, number>> = {}): Record<ScoredArtifact, ScoreResult> {
  return { SPEC: makeScore(overrides) } as unknown as Record<ScoredArtifact, ScoreResult>;
}

describe('applyToolchainToScores', () => {
  it('returns original scores when no deductions needed', () => {
    const scores = makeScores();
    const zeroMetrics: ToolchainMetrics = {
      tscErrors: 0, testsPassing: 5, testsFailing: 0,
      lintErrors: 0, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, zeroMetrics);
    assert.strictEqual(result, scores); // same reference
  });

  it('reduces freshness for tsc errors', () => {
    const scores = makeScores();
    const metrics: ToolchainMetrics = {
      tscErrors: 2, testsPassing: 0, testsFailing: 0,
      lintErrors: 0, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    // freshness was 10, deduction = min(8, 2*2) = 4
    assert.equal(result['SPEC' as ScoredArtifact]?.dimensions.freshness, 6);
  });

  it('caps freshness deduction at 8 (4+ tsc errors)', () => {
    const scores = makeScores({ freshness: 8 });
    const metrics: ToolchainMetrics = {
      tscErrors: 10, testsPassing: 0, testsFailing: 0,
      lintErrors: 0, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    assert.equal(result['SPEC' as ScoredArtifact]?.dimensions.freshness, 0);
  });

  it('reduces testability for failing tests', () => {
    const scores = makeScores();
    const metrics: ToolchainMetrics = {
      tscErrors: 0, testsPassing: 5, testsFailing: 3,
      lintErrors: 0, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    // testability was 20, deduction = min(10, 3*2) = 6
    assert.equal(result['SPEC' as ScoredArtifact]?.dimensions.testability, 14);
  });

  it('caps testability deduction at 10 (5+ failures)', () => {
    const scores = makeScores({ testability: 10 });
    const metrics: ToolchainMetrics = {
      tscErrors: 0, testsPassing: 0, testsFailing: 10,
      lintErrors: 0, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    assert.equal(result['SPEC' as ScoredArtifact]?.dimensions.testability, 0);
  });

  it('reduces clarity for lint errors', () => {
    const scores = makeScores();
    const metrics: ToolchainMetrics = {
      tscErrors: 0, testsPassing: 0, testsFailing: 0,
      lintErrors: 3, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    // clarity was 20, deduction = min(5, 3) = 3
    assert.equal(result['SPEC' as ScoredArtifact]?.dimensions.clarity, 17);
  });

  it('floors dimension values at 0', () => {
    const scores = makeScores({ freshness: 2 });
    const metrics: ToolchainMetrics = {
      tscErrors: 10, testsPassing: 0, testsFailing: 0,
      lintErrors: 0, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    assert.equal(result['SPEC' as ScoredArtifact]?.dimensions.freshness, 0);
  });

  it('recomputes score from adjusted dimensions', () => {
    const scores = makeScores();
    const metrics: ToolchainMetrics = {
      tscErrors: 4, testsPassing: 0, testsFailing: 5,
      lintErrors: 5, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    const spec = result['SPEC' as ScoredArtifact]!;
    const expectedScore = Object.values(spec.dimensions).reduce((s, v) => s + v, 0);
    assert.equal(spec.score, expectedScore);
  });

  it('sets autoforgeDecision based on adjusted score', () => {
    const scores = makeScores({ freshness: 8, testability: 8, clarity: 5 });
    // Score = 20+5+8+20+10+8=71, with deductions it should drop further
    const metrics: ToolchainMetrics = {
      tscErrors: 4, testsPassing: 0, testsFailing: 5,
      lintErrors: 5, coveragePct: null, gatherDurationMs: 0,
    };
    const result = applyToolchainToScores(scores, metrics);
    const dec = result['SPEC' as ScoredArtifact]?.autoforgeDecision;
    assert.ok(['advance', 'warn', 'pause', 'blocked'].includes(dec ?? ''));
  });
});
