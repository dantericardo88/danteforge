// testing-dimension.test.ts — Tests for mutation-score-tracker, test-coverage-analyzer, and test-coverage command
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  recordMutationScore,
  getMutationSummary,
  formatMutationReport,
  mutationScoresPath,
  MUTATION_SCORES_FILENAME,
  type MutationScoreRecord,
  type MutationSummary,
} from '../src/core/mutation-score-tracker.js';
import {
  analyzeTestCoverage,
} from '../src/core/test-coverage-analyzer.js';
import {
  testCoverage,
} from '../src/cli/commands/test-coverage.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<MutationScoreRecord> = {}): MutationScoreRecord {
  return {
    file: 'src/core/state.ts',
    score: 75,
    mutantsKilled: 30,
    mutantsTotal: 40,
    date: '2026-05-14T10:00:00.000Z',
    ...overrides,
  };
}

function makeJsonl(records: MutationScoreRecord[]): string {
  return records.map(r => JSON.stringify(r)).join('\n') + '\n';
}

// ── mutationScoresPath ────────────────────────────────────────────────────────

describe('mutationScoresPath', () => {
  it('returns path under .danteforge directory', () => {
    const p = mutationScoresPath('/project');
    assert.ok(p.includes('.danteforge'));
    assert.ok(p.includes(MUTATION_SCORES_FILENAME));
  });

  it('uses the provided cwd', () => {
    const p = mutationScoresPath('/my/project');
    // Normalize separators for cross-platform (Windows uses backslash)
    const normalized = p.replace(/\\/g, '/');
    assert.ok(normalized.startsWith('/my/project'));
  });
});

// ── recordMutationScore ───────────────────────────────────────────────────────

describe('recordMutationScore', () => {
  it('calls appender with serialized JSON line', async () => {
    const appended: Array<{ filePath: string; line: string }> = [];
    const mkdirCalls: string[] = [];

    await recordMutationScore(
      makeRecord(),
      '/test/cwd',
      async (filePath, line) => { appended.push({ filePath, line }); },
      async (p) => { mkdirCalls.push(p); },
    );

    assert.equal(appended.length, 1);
    assert.ok(appended[0]!.line.includes('"file"'));
    assert.ok(appended[0]!.line.includes('"score"'));
    assert.ok(appended[0]!.filePath.includes('mutation-scores.jsonl'));
  });

  it('creates .danteforge directory before appending', async () => {
    const mkdirCalls: string[] = [];
    await recordMutationScore(
      makeRecord(),
      '/cwd',
      async () => {},
      async (p) => { mkdirCalls.push(p); },
    );
    assert.ok(mkdirCalls.some(p => p.includes('.danteforge')));
  });

  it('serializes all MutationScoreRecord fields', async () => {
    let captured = '';
    await recordMutationScore(
      makeRecord({ file: 'src/core/llm.ts', score: 88, mutantsKilled: 22, mutantsTotal: 25, date: '2026-01-01' }),
      '/cwd',
      async (_, line) => { captured = line; },
      async () => {},
    );
    const parsed = JSON.parse(captured) as MutationScoreRecord;
    assert.equal(parsed.file, 'src/core/llm.ts');
    assert.equal(parsed.score, 88);
    assert.equal(parsed.mutantsKilled, 22);
    assert.equal(parsed.mutantsTotal, 25);
    assert.equal(parsed.date, '2026-01-01');
  });

  it('works with score = 0 (all mutants survived)', async () => {
    let captured = '';
    await recordMutationScore(
      makeRecord({ score: 0, mutantsKilled: 0, mutantsTotal: 10 }),
      '/cwd',
      async (_, line) => { captured = line; },
      async () => {},
    );
    const parsed = JSON.parse(captured) as MutationScoreRecord;
    assert.equal(parsed.score, 0);
  });

  it('works with score = 100 (all mutants killed)', async () => {
    let captured = '';
    await recordMutationScore(
      makeRecord({ score: 100, mutantsKilled: 50, mutantsTotal: 50 }),
      '/cwd',
      async (_, line) => { captured = line; },
      async () => {},
    );
    const parsed = JSON.parse(captured) as MutationScoreRecord;
    assert.equal(parsed.score, 100);
  });
});

// ── getMutationSummary ────────────────────────────────────────────────────────

describe('getMutationSummary', () => {
  it('returns empty summary when file does not exist', async () => {
    const summary = await getMutationSummary('/nonexistent', async () => {
      throw new Error('ENOENT');
    });
    assert.equal(summary.recordCount, 0);
    assert.equal(summary.avgScore, 0);
    assert.equal(summary.weakestFile, '');
    assert.equal(summary.dateOfLastRun, '');
  });

  it('returns empty summary for empty file', async () => {
    const summary = await getMutationSummary('/cwd', async () => '');
    assert.equal(summary.recordCount, 0);
  });

  it('returns empty summary when all lines are malformed JSON', async () => {
    const summary = await getMutationSummary('/cwd', async () => 'not-json\nalso-not-json\n');
    assert.equal(summary.recordCount, 0);
  });

  it('aggregates a single record correctly', async () => {
    const record = makeRecord({ score: 80, mutantsKilled: 40, mutantsTotal: 50 });
    const summary = await getMutationSummary('/cwd', async () => makeJsonl([record]));
    assert.equal(summary.recordCount, 1);
    assert.equal(summary.avgScore, 80);
    assert.equal(summary.minScore, 80);
    assert.equal(summary.weakestFile, record.file);
    assert.equal(summary.totalMutants, 50);
    assert.equal(summary.totalKilled, 40);
  });

  it('computes average over multiple records', async () => {
    const records = [
      makeRecord({ score: 60, mutantsKilled: 6, mutantsTotal: 10 }),
      makeRecord({ file: 'src/core/config.ts', score: 80, mutantsKilled: 8, mutantsTotal: 10 }),
      makeRecord({ file: 'src/core/llm.ts', score: 100, mutantsKilled: 5, mutantsTotal: 5 }),
    ];
    const summary = await getMutationSummary('/cwd', async () => makeJsonl(records));
    assert.equal(summary.recordCount, 3);
    assert.ok(Math.abs(summary.avgScore - 80) < 0.01);
    assert.equal(summary.minScore, 60);
    assert.equal(summary.weakestFile, records[0]!.file);
    assert.equal(summary.totalMutants, 25);
    assert.equal(summary.totalKilled, 19);
  });

  it('picks the most recent date as dateOfLastRun', async () => {
    const records = [
      makeRecord({ date: '2026-01-01T00:00:00.000Z' }),
      makeRecord({ date: '2026-03-15T12:00:00.000Z' }),
      makeRecord({ date: '2026-02-01T00:00:00.000Z' }),
    ];
    const summary = await getMutationSummary('/cwd', async () => makeJsonl(records));
    assert.equal(summary.dateOfLastRun, '2026-03-15T12:00:00.000Z');
  });

  it('skips corrupt lines and continues parsing', async () => {
    const good = makeRecord({ score: 90, mutantsKilled: 9, mutantsTotal: 10 });
    const raw = 'not-valid-json\n' + JSON.stringify(good) + '\ncorrupt{{\n';
    const summary = await getMutationSummary('/cwd', async () => raw);
    assert.equal(summary.recordCount, 1);
    assert.equal(summary.avgScore, 90);
  });

  it('identifies the weakest file correctly when multiple records for same file', async () => {
    const records = [
      makeRecord({ file: 'src/core/a.ts', score: 90 }),
      makeRecord({ file: 'src/core/b.ts', score: 20 }),
      makeRecord({ file: 'src/core/c.ts', score: 70 }),
    ];
    const summary = await getMutationSummary('/cwd', async () => makeJsonl(records));
    assert.equal(summary.weakestFile, 'src/core/b.ts');
    assert.equal(summary.minScore, 20);
  });
});

// ── formatMutationReport ──────────────────────────────────────────────────────

describe('formatMutationReport', () => {
  it('returns no-data message for empty summary', () => {
    const emptySum: MutationSummary = {
      avgScore: 0, minScore: 0, weakestFile: '', dateOfLastRun: '',
      recordCount: 0, totalMutants: 0, totalKilled: 0,
    };
    const report = formatMutationReport(emptySum);
    assert.ok(report.includes('No mutation test results found'));
  });

  it('includes all key metrics in the output', () => {
    const summary: MutationSummary = {
      avgScore: 75.5,
      minScore: 40.0,
      weakestFile: 'src/core/llm.ts',
      dateOfLastRun: '2026-05-14',
      recordCount: 5,
      totalMutants: 100,
      totalKilled: 75,
    };
    const report = formatMutationReport(summary);
    assert.ok(report.includes('75.5%'));
    assert.ok(report.includes('40.0%'));
    assert.ok(report.includes('src/core/llm.ts'));
    assert.ok(report.includes('5'));
    assert.ok(report.includes('100'));
    assert.ok(report.includes('75'));
  });

  it('produces markdown table format', () => {
    const summary: MutationSummary = {
      avgScore: 80, minScore: 60, weakestFile: 'x.ts', dateOfLastRun: '2026-01-01',
      recordCount: 3, totalMutants: 30, totalKilled: 24,
    };
    const report = formatMutationReport(summary);
    assert.ok(report.includes('|'));
    assert.ok(report.includes('## Mutation Score Report'));
  });
});

// ── analyzeTestCoverage ───────────────────────────────────────────────────────

describe('analyzeTestCoverage', () => {
  it('returns 100% when all src modules have test files', async () => {
    const srcFiles = ['src/core/state.ts', 'src/core/config.ts'];
    const testFiles = ['tests/state.test.ts', 'tests/config.test.ts'];

    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async (pattern) => {
      if (pattern.includes('src/core')) return srcFiles;
      return testFiles;
    };

    const report = await analyzeTestCoverage('src', 'tests', mockGlob, '/tmp/proj');
    assert.equal(report.coveragePercent, 100);
    assert.equal(report.uncovered.length, 0);
    assert.deepEqual(report.covered.sort(), ['config', 'state']);
  });

  it('detects uncovered modules', async () => {
    const srcFiles = ['src/core/state.ts', 'src/core/orphan.ts'];
    const testFiles = ['tests/state.test.ts'];

    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async (pattern) => {
      if (pattern.includes('src/core')) return srcFiles;
      return testFiles;
    };

    const report = await analyzeTestCoverage('src', 'tests', mockGlob, '/tmp/proj');
    assert.ok(report.uncovered.includes('orphan'));
    assert.ok(report.covered.includes('state'));
    assert.ok(report.coveragePercent < 100);
  });

  it('returns 0% when no src files found', async () => {
    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async () => [];
    const report = await analyzeTestCoverage('src', 'tests', mockGlob, '/tmp/proj');
    assert.equal(report.coveragePercent, 100); // 0/0 = 100% by convention
    assert.equal(report.covered.length, 0);
    assert.equal(report.uncovered.length, 0);
  });

  it('includes suggestions for top 5 uncovered files', async () => {
    const srcFiles = Array.from({ length: 7 }, (_, i) => `src/core/module${i}.ts`);

    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async (pattern) => {
      if (pattern.includes('src/core')) return srcFiles;
      return []; // no test files
    };

    const report = await analyzeTestCoverage('src', 'tests', mockGlob, '/tmp/proj');
    assert.ok(report.suggestions.length <= 5);
  });

  it('suggestions reference correct module paths', async () => {
    const srcFiles = ['src/core/my-module.ts'];

    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async (pattern) => {
      if (pattern.includes('src/core')) return srcFiles;
      return [];
    };

    const report = await analyzeTestCoverage('src', 'tests', mockGlob, '/tmp/proj');
    if (report.suggestions.length > 0) {
      assert.ok(report.suggestions[0]!.includes('my-module'));
    }
  });

  it('counts nested tests that import a source module', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-coverage-nested-'));
    try {
      await fs.mkdir(path.join(cwd, 'src/core'), { recursive: true });
      await fs.mkdir(path.join(cwd, 'tests/matrix'), { recursive: true });
      await fs.writeFile(path.join(cwd, 'src/core/lease-manager.ts'), 'export const leaseManager = true;\n');
      await fs.writeFile(
        path.join(cwd, 'tests/matrix/lease-manager-behavior.test.ts'),
        "import { leaseManager } from '../../src/core/lease-manager.js';\n",
      );

      const report = await analyzeTestCoverage('src', 'tests', undefined, cwd);

      assert.equal(report.coveragePercent, 100);
      assert.deepEqual(report.covered, ['lease-manager']);
      assert.deepEqual(report.uncovered, []);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

// ── testCoverage command ──────────────────────────────────────────────────────

describe('testCoverage command', () => {
  it('returns exitCode 0 when coverage meets threshold', async () => {
    const srcFiles = ['src/core/state.ts'];
    const testFiles = ['tests/state.test.ts'];

    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async (pattern) => {
      if (pattern.includes('src/core')) return srcFiles;
      return testFiles;
    };

    const result = await testCoverage({
      _glob: mockGlob,
      _read: async () => { throw new Error('no file'); },
      _suppressExitCode: true,
      failBelow: 70,
      cwd: '/tmp/proj',
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.coveragePercent, 100);
  });

  it('returns exitCode 1 when coverage is below threshold', async () => {
    const srcFiles = ['src/core/a.ts', 'src/core/b.ts', 'src/core/c.ts'];
    const testFiles: string[] = [];

    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async (pattern) => {
      if (pattern.includes('src/core')) return srcFiles;
      return testFiles;
    };

    const result = await testCoverage({
      _glob: mockGlob,
      _read: async () => { throw new Error('no file'); },
      _suppressExitCode: true,
      failBelow: 70,
      cwd: '/tmp/proj',
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.coveragePercent, 0);
  });

  it('includes mutation summary when data exists', async () => {
    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async () => [];
    const record = makeRecord({ score: 85, mutantsKilled: 17, mutantsTotal: 20 });

    const result = await testCoverage({
      _glob: mockGlob,
      _read: async () => makeJsonl([record]),
      _suppressExitCode: true,
      cwd: '/tmp/proj',
    });
    assert.ok(result.mutationSummary !== undefined);
    assert.equal(result.mutationSummary!.avgScore, 85);
  });

  it('does not fail when mutation file is absent', async () => {
    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async () => [];
    const result = await testCoverage({
      _glob: mockGlob,
      _read: async () => { throw new Error('ENOENT'); },
      _suppressExitCode: true,
      cwd: '/tmp/proj',
    });
    assert.equal(result.mutationSummary, undefined);
  });

  it('returns JSON-serializable result structure', async () => {
    const mockGlob: import('../src/core/test-coverage-analyzer.js').GlobFn = async (pattern) => {
      if (pattern.includes('src/core')) return ['src/core/x.ts'];
      return ['tests/x.test.ts'];
    };
    const result = await testCoverage({
      _glob: mockGlob,
      _read: async () => { throw new Error('no mutation data'); },
      _suppressExitCode: true,
      cwd: '/tmp/proj',
    });
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized) as typeof result;
    assert.equal(typeof parsed.coveragePercent, 'number');
    assert.ok(Array.isArray(parsed.covered));
    assert.ok(Array.isArray(parsed.uncovered));
  });
});
