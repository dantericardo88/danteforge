// PDSE Toolchain Grounding tests — gatherToolchainMetrics + parsers + applyToolchainToScores

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ScoreResult } from '../src/core/pdse.js';
import type { ScoredArtifact } from '../src/core/pdse-config.js';
import {
  parseTscErrors,
  parseTestCounts,
  parseLintErrors,
  parseCoverage,
  gatherToolchainMetrics,
  applyToolchainToScores,
  type ToolchainMetrics,
} from '../src/core/pdse-toolchain.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<ToolchainMetrics> = {}): ToolchainMetrics {
  return {
    tscErrors: 0,
    testsPassing: 100,
    testsFailing: 0,
    lintErrors: 0,
    coveragePct: 80,
    gatherDurationMs: 100,
    ...overrides,
  };
}

function makeScoreResult(overrides: Partial<ScoreResult['dimensions']> = {}): ScoreResult {
  return {
    score: 90,
    autoforgeDecision: 'advance',
    dimensions: {
      completeness: 20,
      freshness: 20,
      clarity: 20,
      testability: 20,
      integration: 10,
      ...overrides,
    },
    gaps: [],
  };
}

function makeScores(): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScoreResult(),
    SPEC: makeScoreResult(),
    CLARIFY: makeScoreResult(),
    PLAN: makeScoreResult(),
    TASKS: makeScoreResult(),
  };
}

// ── parseTscErrors ────────────────────────────────────────────────────────────

describe('parseTscErrors', () => {
  it('parses "Found N error(s)" summary line', () => {
    assert.equal(parseTscErrors('Found 3 error(s) in 2 files'), 3);
  });

  it('parses "Found 1 error" (singular)', () => {
    assert.equal(parseTscErrors('Found 1 error in 1 file'), 1);
  });

  it('falls back to counting "error TS" lines', () => {
    const out = 'src/foo.ts:1:2 - error TS2345: ...\nsrc/bar.ts:3:4 - error TS2322: ...';
    assert.equal(parseTscErrors(out), 2);
  });

  it('returns 0 for clean output', () => {
    assert.equal(parseTscErrors(''), 0);
    assert.equal(parseTscErrors('All ok!'), 0);
  });

  it('prefers summary over individual lines', () => {
    const out = 'Found 1 error in 1 file\nerror TS1234: something\nerror TS5678: other';
    assert.equal(parseTscErrors(out), 1);
  });
});

// ── parseTestCounts ────────────────────────────────────────────────────────────

describe('parseTestCounts', () => {
  it('parses Node built-in runner "ℹ pass N" / "ℹ fail N"', () => {
    const out = 'ℹ pass 42\nℹ fail 3';
    const r = parseTestCounts(out);
    assert.equal(r.passing, 42);
    assert.equal(r.failing, 3);
  });

  it('parses Node built-in runner "# pass N" / "# fail N"', () => {
    const out = '# pass 10\n# fail 0';
    const r = parseTestCounts(out);
    assert.equal(r.passing, 10);
    assert.equal(r.failing, 0);
  });

  it('parses Mocha "N passing" / "N failing"', () => {
    const out = '15 passing (200ms)\n2 failing';
    const r = parseTestCounts(out);
    assert.equal(r.passing, 15);
    assert.equal(r.failing, 2);
  });

  it('returns zeros for empty output', () => {
    const r = parseTestCounts('');
    assert.equal(r.passing, 0);
    assert.equal(r.failing, 0);
  });

  it('handles only pass with no fail line', () => {
    const out = 'ℹ pass 5';
    const r = parseTestCounts(out);
    assert.equal(r.passing, 5);
    assert.equal(r.failing, 0);
  });
});

// ── parseLintErrors ────────────────────────────────────────────────────────────

describe('parseLintErrors', () => {
  it('parses "N problems" summary', () => {
    assert.equal(parseLintErrors('10 problems (8 errors, 2 warnings)'), 10);
  });

  it('falls back to counting " error " lines', () => {
    const out = 'line 1:  error  rule1\nline 2:  error  rule2';
    assert.equal(parseLintErrors(out), 2);
  });

  it('returns 0 for clean output', () => {
    assert.equal(parseLintErrors(''), 0);
    assert.equal(parseLintErrors('All files pass linting'), 0);
  });

  it('parses "1 problem"', () => {
    assert.equal(parseLintErrors('1 problem (1 error, 0 warnings)'), 1);
  });
});

// ── parseCoverage ────────────────────────────────────────────────────────────

describe('parseCoverage', () => {
  it('parses "Lines : N%"', () => {
    assert.equal(parseCoverage('Lines    : 85.5%'), 85.5);
  });

  it('parses "All files | N%" column (captures value after second pipe)', () => {
    // Regex: All files\s*\|[^|]*\|\s*([\d.]+) — captures after the second '|'
    const out = 'All files    | 79.35 | 65.0  | 80.0  | 79.35 |';
    assert.equal(parseCoverage(out), 65.0);
  });

  it('parses "coverage: N%"', () => {
    assert.equal(parseCoverage('coverage: 90.1%'), 90.1);
  });

  it('returns null for no coverage data', () => {
    assert.equal(parseCoverage('no coverage here'), null);
    assert.equal(parseCoverage(''), null);
  });
});

// ── gatherToolchainMetrics ────────────────────────────────────────────────────

describe('gatherToolchainMetrics', () => {
  it('returns structured metrics with injected runner', async () => {
    const runCmd = async (cmd: string) => {
      if (cmd.includes('tsc')) return 'All ok!';
      if (cmd.includes('test')) return 'ℹ pass 42\nℹ fail 0';
      if (cmd.includes('lint')) return '0 problems (0 errors, 0 warnings)';
      return '';
    };

    const result = await gatherToolchainMetrics('/fake/cwd', { _runCommand: runCmd });
    assert.equal(result.tscErrors, 0);
    assert.equal(result.testsPassing, 42);
    assert.equal(result.testsFailing, 0);
    assert.equal(result.lintErrors, 0);
    assert.ok(result.gatherDurationMs >= 0);
  });

  it('handles tsc errors correctly', async () => {
    const runCmd = async (cmd: string) => {
      if (cmd.includes('tsc')) return 'Found 5 errors in 3 files';
      return '';
    };
    const result = await gatherToolchainMetrics('/fake/cwd', { _runCommand: runCmd });
    assert.equal(result.tscErrors, 5);
  });

  it('handles test failures', async () => {
    const runCmd = async (cmd: string) => {
      if (cmd.includes('test')) return 'ℹ pass 8\nℹ fail 2';
      return '';
    };
    const result = await gatherToolchainMetrics('/fake/cwd', { _runCommand: runCmd });
    assert.equal(result.testsPassing, 8);
    assert.equal(result.testsFailing, 2);
  });

  it('extracts coverage from test output', async () => {
    const runCmd = async (cmd: string) => {
      if (cmd.includes('test')) return 'ℹ pass 10\nℹ fail 0\nLines : 82.5%';
      return '';
    };
    const result = await gatherToolchainMetrics('/fake/cwd', { _runCommand: runCmd });
    assert.equal(result.coveragePct, 82.5);
  });

  it('is graceful when runner throws', async () => {
    const runCmd = async () => { throw new Error('command not found'); };
    const result = await gatherToolchainMetrics('/fake/cwd', { _runCommand: runCmd });
    assert.equal(result.tscErrors, 0);
    assert.equal(result.testsPassing, 0);
    assert.equal(result.testsFailing, 0);
    assert.equal(result.lintErrors, 0);
    assert.equal(result.coveragePct, null);
  });

  it('records gatherDurationMs as a non-negative number', async () => {
    const result = await gatherToolchainMetrics('/fake', { _runCommand: async () => '' });
    assert.ok(typeof result.gatherDurationMs === 'number');
    assert.ok(result.gatherDurationMs >= 0);
  });
});

// ── applyToolchainToScores ────────────────────────────────────────────────────

describe('applyToolchainToScores', () => {
  it('returns input unchanged when all metrics are zero', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics());
    assert.deepEqual(result, scores);
  });

  it('deducts from freshness based on tscErrors', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics({ tscErrors: 2 }));
    // freshnessDeduction = min(8, 2*2) = 4
    assert.equal(result.CONSTITUTION.dimensions.freshness, 20 - 4);
  });

  it('caps freshness deduction at 8', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics({ tscErrors: 10 }));
    // freshnessDeduction = min(8, 10*2) = 8
    assert.equal(result.CONSTITUTION.dimensions.freshness, 20 - 8);
  });

  it('deducts from testability based on testsFailing', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics({ testsFailing: 3 }));
    // testabilityDeduction = min(10, 3*2) = 6
    assert.equal(result.CONSTITUTION.dimensions.testability, 20 - 6);
  });

  it('caps testability deduction at 10', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics({ testsFailing: 6 }));
    assert.equal(result.CONSTITUTION.dimensions.testability, 20 - 10);
  });

  it('deducts from clarity based on lintErrors', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics({ lintErrors: 3 }));
    assert.equal(result.CONSTITUTION.dimensions.clarity, 20 - 3);
  });

  it('caps clarity deduction at 5', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics({ lintErrors: 10 }));
    assert.equal(result.CONSTITUTION.dimensions.clarity, 20 - 5);
  });

  it('recomputes autoforgeDecision based on adjusted score', () => {
    // Start with a low-score artifact that drops below thresholds
    const lowScores: Record<ScoredArtifact, ScoreResult> = {
      CONSTITUTION: makeScoreResult({ freshness: 5, testability: 5, clarity: 5, completeness: 5, integration: 5 }),
      SPEC: makeScoreResult(),
      CLARIFY: makeScoreResult(),
      PLAN: makeScoreResult(),
      TASKS: makeScoreResult(),
    };
    // Score = 25, after deducting tscErrors=5 (freshness -= 8): score drops to ~17 → 'blocked'
    const result = applyToolchainToScores(lowScores, makeMetrics({ tscErrors: 5 }));
    assert.ok(['blocked', 'pause', 'warn', 'advance'].includes(result.CONSTITUTION.autoforgeDecision));
  });

  it('does not mutate input scores', () => {
    const scores = makeScores();
    const original = JSON.parse(JSON.stringify(scores));
    applyToolchainToScores(scores, makeMetrics({ tscErrors: 2 }));
    assert.deepEqual(scores, original);
  });

  it('applies deductions to all artifacts', () => {
    const scores = makeScores();
    const result = applyToolchainToScores(scores, makeMetrics({ tscErrors: 2 }));
    const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
    for (const a of artifacts) {
      assert.equal(result[a].dimensions.freshness, 20 - 4, `${a} freshness should be deducted`);
    }
  });

  it('prevents dimensions from going below 0', () => {
    const lowDims = makeScoreResult({ freshness: 2, testability: 2, clarity: 2 });
    const scores = { CONSTITUTION: lowDims, SPEC: makeScoreResult(), CLARIFY: makeScoreResult(), PLAN: makeScoreResult(), TASKS: makeScoreResult() };
    const result = applyToolchainToScores(scores, makeMetrics({ tscErrors: 5, testsFailing: 5, lintErrors: 5 }));
    assert.ok(result.CONSTITUTION.dimensions.freshness >= 0);
    assert.ok(result.CONSTITUTION.dimensions.testability >= 0);
    assert.ok(result.CONSTITUTION.dimensions.clarity >= 0);
  });
});
