import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  measureOutputMetrics,
  formatBenchmarkReport,
  runLLMBenchmark,
  loadBenchmarkHistory,
  type BenchmarkTask,
  type BenchmarkResult,
  type BenchmarkMetrics,
} from '../src/core/llm-benchmark.js';

function makeTask(overrides: Partial<BenchmarkTask> = {}): BenchmarkTask {
  return {
    id: 'test-task',
    description: 'Implement a user authentication function',
    successCriteria: ['authentication', 'password'],
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<BenchmarkMetrics> = {}): BenchmarkMetrics {
  return {
    testLinesRatio: 0.2,
    errorHandlingRatio: 0.1,
    typeSafetyScore: 0.5,
    completenessScore: 0.8,
    docCoverageRatio: 0.15,
    ...overrides,
  };
}

function makeResult(): BenchmarkResult {
  const raw = makeMetrics();
  const danteforge = makeMetrics({ testLinesRatio: 0.4, completenessScore: 0.9 });
  return {
    task: makeTask(),
    raw: { name: 'raw', prompt: 'raw prompt', response: 'raw response', durationMs: 100, metrics: raw },
    danteforge: { name: 'danteforge', prompt: 'df prompt', response: 'df response', durationMs: 150, metrics: danteforge },
    improvement: {
      testLinesRatio: danteforge.testLinesRatio - raw.testLinesRatio,
      errorHandlingRatio: 0,
      typeSafetyScore: 0,
      completenessScore: danteforge.completenessScore - raw.completenessScore,
      docCoverageRatio: 0,
      overallDeltaPercent: 4.0,
    },
    verdict: 'moderate',
    savedAt: new Date().toISOString(),
  };
}

describe('measureOutputMetrics', () => {
  it('returns zeros for empty string', () => {
    const metrics = measureOutputMetrics('', makeTask({ successCriteria: ['something'] }));
    assert.equal(metrics.testLinesRatio, 0);
    assert.equal(metrics.errorHandlingRatio, 0);
    assert.equal(metrics.typeSafetyScore, 0);
    assert.equal(metrics.completenessScore, 0);
    assert.equal(metrics.docCoverageRatio, 0);
  });

  it('returns completenessScore=1.0 for empty with no criteria', () => {
    const metrics = measureOutputMetrics('', makeTask({ successCriteria: [] }));
    assert.equal(metrics.completenessScore, 1.0);
  });

  it('detects test lines (describe/it/expect/assert)', () => {
    const code = 'describe("suite", () => {\n  it("test", () => {\n    assert.ok(true);\n  });\n});';
    const metrics = measureOutputMetrics(code, makeTask({ successCriteria: [] }));
    assert.ok(metrics.testLinesRatio > 0, 'should detect test lines');
  });

  it('detects error handling lines (try/catch/throw)', () => {
    const code = 'try {\n  doSomething();\n} catch (err) {\n  throw new Error("failed");\n}';
    const metrics = measureOutputMetrics(code, makeTask({ successCriteria: [] }));
    assert.ok(metrics.errorHandlingRatio > 0);
  });

  it('detects TypeScript type annotations', () => {
    const code = 'function greet(name: string): void {\n  const x: number = 42;\n}';
    const metrics = measureOutputMetrics(code, makeTask({ successCriteria: [] }));
    assert.ok(metrics.typeSafetyScore > 0);
  });

  it('detects completeness from success criteria keywords', () => {
    const code = 'function authenticate(password: string) { return password === "secret"; }';
    const metrics = measureOutputMetrics(code, makeTask({ successCriteria: ['authentication', 'password'] }));
    assert.ok(metrics.completenessScore > 0);
  });

  it('returns 0 completenessScore when no criteria match', () => {
    const code = 'function foo() { return 42; }';
    const metrics = measureOutputMetrics(code, makeTask({ successCriteria: ['zebra', 'elephant'] }));
    assert.equal(metrics.completenessScore, 0);
  });

  it('detects doc coverage from comment lines', () => {
    const code = '// A helper function\n// Does authentication\nfunction authenticate() {}';
    const metrics = measureOutputMetrics(code, makeTask({ successCriteria: [] }));
    assert.ok(metrics.docCoverageRatio > 0);
  });

  it('all metrics are between 0 and 1', () => {
    const code = 'const x: number = 1;\ntry { foo(); } catch(e) { throw e; }\ndescribe("t", () => { it("x", () => assert.ok(true)); });';
    const metrics = measureOutputMetrics(code, makeTask({ successCriteria: ['foo'] }));
    for (const [key, val] of Object.entries(metrics)) {
      assert.ok(val >= 0 && val <= 1, `${key} should be 0-1, got ${val}`);
    }
  });
});

describe('formatBenchmarkReport', () => {
  it('includes task description in report', () => {
    const report = formatBenchmarkReport(makeResult());
    assert.ok(report.includes('user authentication'));
  });

  it('includes BEFORE and AFTER sections', () => {
    const report = formatBenchmarkReport(makeResult());
    assert.ok(report.includes('BEFORE'));
    assert.ok(report.includes('AFTER'));
    assert.ok(report.includes('IMPROVEMENT'));
  });

  it('includes verdict in uppercase', () => {
    const report = formatBenchmarkReport(makeResult());
    assert.ok(report.includes('MODERATE'));
  });

  it('includes savedAt timestamp', () => {
    const result = makeResult();
    const report = formatBenchmarkReport(result);
    assert.ok(report.includes('Saved:'));
  });

  it('includes all 5 metric labels', () => {
    const report = formatBenchmarkReport(makeResult());
    assert.ok(report.includes('Test coverage ratio'));
    assert.ok(report.includes('Error handling ratio'));
    assert.ok(report.includes('Type safety score'));
    assert.ok(report.includes('Completeness score'));
    assert.ok(report.includes('Doc coverage ratio'));
  });
});

describe('runLLMBenchmark', () => {
  it('returns BenchmarkResult with correct structure', async () => {
    const task = makeTask({ successCriteria: ['function'] });
    const result = await runLLMBenchmark(task, {
      _llmCaller: async () => 'function authenticate(password: string) { return password; }',
      _exists: async () => false,
      _writeFile: async () => {},
    });
    assert.equal(result.task.id, 'test-task');
    assert.ok(['significant', 'moderate', 'marginal', 'none'].includes(result.verdict));
    assert.ok(typeof result.improvement.overallDeltaPercent === 'number');
  });

  it('verdict is "none" when danteforge and raw produce similar output', async () => {
    const response = 'function foo() { return 42; }';
    const task = makeTask({ successCriteria: [] });
    const result = await runLLMBenchmark(task, {
      _llmCaller: async () => response,
      _exists: async () => false,
      _writeFile: async () => {},
    });
    assert.equal(result.verdict, 'none');
  });

  it('includes artifacts in danteforge prompt when files exist', async () => {
    let capturedPrompt = '';
    const task = makeTask({ successCriteria: [] });
    await runLLMBenchmark(task, {
      _llmCaller: async (prompt) => { capturedPrompt = prompt; return 'response'; },
      _exists: async (p) => p.includes('CONSTITUTION'),
      _readFile: async () => 'zero ambiguity',
      _writeFile: async () => {},
    });
    assert.ok(capturedPrompt.includes('CONSTITUTION'));
    assert.ok(capturedPrompt.includes('zero ambiguity'));
  });
});

describe('loadBenchmarkHistory', () => {
  it('returns empty array when file not found', async () => {
    const history = await loadBenchmarkHistory('/tmp/nonexistent', {
      _readFile: async () => { throw new Error('not found'); },
    });
    assert.deepEqual(history, []);
  });

  it('returns parsed history from valid JSON', async () => {
    const stored = [makeResult()];
    const history = await loadBenchmarkHistory('/tmp/test', {
      _readFile: async () => JSON.stringify(stored),
    });
    assert.equal(history.length, 1);
    assert.equal(history[0].task.id, 'test-task');
  });

  it('returns empty array for non-array JSON', async () => {
    const history = await loadBenchmarkHistory('/tmp/test', {
      _readFile: async () => JSON.stringify({ not: 'array' }),
    });
    assert.deepEqual(history, []);
  });
});
