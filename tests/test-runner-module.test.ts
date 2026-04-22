import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeShellCommand,
  SHELL_METACHARACTERS,
  detectTestCommand,
  runProjectTests,
  runTypecheck,
  formatErrorsForLLM,
  type TestRunResult,
} from '../src/core/test-runner.js';
import { ValidationError } from '../src/core/errors.js';

function makeResult(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    passed: true,
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 100,
    failingTests: [],
    typecheckErrors: [],
    ...overrides,
  };
}

describe('sanitizeShellCommand', () => {
  it('accepts safe commands', () => {
    assert.doesNotThrow(() => sanitizeShellCommand('npm test'));
    assert.doesNotThrow(() => sanitizeShellCommand('npx tsx tests/foo.test.ts'));
  });

  it('throws on semicolon injection', () => {
    assert.throws(() => sanitizeShellCommand('npm test; rm -rf /'), ValidationError);
  });

  it('throws on pipe injection', () => {
    assert.throws(() => sanitizeShellCommand('npm test | cat /etc/passwd'), ValidationError);
  });

  it('throws on backtick injection', () => {
    assert.throws(() => sanitizeShellCommand('npm `whoami`'), ValidationError);
  });

  it('throws on $() injection', () => {
    assert.throws(() => sanitizeShellCommand('npm $(evil)'), ValidationError);
  });

  it('throws on newline injection', () => {
    assert.throws(() => sanitizeShellCommand('npm test\nrm -rf /'), ValidationError);
  });

  it('uses _sanitize seam when provided (bypasses default check)', () => {
    let checked = '';
    sanitizeShellCommand('npm test; evil', (cmd) => { checked = cmd; });
    assert.equal(checked, 'npm test; evil');
  });

  it('SHELL_METACHARACTERS regex matches dangerous chars', () => {
    assert.ok(SHELL_METACHARACTERS.test(';'));
    assert.ok(SHELL_METACHARACTERS.test('|'));
    assert.ok(SHELL_METACHARACTERS.test('&'));
    assert.ok(!SHELL_METACHARACTERS.test('a'));
  });
});

describe('detectTestCommand', () => {
  it('returns npm test when package.json has no test script', async () => {
    const cmd = await detectTestCommand('/tmp/test', {
      _readFile: async () => JSON.stringify({ scripts: {} }),
    });
    assert.equal(cmd, 'npm test');
  });

  it('returns script from package.json', async () => {
    const cmd = await detectTestCommand('/tmp/test', {
      _readFile: async () => JSON.stringify({ scripts: { test: 'tsx --test tests/**' } }),
    });
    assert.equal(cmd, 'tsx --test tests/**');
  });

  it('returns npm test when file not found', async () => {
    const cmd = await detectTestCommand('/tmp/test', {
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(cmd, 'npm test');
  });
});

describe('runProjectTests', () => {
  it('returns passed=true when _exec returns exitCode 0', async () => {
    const result = await runProjectTests({
      cwd: '/tmp/test',
      _exec: async () => ({ exitCode: 0, stdout: 'all good', stderr: '' }),
      _readFile: async () => JSON.stringify({ scripts: { test: 'npm test' } }),
    });
    assert.equal(result.passed, true);
    assert.equal(result.exitCode, 0);
  });

  it('returns passed=false when _exec returns non-zero', async () => {
    const result = await runProjectTests({
      cwd: '/tmp/test',
      _exec: async () => ({ exitCode: 1, stdout: '', stderr: 'FAIL: test broke' }),
      _readFile: async () => JSON.stringify({ scripts: { test: 'npm test' } }),
    });
    assert.equal(result.passed, false);
  });

  it('captures stdout in result', async () => {
    const result = await runProjectTests({
      cwd: '/tmp/test',
      _exec: async () => ({ exitCode: 0, stdout: 'test output here', stderr: '' }),
      _readFile: async () => JSON.stringify({}),
    });
    assert.ok(result.stdout.includes('test output here'));
  });
});

describe('runTypecheck', () => {
  it('returns passed=true on exit code 0', async () => {
    const result = await runTypecheck({
      cwd: '/tmp/test',
      _exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });
    assert.equal(result.passed, true);
  });

  it('extracts typecheck errors from stderr', async () => {
    const result = await runTypecheck({
      cwd: '/tmp/test',
      _exec: async () => ({
        exitCode: 1,
        stdout: '',
        stderr: 'src/foo.ts(10,5): error TS2322: Type string is not assignable to number',
      }),
    });
    assert.equal(result.passed, false);
    assert.ok(result.typecheckErrors.length > 0);
    assert.ok(result.typecheckErrors[0].includes('TS2322'));
  });
});

describe('formatErrorsForLLM', () => {
  it('includes stdout content', () => {
    const result = makeResult({ stdout: 'FAIL: something broke', stderr: '' });
    const output = formatErrorsForLLM(result);
    assert.ok(output.includes('something broke'));
  });

  it('includes failing tests when present', () => {
    const result = makeResult({ failingTests: ['my failing test'] });
    const output = formatErrorsForLLM(result);
    assert.ok(output.includes('my failing test'));
  });

  it('prioritizes typecheck errors over failing tests', () => {
    const result = makeResult({
      typecheckErrors: ['error TS2322: bad type'],
      failingTests: ['test that failed'],
    });
    const output = formatErrorsForLLM(result);
    assert.ok(output.includes('TS2322'));
  });

  it('strips ANSI escape codes', () => {
    const result = makeResult({ stdout: '\x1B[31mERROR\x1B[0m: something failed' });
    const output = formatErrorsForLLM(result);
    assert.ok(!output.includes('\x1B'));
    assert.ok(output.includes('ERROR'));
  });
});
