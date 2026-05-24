import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { fetchLinkedIssueContext } from '../src/core/autoforge-issue-context.js';
import {
  countLines,
  countJsDocCoverage,
  countAnyUsage,
  countTodos,
  computeFileScore,
  collectWarnings,
  analyzeFile,
  batchCheck,
  type FileCheckResult,
} from '../src/cli/commands/batch-check.js';
import {
  runPipeline,
  PIPELINE_STAGES,
  type StageResult,
} from '../src/cli/commands/run-pipeline.js';
import { exportState, type ExportBundle } from '../src/cli/commands/export.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'df-func-test-'));
}

// ---------------------------------------------------------------------------
// 1. fetchLinkedIssueContext
// ---------------------------------------------------------------------------

describe('fetchLinkedIssueContext', () => {
  it('returns empty string when git has no issue refs', async () => {
    const mockExec = async (_cmd: string, _opts: { cwd: string }) => ({
      stdout: 'abc123 fix bug\ndef456 chore: update deps',
      stderr: '',
    });
    const result = await fetchLinkedIssueContext('/tmp/test', mockExec);
    assert.strictEqual(result, '');
  });

  it('extracts single issue reference from git log', async () => {
    const mockExec = async (_cmd: string, _opts: { cwd: string }) => ({
      stdout: 'abc123 fix bug (#42)\ndef456 chore: update deps',
      stderr: '',
    });
    const result = await fetchLinkedIssueContext('/tmp/test', mockExec);
    assert.ok(result.includes('#42'), `Expected #42 in: ${result}`);
  });

  it('extracts multiple unique issue references', async () => {
    const mockExec = async (_cmd: string, _opts: { cwd: string }) => ({
      stdout: 'abc123 fix #7\ndef456 close #7\nghi789 refs #99',
      stderr: '',
    });
    const result = await fetchLinkedIssueContext('/tmp/test', mockExec);
    assert.ok(result.includes('#7'), `Expected #7 in: ${result}`);
    assert.ok(result.includes('#99'), `Expected #99 in: ${result}`);
    // #7 should appear only once
    const count7 = (result.match(/#7\b/g) ?? []).length;
    assert.strictEqual(count7, 1, 'Should deduplicate #7');
  });

  it('handles git exec failure gracefully', async () => {
    const mockExec = async (_cmd: string, _opts: { cwd: string }) => {
      throw new Error('not a git repo');
    };
    const result = await fetchLinkedIssueContext('/tmp/test', mockExec);
    assert.strictEqual(result, '');
  });

  it('reads local issue template files when they exist', async () => {
    const cwd = await makeTmpDir();
    const templateDir = path.join(cwd, '.github', 'ISSUE_TEMPLATE');
    await fs.mkdir(templateDir, { recursive: true });
    await fs.writeFile(
      path.join(templateDir, 'bug_report.md'),
      '---\nname: Bug Report\n---\n## Describe the bug',
    );
    const mockExec = async () => ({ stdout: '', stderr: '' });
    const result = await fetchLinkedIssueContext(cwd, mockExec);
    assert.ok(result.includes('bug_report.md'), `Expected template name in: ${result}`);
    await fs.rm(cwd, { recursive: true });
  });

  it('returns empty string when no issue refs and no templates exist', async () => {
    const cwd = await makeTmpDir();
    const mockExec = async () => ({ stdout: '', stderr: '' });
    const result = await fetchLinkedIssueContext(cwd, mockExec);
    assert.strictEqual(result, '');
    await fs.rm(cwd, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// 2. batch-check helpers
// ---------------------------------------------------------------------------

describe('countLines', () => {
  it('counts total, blank, and non-blank lines', () => {
    const content = 'line1\n\nline3\n  \nline5';
    const { lines, blankLines, nonBlankLines } = countLines(content);
    assert.strictEqual(lines, 5);
    assert.strictEqual(blankLines, 2);
    assert.strictEqual(nonBlankLines, 3);
  });

  it('handles empty content', () => {
    const { lines, blankLines, nonBlankLines } = countLines('');
    assert.strictEqual(lines, 1);
    assert.strictEqual(blankLines, 1);
    assert.strictEqual(nonBlankLines, 0);
  });
});

describe('countJsDocCoverage', () => {
  it('detects exported function with JSDoc', () => {
    const content = `
/**
 * Does something useful.
 */
export function doSomething(): void {}
`;
    const { jsdocFunctions, totalExportedFunctions } = countJsDocCoverage(content);
    assert.strictEqual(totalExportedFunctions, 1);
    assert.strictEqual(jsdocFunctions, 1);
  });

  it('detects exported function without JSDoc', () => {
    const content = `
export function noDoc(): void {}
`;
    const { jsdocFunctions, totalExportedFunctions } = countJsDocCoverage(content);
    assert.strictEqual(totalExportedFunctions, 1);
    assert.strictEqual(jsdocFunctions, 0);
  });

  it('handles file with no exported functions', () => {
    const content = `const x = 1;\nfunction internal() {}\n`;
    const { totalExportedFunctions } = countJsDocCoverage(content);
    assert.strictEqual(totalExportedFunctions, 0);
  });
});

describe('countAnyUsage', () => {
  it('counts as any occurrences', () => {
    const content = `const x = val as any;\nconst y = other as any;\nconst z = fine;`;
    assert.strictEqual(countAnyUsage(content), 2);
  });

  it('returns 0 for clean content', () => {
    assert.strictEqual(countAnyUsage('const x: string = "hello";'), 0);
  });
});

describe('countTodos', () => {
  it('counts TODO and FIXME comments', () => {
    const content = `// TODO: fix this\n// FIXME: broken\n// NOTE: fine`;
    assert.strictEqual(countTodos(content), 2);
  });

  it('is case-insensitive', () => {
    const content = `// todo: something\n// fixme: something else`;
    assert.strictEqual(countTodos(content), 2);
  });
});

describe('computeFileScore', () => {
  it('returns 10 for a clean, small file', () => {
    const partial = {
      file: 'test.ts', lines: 50, blankLines: 5, nonBlankLines: 45,
      jsdocFunctions: 3, totalExportedFunctions: 3, jsdocPercent: 100,
      anyCount: 0, todoCount: 0,
    };
    assert.strictEqual(computeFileScore(partial), 10);
  });

  it('deducts for files over 500 non-blank LOC', () => {
    const partial = {
      file: 'test.ts', lines: 600, blankLines: 50, nonBlankLines: 550,
      jsdocFunctions: 5, totalExportedFunctions: 5, jsdocPercent: 100,
      anyCount: 0, todoCount: 0,
    };
    const score = computeFileScore(partial);
    assert.ok(score < 10, `Expected score < 10, got ${score}`);
  });

  it('deducts for any-type usage', () => {
    const partial = {
      file: 'test.ts', lines: 50, blankLines: 5, nonBlankLines: 45,
      jsdocFunctions: 2, totalExportedFunctions: 2, jsdocPercent: 100,
      anyCount: 4, todoCount: 0,
    };
    const score = computeFileScore(partial);
    assert.ok(score < 10, `Expected score < 10, got ${score}`);
  });

  it('deducts for low JSDoc coverage', () => {
    const partial = {
      file: 'test.ts', lines: 50, blankLines: 5, nonBlankLines: 45,
      jsdocFunctions: 0, totalExportedFunctions: 10, jsdocPercent: 0,
      anyCount: 0, todoCount: 0,
    };
    const score = computeFileScore(partial);
    assert.ok(score <= 8, `Expected score <= 8 for 0% JSDoc, got ${score}`);
  });
});

describe('analyzeFile', () => {
  it('analyzes a real TypeScript file content', async () => {
    const content = `
/**
 * Example function.
 */
export function hello(): string {
  return 'world';
}
export function noDoc(): void {} // no JSDoc
const x = val as any;
// TODO: clean this up
`;
    const fakeRead = async (_p: string) => content;
    const result = await analyzeFile('/fake/path.ts', fakeRead);
    assert.strictEqual(result.file, '/fake/path.ts');
    assert.ok(result.anyCount >= 1, 'Should detect as any');
    assert.ok(result.todoCount >= 1, 'Should detect TODO');
    assert.ok(result.score >= 0 && result.score <= 10, 'Score in range');
  });
});

describe('batchCheck', () => {
  it('returns passed=true when all files meet min-score threshold', async () => {
    const cleanContent = `
/**
 * Clean function.
 */
export function clean(): void {}
`;
    const fakeGlob = async () => ['/fake/a.ts', '/fake/b.ts'];
    const fakeRead = async (_p: string) => cleanContent;
    const result = await batchCheck({
      minScore: 5,
      _glob: fakeGlob,
      _readFile: fakeRead,
      json: false,
    });
    assert.ok(result.passed, 'Should pass when all files score >= 5');
  });

  it('returns passed=false when a file is below min-score', async () => {
    const badContent = `
export function bad(): void {}
const a = x as any;
const b = y as any;
const c = z as any;
const d = w as any;
const e = v as any;
const f = u as any;
// TODO: fix
// FIXME: also broken
`;
    const fakeGlob = async () => ['/fake/bad.ts'];
    const fakeRead = async (_p: string) => badContent;
    const result = await batchCheck({
      minScore: 9,
      _glob: fakeGlob,
      _readFile: fakeRead,
      json: false,
    });
    assert.ok(!result.passed, 'Should fail when file scores below min-score');
  });

  it('reports correct file count in summary', async () => {
    const fakeGlob = async () => ['/fake/a.ts', '/fake/b.ts', '/fake/c.ts'];
    const fakeRead = async () => 'export function f(): void {}';
    const result = await batchCheck({ _glob: fakeGlob, _readFile: fakeRead, json: false });
    assert.strictEqual(result.summary.total, 3);
  });

  it('handles file read errors gracefully', async () => {
    const fakeGlob = async () => ['/fake/error.ts'];
    const fakeRead = async (_p: string) => { throw new Error('permission denied'); };
    const result = await batchCheck({ _glob: fakeGlob, _readFile: fakeRead, json: false });
    assert.strictEqual(result.files.length, 1);
    assert.ok(result.files[0].warnings.some(w => w.includes('Read error')));
  });
});

// ---------------------------------------------------------------------------
// 3. run-pipeline
// ---------------------------------------------------------------------------

describe('runPipeline', () => {
  it('has all expected pipeline stages', () => {
    assert.deepEqual(PIPELINE_STAGES, ['specify', 'clarify', 'plan', 'tasks', 'forge', 'verify']);
  });

  it('sequences all stages and returns completed list', async () => {
    const executed: string[] = [];
    const fakeStageRunner = async (stage: string): Promise<StageResult> => {
      executed.push(stage);
      return { stage, success: true, durationMs: 1 };
    };
    const result = await runPipeline({
      yes: true,
      _runStage: fakeStageRunner,
    });
    assert.deepEqual(result.stagesCompleted, [...PIPELINE_STAGES]);
    assert.deepEqual(result.stagesFailed, []);
    assert.deepEqual(executed, [...PIPELINE_STAGES]);
  });

  it('halts on first failing stage', async () => {
    const fakeStageRunner = async (stage: string): Promise<StageResult> => {
      if (stage === 'plan') {
        return { stage, success: false, durationMs: 1, error: 'LLM timeout' };
      }
      return { stage, success: true, durationMs: 1 };
    };
    const result = await runPipeline({ yes: true, _runStage: fakeStageRunner });
    assert.ok(result.stagesFailed.includes('plan'));
    // stages after plan should not have been run
    assert.ok(!result.stagesCompleted.includes('tasks'));
    assert.ok(!result.stagesCompleted.includes('forge'));
  });

  it('respects --yes to skip prompts', async () => {
    const promptCalled: string[] = [];
    const fakePrompt = async (msg: string): Promise<boolean> => {
      promptCalled.push(msg);
      return true;
    };
    const fakeStageRunner = async (stage: string): Promise<StageResult> => ({
      stage, success: true, durationMs: 1,
    });
    await runPipeline({ yes: true, _runStage: fakeStageRunner, _prompt: fakePrompt });
    assert.strictEqual(promptCalled.length, 0, 'Should not call prompt when --yes is set');
  });

  it('calls prompt for each stage when --yes is not set', async () => {
    const promptCalled: string[] = [];
    const fakePrompt = async (msg: string): Promise<boolean> => {
      promptCalled.push(msg);
      return true;
    };
    const fakeStageRunner = async (stage: string): Promise<StageResult> => ({
      stage, success: true, durationMs: 1,
    });
    await runPipeline({ yes: false, _runStage: fakeStageRunner, _prompt: fakePrompt });
    assert.strictEqual(promptCalled.length, PIPELINE_STAGES.length);
  });

  it('includes totalDurationMs in result', async () => {
    const fakeStageRunner = async (stage: string): Promise<StageResult> => ({
      stage, success: true, durationMs: 10,
    });
    const result = await runPipeline({ yes: true, _runStage: fakeStageRunner });
    assert.ok(result.totalDurationMs >= 0, 'totalDurationMs should be a non-negative number');
  });

  it('includes summary string in result', async () => {
    const fakeStageRunner = async (stage: string): Promise<StageResult> => ({
      stage, success: true, durationMs: 1,
    });
    const result = await runPipeline({ yes: true, _runStage: fakeStageRunner });
    assert.ok(typeof result.summary === 'string' && result.summary.length > 0);
  });
});

// ---------------------------------------------------------------------------
// 4. export command
// ---------------------------------------------------------------------------

describe('exportState', () => {
  it('writes a JSON bundle to the output path', async () => {
    const cwd = await makeTmpDir();
    const danteDir = path.join(cwd, '.danteforge');
    await fs.mkdir(danteDir, { recursive: true });
    const statePath = path.join(danteDir, 'STATE.yaml');
    await fs.writeFile(statePath, 'project: TestProject\nworkflowStage: forge\n');

    const written: Record<string, string> = {};
    const fakeWrite = async (p: string, c: string) => { written[p] = c; };

    const outputPath = path.join(danteDir, 'test-export.json');
    const result = await exportState({
      cwd,
      output: outputPath,
      _writeFile: fakeWrite,
    });

    assert.strictEqual(result.outputPath, outputPath);
    assert.ok(written[outputPath], 'Should have written output file');
    const bundle: ExportBundle = JSON.parse(written[outputPath]);
    assert.strictEqual(bundle.version, '1.0');
    assert.ok(bundle.exportedAt, 'Should have exportedAt timestamp');

    await fs.rm(cwd, { recursive: true });
  });

  it('includes STATE.yaml content in the bundle', async () => {
    const cwd = await makeTmpDir();
    const danteDir = path.join(cwd, '.danteforge');
    await fs.mkdir(danteDir, { recursive: true });
    const stateContent = 'project: MyProject\nworkflowStage: verify\n';
    await fs.writeFile(path.join(danteDir, 'STATE.yaml'), stateContent);

    const written: Record<string, string> = {};
    const outputPath = path.join(danteDir, 'out.json');

    await exportState({ cwd, output: outputPath, _writeFile: async (p, c) => { written[p] = c; } });
    const bundle: ExportBundle = JSON.parse(written[outputPath]);
    assert.strictEqual(bundle.files['STATE.yaml'], stateContent);

    await fs.rm(cwd, { recursive: true });
  });

  it('reports excluded files when STATE.yaml is missing', async () => {
    const cwd = await makeTmpDir();

    const written: Record<string, string> = {};
    const outputPath = path.join(cwd, 'out.json');

    const result = await exportState({ cwd, output: outputPath, _writeFile: async (p, c) => { written[p] = c; } });
    assert.ok(result.excludedFiles.includes('STATE.yaml'), 'Should exclude missing STATE.yaml');

    await fs.rm(cwd, { recursive: true });
  });

  it('extracts project name from STATE.yaml', async () => {
    const cwd = await makeTmpDir();
    const danteDir = path.join(cwd, '.danteforge');
    await fs.mkdir(danteDir, { recursive: true });
    await fs.writeFile(path.join(danteDir, 'STATE.yaml'), 'project: SuperProject\nworkflowStage: forge\n');

    const written: Record<string, string> = {};
    await exportState({ cwd, output: path.join(danteDir, 'out.json'), _writeFile: async (p, c) => { written[p] = c; } });
    const bundle: ExportBundle = JSON.parse(written[path.join(danteDir, 'out.json')]);
    assert.strictEqual(bundle.project, 'SuperProject');

    await fs.rm(cwd, { recursive: true });
  });

  it('uses cwd basename as project name when STATE.yaml has no project field', async () => {
    const cwd = await makeTmpDir();
    const danteDir = path.join(cwd, '.danteforge');
    await fs.mkdir(danteDir, { recursive: true });
    await fs.writeFile(path.join(danteDir, 'STATE.yaml'), 'workflowStage: forge\n');

    const written: Record<string, string> = {};
    await exportState({ cwd, output: path.join(danteDir, 'out.json'), _writeFile: async (p, c) => { written[p] = c; } });
    const bundle: ExportBundle = JSON.parse(written[path.join(danteDir, 'out.json')]);
    assert.ok(bundle.project.length > 0, 'Should have a non-empty project name');

    await fs.rm(cwd, { recursive: true });
  });

  it('includes snapshots when --include-history is set', async () => {
    const cwd = await makeTmpDir();
    const danteDir = path.join(cwd, '.danteforge');
    const snapshotDir = path.join(danteDir, 'snapshots');
    await fs.mkdir(snapshotDir, { recursive: true });
    await fs.writeFile(path.join(snapshotDir, '2026-01-01-STATE.yaml'), 'snap1');
    await fs.writeFile(path.join(snapshotDir, '2026-01-02-STATE.yaml'), 'snap2');

    const written: Record<string, string> = {};
    await exportState({
      cwd,
      output: path.join(danteDir, 'out.json'),
      includeHistory: true,
      _writeFile: async (p, c) => { written[p] = c; },
    });
    const bundle: ExportBundle = JSON.parse(written[path.join(danteDir, 'out.json')]);
    assert.ok(bundle.snapshots.length > 0, 'Should include snapshots');

    await fs.rm(cwd, { recursive: true });
  });

  it('does not include snapshots when --include-history is not set', async () => {
    const cwd = await makeTmpDir();
    const danteDir = path.join(cwd, '.danteforge');
    const snapshotDir = path.join(danteDir, 'snapshots');
    await fs.mkdir(snapshotDir, { recursive: true });
    await fs.writeFile(path.join(snapshotDir, 'snap.yaml'), 'data');

    const written: Record<string, string> = {};
    await exportState({
      cwd,
      output: path.join(danteDir, 'out.json'),
      includeHistory: false,
      _writeFile: async (p, c) => { written[p] = c; },
    });
    const bundle: ExportBundle = JSON.parse(written[path.join(danteDir, 'out.json')]);
    assert.strictEqual(bundle.snapshots.length, 0);

    await fs.rm(cwd, { recursive: true });
  });

  it('returns a result with includedFiles and excludedFiles arrays', async () => {
    const cwd = await makeTmpDir();
    const result = await exportState({
      cwd,
      output: path.join(cwd, 'out.json'),
      _writeFile: async () => {},
    });
    assert.ok(Array.isArray(result.includedFiles));
    assert.ok(Array.isArray(result.excludedFiles));

    await fs.rm(cwd, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// 5. collectWarnings integration
// ---------------------------------------------------------------------------

describe('collectWarnings', () => {
  it('emits warning for files over 500 LOC', () => {
    const partial = {
      file: 'f.ts', lines: 600, blankLines: 50, nonBlankLines: 550,
      jsdocFunctions: 5, totalExportedFunctions: 5, jsdocPercent: 100,
      anyCount: 0, todoCount: 0,
    };
    const warnings = collectWarnings(partial);
    assert.ok(warnings.some(w => w.includes('500')));
  });

  it('emits warning for low JSDoc coverage', () => {
    const partial = {
      file: 'f.ts', lines: 100, blankLines: 10, nonBlankLines: 90,
      jsdocFunctions: 1, totalExportedFunctions: 10, jsdocPercent: 10,
      anyCount: 0, todoCount: 0,
    };
    const warnings = collectWarnings(partial);
    assert.ok(warnings.some(w => w.toLowerCase().includes('jsdoc')));
  });

  it('emits no warnings for a clean file', () => {
    const partial = {
      file: 'f.ts', lines: 100, blankLines: 10, nonBlankLines: 90,
      jsdocFunctions: 5, totalExportedFunctions: 5, jsdocPercent: 100,
      anyCount: 0, todoCount: 0,
    };
    assert.strictEqual(collectWarnings(partial).length, 0);
  });
});
