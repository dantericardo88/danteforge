// maintainability.test.ts — Tests for complexity analysis, shared options, and scoring
import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import {
  analyzeFileComplexity,
  analyzeProjectComplexity,
  type FileComplexityReport,
  type ProjectComplexityReport,
} from '../src/core/complexity-analyzer.js';
import {
  cwdOption,
  jsonOption,
  yesOption,
  quietOption,
  addCwdOption,
  addJsonOption,
} from '../src/cli/shared-options.js';
import {
  scoreMaintainability,
  scoreMaintainabilityFull,
} from '../src/core/score-maintainability.js';
import { complexity } from '../src/cli/commands/complexity.js';

// ── Sample source content ─────────────────────────────────────────────────────

const SIMPLE_FILE = `
// simple file
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`;

const COMPLEX_FILE = `
export function complexFn(x: number, y: number): number {
  if (x > 0) {
    if (y > 0) {
      return x + y;
    } else {
      return x - y;
    }
  } else if (x < 0) {
    for (let i = 0; i < y; i++) {
      if (i % 2 === 0) {
        x += i;
      }
    }
    return x;
  } else {
    while (y > 0) {
      y--;
    }
    return y;
  }
}

export function helper(items: string[]): string[] {
  return items.filter(i => i && i.length > 0).map(i => i.trim());
}
`;

const LARGE_FILE_TEMPLATE = (count: number) =>
  Array.from({ length: count }, (_, i) => `const x${i} = ${i};`).join('\n');

// ── analyzeFileComplexity tests ───────────────────────────────────────────────

describe('analyzeFileComplexity', () => {
  it('returns correct totalLines for simple content', () => {
    const report = analyzeFileComplexity('test.ts', SIMPLE_FILE);
    assert.ok(report.totalLines > 0);
  });

  it('counts non-blank lines correctly', () => {
    const content = 'const a = 1;\n\nconst b = 2;\n';
    const report = analyzeFileComplexity('test.ts', content);
    assert.strictEqual(report.nonBlankLines, 2);
  });

  it('detects function count in simple file', () => {
    const report = analyzeFileComplexity('test.ts', SIMPLE_FILE);
    assert.ok(report.functionCount >= 2, `Expected >= 2 functions, got ${report.functionCount}`);
  });

  it('returns exceedsLocLimit false for small files', () => {
    const report = analyzeFileComplexity('test.ts', SIMPLE_FILE);
    assert.strictEqual(report.exceedsLocLimit, false);
  });

  it('returns exceedsLocLimit true for large files', () => {
    const bigContent = LARGE_FILE_TEMPLATE(600);
    const report = analyzeFileComplexity('big.ts', bigContent);
    assert.strictEqual(report.exceedsLocLimit, true);
  });

  it('detects higher cyclomatic complexity for complex function', () => {
    const report = analyzeFileComplexity('complex.ts', COMPLEX_FILE);
    assert.ok(report.maxCyclomaticComplexity > 1, `Expected > 1, got ${report.maxCyclomaticComplexity}`);
  });

  it('computes a complexityScore > 0', () => {
    const report = analyzeFileComplexity('test.ts', SIMPLE_FILE);
    assert.ok(report.complexityScore > 0);
  });

  it('returns functions array with at least one entry for simple file', () => {
    const report = analyzeFileComplexity('test.ts', SIMPLE_FILE);
    assert.ok(report.functions.length >= 1);
  });

  it('function entries include name, startLine, loc, cyclomaticComplexity', () => {
    const report = analyzeFileComplexity('test.ts', SIMPLE_FILE);
    const fn = report.functions[0];
    assert.ok(typeof fn.name === 'string');
    assert.ok(typeof fn.startLine === 'number');
    assert.ok(typeof fn.loc === 'number');
    assert.ok(typeof fn.cyclomaticComplexity === 'number');
  });

  it('avgFunctionLength is positive for non-empty file', () => {
    const report = analyzeFileComplexity('test.ts', SIMPLE_FILE);
    if (report.functionCount > 0) {
      assert.ok(report.avgFunctionLength > 0);
    }
  });
});

// ── analyzeProjectComplexity tests ────────────────────────────────────────────

describe('analyzeProjectComplexity', () => {
  it('returns empty report when no files found', async () => {
    const mockGlob = async () => [];
    const mockRead = async () => '';
    const report = await analyzeProjectComplexity('/fake/src', mockRead as never, mockGlob);
    assert.strictEqual(report.fileCount, 0);
    assert.strictEqual(report.totalLines, 0);
  });

  it('counts files correctly', async () => {
    const files = ['a.ts', 'b.ts'];
    const mockGlob = async () => files;
    const mockRead = async () => SIMPLE_FILE;
    const report = await analyzeProjectComplexity('/fake/src', mockRead as never, mockGlob);
    assert.strictEqual(report.fileCount, 2);
  });

  it('identifies files exceeding LOC limit', async () => {
    const bigContent = LARGE_FILE_TEMPLATE(600);
    const mockGlob = async () => ['big.ts'];
    const mockRead = async () => bigContent;
    const report = await analyzeProjectComplexity('/fake/src', mockRead as never, mockGlob);
    assert.strictEqual(report.filesExceedingLocLimit.length, 1);
  });

  it('topComplexFiles has at most 10 entries', async () => {
    const files = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);
    const mockGlob = async () => files;
    const mockRead = async () => SIMPLE_FILE;
    const report = await analyzeProjectComplexity('/fake/src', mockRead as never, mockGlob);
    assert.ok(report.topComplexFiles.length <= 10);
  });

  it('returns functionsExceedingLocLimit for long functions', async () => {
    const longFn = `function bigFn() {\n${Array.from({ length: 60 }, (_, i) => `  const x${i} = ${i};`).join('\n')}\n}`;
    const mockGlob = async () => ['big.ts'];
    const mockRead = async () => longFn;
    const report = await analyzeProjectComplexity('/fake/src', mockRead as never, mockGlob);
    assert.ok(report.functionsExceedingLocLimit.length > 0);
  });

  it('computes avgComplexityScore when files exist', async () => {
    const mockGlob = async () => ['a.ts'];
    const mockRead = async () => SIMPLE_FILE;
    const report = await analyzeProjectComplexity('/fake/src', mockRead as never, mockGlob);
    assert.ok(report.avgComplexityScore >= 0);
  });

  it('files array is sorted by complexity descending', async () => {
    const mockGlob = async () => ['simple.ts', 'complex.ts'];
    const mockRead = async (_p: string, _enc: 'utf8') => {
      if (_p.includes('complex')) return COMPLEX_FILE;
      return SIMPLE_FILE;
    };
    const report = await analyzeProjectComplexity('/fake/src', mockRead as never, mockGlob);
    if (report.files.length >= 2) {
      assert.ok(report.files[0].complexityScore >= report.files[1].complexityScore);
    }
  });
});

// ── shared-options tests ──────────────────────────────────────────────────────

describe('shared-options descriptors', () => {
  it('cwdOption returns correct flags', () => {
    const opt = cwdOption();
    assert.strictEqual(opt.flags, '--cwd <path>');
  });

  it('cwdOption has a description', () => {
    const opt = cwdOption();
    assert.ok(opt.description.length > 0);
  });

  it('cwdOption has a default value', () => {
    const opt = cwdOption();
    assert.ok(typeof opt.defaultValue === 'string');
  });

  it('jsonOption returns correct flags', () => {
    const opt = jsonOption();
    assert.strictEqual(opt.flags, '--json');
  });

  it('yesOption returns correct flags', () => {
    const opt = yesOption();
    assert.ok(opt.flags.includes('--yes'));
  });

  it('quietOption returns correct flags', () => {
    const opt = quietOption();
    assert.strictEqual(opt.flags, '--quiet');
  });

  it('addCwdOption returns a Command object', () => {
    // Use a mock Commander Command
    const calls: string[] = [];
    const mockCmd = {
      option: (...args: string[]) => { calls.push(args[0]); return mockCmd; },
    };
    const result = addCwdOption(mockCmd as never);
    assert.ok(result === mockCmd);
    assert.ok(calls.some(c => c.includes('--cwd')));
  });

  it('addJsonOption returns a Command object', () => {
    const calls: string[] = [];
    const mockCmd = {
      option: (...args: string[]) => { calls.push(args[0]); return mockCmd; },
    };
    const result = addJsonOption(mockCmd as never);
    assert.ok(result === mockCmd);
    assert.ok(calls.some(c => c.includes('--json')));
  });
});

// ── scoreMaintainability tests ────────────────────────────────────────────────

describe('scoreMaintainability', () => {
  it('returns a number between 0 and 10 for clean project', async () => {
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 5,
      totalLines: 500,
      avgComplexityScore: 5.0,
      maxComplexityScore: 8.0,
      files: [],
      topComplexFiles: [],
      filesExceedingLocLimit: [],
      functionsExceedingLocLimit: [],
    });
    const mockFileExists = async () => false;
    const score = await scoreMaintainability('/fake', { _analyzeProject: mockAnalyze, _fileExists: mockFileExists });
    assert.ok(score >= 0 && score <= 10, `Score ${score} not in [0, 10]`);
  });

  it('applies penalties for files over LOC limit', async () => {
    const fakeFile: FileComplexityReport = {
      filePath: '/fake/src/big.ts',
      totalLines: 800,
      nonBlankLines: 600,
      functionCount: 10,
      avgFunctionLength: 60,
      maxFunctionLength: 100,
      avgCyclomaticComplexity: 5,
      maxCyclomaticComplexity: 10,
      complexityScore: 15,
      functions: [],
      exceedsLocLimit: true,
    };
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 1,
      totalLines: 800,
      avgComplexityScore: 15,
      maxComplexityScore: 15,
      files: [fakeFile],
      topComplexFiles: [fakeFile],
      filesExceedingLocLimit: [fakeFile],
      functionsExceedingLocLimit: [],
    });
    const mockFileExists = async () => false;
    const result = await scoreMaintainabilityFull('/fake', { _analyzeProject: mockAnalyze, _fileExists: mockFileExists });
    assert.ok(result.penalties.length > 0, 'Expected at least one penalty');
    assert.ok(result.score < 10, `Expected score < 10 with penalties, got ${result.score}`);
  });

  it('rewards presence of shared-options.ts', async () => {
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 1,
      totalLines: 100,
      avgComplexityScore: 3,
      maxComplexityScore: 3,
      files: [],
      topComplexFiles: [],
      filesExceedingLocLimit: [],
      functionsExceedingLocLimit: [],
    });
    const mockFileExists = async (p: string) => p.includes('shared-options');
    const result = await scoreMaintainabilityFull('/fake', { _analyzeProject: mockAnalyze, _fileExists: mockFileExists });
    assert.ok(result.rewards.some(r => r.reason.includes('shared-options')));
  });

  it('rewards presence of complexity.ts command', async () => {
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 1,
      totalLines: 100,
      avgComplexityScore: 3,
      maxComplexityScore: 3,
      files: [],
      topComplexFiles: [],
      filesExceedingLocLimit: [],
      functionsExceedingLocLimit: [],
    });
    const mockFileExists = async (p: string) => p.includes('complexity');
    const result = await scoreMaintainabilityFull('/fake', { _analyzeProject: mockAnalyze, _fileExists: mockFileExists });
    assert.ok(result.rewards.some(r => r.reason.includes('complexity')));
  });

  it('caps score at 10.0', async () => {
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 1,
      totalLines: 50,
      avgComplexityScore: 1,
      maxComplexityScore: 1,
      files: [],
      topComplexFiles: [],
      filesExceedingLocLimit: [],
      functionsExceedingLocLimit: [],
    });
    const mockFileExists = async () => true;
    const score = await scoreMaintainability('/fake', { _analyzeProject: mockAnalyze, _fileExists: mockFileExists });
    assert.ok(score <= 10.0, `Score ${score} should be <= 10`);
  });
});

// ── complexity command tests ──────────────────────────────────────────────────

describe('complexity command', () => {
  it('returns a result with report and threshold', async () => {
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 3,
      totalLines: 300,
      avgComplexityScore: 5,
      maxComplexityScore: 8,
      files: [],
      topComplexFiles: [],
      filesExceedingLocLimit: [],
      functionsExceedingLocLimit: [],
    });
    const lines: string[] = [];
    const result = await complexity({
      cwd: '/fake',
      threshold: 20,
      _analyzeProject: mockAnalyze,
      _stdout: (l) => lines.push(l),
    });
    assert.ok(result.report.fileCount === 3);
    assert.strictEqual(result.threshold, 20);
  });

  it('sets exceedsThreshold true when a file score is over threshold', async () => {
    const fakeFile: FileComplexityReport = {
      filePath: '/fake/src/heavy.ts',
      totalLines: 300,
      nonBlankLines: 250,
      functionCount: 20,
      avgFunctionLength: 40,
      maxFunctionLength: 80,
      avgCyclomaticComplexity: 8,
      maxCyclomaticComplexity: 15,
      complexityScore: 25,
      functions: [],
      exceedsLocLimit: false,
    };
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 1,
      totalLines: 300,
      avgComplexityScore: 25,
      maxComplexityScore: 25,
      files: [fakeFile],
      topComplexFiles: [fakeFile],
      filesExceedingLocLimit: [],
      functionsExceedingLocLimit: [],
    });
    let exitCodeSet: number | undefined;
    const result = await complexity({
      cwd: '/fake',
      threshold: 20,
      _analyzeProject: mockAnalyze,
      _stdout: () => undefined,
      _setExitCode: (code) => { exitCodeSet = code; },
    });
    assert.strictEqual(result.exceedsThreshold, true);
    assert.strictEqual(exitCodeSet, 1);
  });

  it('does not exceed threshold when all files under limit', async () => {
    const mockAnalyze = async (): Promise<ProjectComplexityReport> => ({
      srcDir: '/fake/src',
      fileCount: 2,
      totalLines: 100,
      avgComplexityScore: 5,
      maxComplexityScore: 10,
      files: [],
      topComplexFiles: [],
      filesExceedingLocLimit: [],
      functionsExceedingLocLimit: [],
    });
    const result = await complexity({
      cwd: '/fake',
      threshold: 20,
      _analyzeProject: mockAnalyze,
      _stdout: () => undefined,
    });
    assert.strictEqual(result.exceedsThreshold, false);
  });
});
