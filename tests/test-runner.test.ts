import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  detectTestCommand,
  runProjectTests,
  runTypecheck,
  formatErrorsForLLM,
  type TestRunnerOptions,
  type TestRunResult,
} from '../src/core/test-runner.js';

// ── Injection helpers ─────────────────────────────────────────────────────────

function makeExec(
  exitCode: number,
  stdout: string,
  stderr = '',
): NonNullable<TestRunnerOptions['_exec']> {
  return async () => ({ exitCode, stdout, stderr });
}

function makePkgJson(testScript?: string): NonNullable<TestRunnerOptions['_readFile']> {
  return async () => JSON.stringify({ scripts: testScript ? { test: testScript } : {} });
}

function makeResult(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    passed: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 0,
    failingTests: [],
    typecheckErrors: [],
    ...overrides,
  };
}

// Track what the exec fn was called with
function makeCapturingExec(
  exitCode: number,
  stdout: string,
  stderr = '',
): { exec: NonNullable<TestRunnerOptions['_exec']>; calls: Array<{ cmd: string; cwd: string; timeout: number }> } {
  const calls: Array<{ cmd: string; cwd: string; timeout: number }> = [];
  const exec: NonNullable<TestRunnerOptions['_exec']> = async (cmd, opts) => {
    calls.push({ cmd, cwd: opts.cwd, timeout: opts.timeout });
    return { exitCode, stdout, stderr };
  };
  return { exec, calls };
}

// ── describe: detectTestCommand ───────────────────────────────────────────────

describe('detectTestCommand', () => {
  it('returns scripts.test when package.json has it', async () => {
    const cmd = await detectTestCommand('/fake/cwd', { _readFile: makePkgJson('tsx --test') });
    assert.equal(cmd, 'tsx --test');
  });

  it('returns npm test when package.json has no scripts.test', async () => {
    const cmd = await detectTestCommand('/fake/cwd', { _readFile: makePkgJson() });
    assert.equal(cmd, 'npm test');
  });

  it('returns npm test when _readFile throws (file not found)', async () => {
    const cmd = await detectTestCommand('/fake/cwd', {
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(cmd, 'npm test');
  });

  it('returns npm test when package.json is malformed JSON', async () => {
    const cmd = await detectTestCommand('/fake/cwd', {
      _readFile: async () => '{ not valid json }',
    });
    assert.equal(cmd, 'npm test');
  });
});

// ── describe: runProjectTests ─────────────────────────────────────────────────

describe('runProjectTests', () => {
  it('passed is true when exitCode is 0', async () => {
    const result = await runProjectTests({
      cwd: '/fake',
      _exec: makeExec(0, 'All tests pass'),
      _readFile: makePkgJson('npm test'),
    });
    assert.equal(result.passed, true);
    assert.equal(result.exitCode, 0);
  });

  it('passed is false and failingTests populated from TAP output', async () => {
    const stdout = 'not ok 1 myTest\nnot ok 2 otherTest\n';
    const result = await runProjectTests({
      cwd: '/fake',
      _exec: makeExec(1, stdout),
      _readFile: makePkgJson('npm test'),
    });
    assert.equal(result.passed, false);
    assert.ok(result.failingTests.includes('myTest'), `expected 'myTest' in ${JSON.stringify(result.failingTests)}`);
  });

  it('_exec injection is used when provided', async () => {
    const { exec, calls } = makeCapturingExec(0, 'ok');
    await runProjectTests({
      cwd: '/my/project',
      _exec: exec,
      _readFile: makePkgJson('npm test'),
    });
    assert.equal(calls.length, 1);
  });

  it('timeout is passed through to exec call', async () => {
    const { exec, calls } = makeCapturingExec(0, 'ok');
    await runProjectTests({
      cwd: '/fake',
      timeout: 99_000,
      _exec: exec,
      _readFile: makePkgJson('npm test'),
    });
    assert.equal(calls[0]?.timeout, 99_000);
  });

  it('Jest-style bullet failure is extracted into failingTests', async () => {
    const stdout = '● myJestTest\n● anotherFailure\n';
    const result = await runProjectTests({
      cwd: '/fake',
      _exec: makeExec(1, stdout),
      _readFile: makePkgJson('jest'),
    });
    assert.ok(result.failingTests.includes('myJestTest'), `expected 'myJestTest' in ${JSON.stringify(result.failingTests)}`);
  });

  it('typecheckErrors is always empty in runProjectTests', async () => {
    const result = await runProjectTests({
      cwd: '/fake',
      _exec: makeExec(1, 'error TS2322: Type mismatch'),
      _readFile: makePkgJson('npm test'),
    });
    assert.deepEqual(result.typecheckErrors, []);
  });

  it('durationMs is a non-negative number', async () => {
    const result = await runProjectTests({
      cwd: '/fake',
      _exec: makeExec(0, ''),
      _readFile: makePkgJson(),
    });
    assert.ok(result.durationMs >= 0, `durationMs should be >= 0, got ${result.durationMs}`);
  });
});

// ── describe: runTypecheck ────────────────────────────────────────────────────

describe('runTypecheck', () => {
  it('passed is true and typecheckErrors is empty when exitCode is 0', async () => {
    const result = await runTypecheck({
      cwd: '/fake',
      _exec: makeExec(0, ''),
    });
    assert.equal(result.passed, true);
    assert.deepEqual(result.typecheckErrors, []);
  });

  it('typecheckErrors contains tsc error line on failure', async () => {
    const stderr = 'src/foo.ts(10,5): error TS2322: Type string is not assignable to number\n';
    const result = await runTypecheck({
      cwd: '/fake',
      _exec: makeExec(1, '', stderr),
    });
    assert.equal(result.passed, false);
    assert.ok(
      result.typecheckErrors.some(l => l.includes('error TS2322')),
      `expected TS2322 in ${JSON.stringify(result.typecheckErrors)}`,
    );
  });

  it('error TS pattern matches inline in stdout', async () => {
    const stdout = 'Found 2 errors.\nerror TS2304: Cannot find name foo\n';
    const result = await runTypecheck({
      cwd: '/fake',
      _exec: makeExec(1, stdout),
    });
    assert.ok(
      result.typecheckErrors.some(l => /error TS\d+/.test(l)),
      `expected error TS line in ${JSON.stringify(result.typecheckErrors)}`,
    );
  });

  it('more than 50 errors are trimmed to 50', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `src/f.ts(${i},1): error TS2300: dup`);
    const result = await runTypecheck({
      cwd: '/fake',
      _exec: makeExec(1, lines.join('\n')),
    });
    assert.ok(result.typecheckErrors.length <= 50, `expected <=50 errors, got ${result.typecheckErrors.length}`);
  });
});

// ── describe: formatErrorsForLLM ─────────────────────────────────────────────

describe('formatErrorsForLLM', () => {
  it('strips ANSI escape sequences from output', () => {
    const result = makeResult({ stdout: '\x1B[31mERROR\x1B[0m some failure' });
    const formatted = formatErrorsForLLM(result);
    assert.ok(!formatted.includes('\x1B'), 'ANSI codes should be stripped');
    assert.ok(formatted.includes('ERROR'), 'text content should remain');
  });

  it('output is truncated to 50 lines', () => {
    const manyLines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const result = makeResult({ stdout: manyLines, passed: false });
    const formatted = formatErrorsForLLM(result);
    // The header line "The following errors occurred:" is always present
    const nonHeaderLines = formatted.split('\n').filter(l => l !== 'The following errors occurred:');
    assert.ok(nonHeaderLines.length <= 51, `expected <=51 lines (50 + header), got ${nonHeaderLines.length}`);
  });

  it('typecheckErrors appear in formatted output', () => {
    const result = makeResult({
      typecheckErrors: ['src/foo.ts(1,1): error TS9999: something'],
      passed: false,
    });
    const formatted = formatErrorsForLLM(result);
    assert.ok(formatted.includes('error TS9999'), `expected TS error in: ${formatted}`);
  });

  it('failingTests appear when no typecheckErrors', () => {
    const result = makeResult({
      failingTests: ['myFailingTest'],
      typecheckErrors: [],
      passed: false,
    });
    const formatted = formatErrorsForLLM(result);
    assert.ok(formatted.includes('myFailingTest'), `expected failing test in: ${formatted}`);
  });

  it('empty result returns string containing "The following errors occurred:"', () => {
    const result = makeResult();
    const formatted = formatErrorsForLLM(result);
    assert.ok(formatted.length > 0, 'should return non-empty string');
    assert.ok(formatted.includes('The following errors occurred:'), `expected header in: ${formatted}`);
  });

  it('typecheckErrors take precedence over failingTests when both present', () => {
    const result = makeResult({
      typecheckErrors: ['error TS1234: type mismatch'],
      failingTests: ['myTest'],
      passed: false,
    });
    const formatted = formatErrorsForLLM(result);
    assert.ok(formatted.includes('error TS1234'), 'tsc errors should appear');
    // failingTests should NOT appear in Failing items section since typecheckErrors takes precedence
    const afterFailing = formatted.split('Failing items:')[1] ?? '';
    assert.ok(!afterFailing.includes('myTest'), 'failing tests should not appear when tsc errors present');
  });
});

// ── describe: injection seams ─────────────────────────────────────────────────

describe('injection seams', () => {
  it('_exec override in runProjectTests is called with the detected test command', async () => {
    const { exec, calls } = makeCapturingExec(0, 'all good');
    await runProjectTests({
      cwd: '/project',
      _exec: exec,
      _readFile: makePkgJson('tsx --test tests/**'),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cmd, 'tsx --test tests/**');
  });

  it('_exec override in runTypecheck is called with npx tsc --noEmit', async () => {
    const { exec, calls } = makeCapturingExec(0, '');
    await runTypecheck({
      cwd: '/project',
      _exec: exec,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.cmd, 'npx tsc --noEmit');
  });

  it('_readFile override in detectTestCommand is called with package.json path', async () => {
    const readFileCalls: string[] = [];
    const readFile: NonNullable<TestRunnerOptions['_readFile']> = async (p) => {
      readFileCalls.push(p);
      return JSON.stringify({ scripts: { test: 'vitest' } });
    };
    const cmd = await detectTestCommand('/my/project', { _readFile: readFile });
    assert.equal(cmd, 'vitest');
    assert.ok(
      readFileCalls[0]?.includes('package.json'),
      `expected package.json path, got ${readFileCalls[0]}`,
    );
    assert.ok(
      readFileCalls[0]?.startsWith(path.join('/my/project')),
      `expected path to start with /my/project, got ${readFileCalls[0]}`,
    );
  });

  it('custom timeout in options is passed to exec', async () => {
    const { exec, calls } = makeCapturingExec(0, '');
    await runTypecheck({
      cwd: '/fake',
      timeout: 55_000,
      _exec: exec,
    });
    assert.equal(calls[0]?.timeout, 55_000);
  });
});
