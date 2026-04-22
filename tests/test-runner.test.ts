import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeShellCommand,
  formatErrorsForLLM,
  detectTestCommand,
  runProjectTests,
  runTypecheck,
  SHELL_METACHARACTERS,
} from '../src/core/test-runner.js';

describe('SHELL_METACHARACTERS', () => {
  it('matches semicolon', () => {
    assert.ok(SHELL_METACHARACTERS.test('cmd; rm -rf /'));
  });

  it('matches pipe', () => {
    assert.ok(SHELL_METACHARACTERS.test('cmd | cat'));
  });

  it('matches ampersand', () => {
    assert.ok(SHELL_METACHARACTERS.test('cmd && other'));
  });

  it('does not match safe command', () => {
    assert.ok(!SHELL_METACHARACTERS.test('npm test'));
  });
});

describe('sanitizeShellCommand', () => {
  it('passes for safe command', () => {
    assert.doesNotThrow(() => sanitizeShellCommand('npm test'));
  });

  it('throws for command with semicolon', () => {
    assert.throws(() => sanitizeShellCommand('npm test; rm -rf /'), /injection/i);
  });

  it('throws for command with pipe', () => {
    assert.throws(() => sanitizeShellCommand('npm test | cat /etc/passwd'), /injection/i);
  });

  it('throws for command with dollar-paren', () => {
    assert.throws(() => sanitizeShellCommand('npm $(echo test)'), /injection/i);
  });

  it('uses _sanitize seam when provided', () => {
    let called = false;
    sanitizeShellCommand('malicious; cmd', (cmd) => { called = true; });
    assert.ok(called);
  });

  it('does not throw when _sanitize seam is used (even for dangerous cmd)', () => {
    assert.doesNotThrow(() => sanitizeShellCommand('dangerous; cmd', () => {}));
  });
});

describe('formatErrorsForLLM', () => {
  function makeResult(overrides = {}) {
    return {
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      durationMs: 100,
      failingTests: [],
      typecheckErrors: [],
      ...overrides,
    };
  }

  it('includes error text', () => {
    const result = makeResult({ stdout: 'test failed\nFAIL myTest' });
    const output = formatErrorsForLLM(result);
    assert.ok(output.includes('errors occurred'));
  });

  it('strips ANSI codes from output', () => {
    const result = makeResult({ stdout: '\x1B[31mred error\x1B[0m' });
    const output = formatErrorsForLLM(result);
    assert.ok(!output.includes('\x1B'));
    assert.ok(output.includes('red error'));
  });

  it('includes failing tests when present', () => {
    const result = makeResult({
      stdout: 'test output',
      failingTests: ['testA', 'testB'],
    });
    const output = formatErrorsForLLM(result);
    assert.ok(output.includes('testA'));
    assert.ok(output.includes('Failing items'));
  });

  it('includes typecheck errors over failing tests', () => {
    const result = makeResult({
      stdout: 'ts output',
      typecheckErrors: ['src/index.ts(10,5): error TS2345'],
      failingTests: ['testA'],
    });
    const output = formatErrorsForLLM(result);
    assert.ok(output.includes('TS2345'));
    assert.ok(!output.includes('testA'));
  });

  it('limits to 50 lines of output', () => {
    const longOutput = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const result = makeResult({ stdout: longOutput });
    const output = formatErrorsForLLM(result);
    const lines = output.split('\n').filter(l => l.startsWith('line '));
    assert.ok(lines.length <= 50);
  });
});

describe('detectTestCommand', () => {
  it('returns npm test when package.json has no scripts', async () => {
    const cmd = await detectTestCommand('/fake', {
      _readFile: async () => JSON.stringify({ name: 'test' }),
    });
    assert.equal(cmd, 'npm test');
  });

  it('returns scripts.test from package.json', async () => {
    const cmd = await detectTestCommand('/fake', {
      _readFile: async () => JSON.stringify({ scripts: { test: 'vitest run' } }),
    });
    assert.equal(cmd, 'vitest run');
  });

  it('returns npm test when file read fails', async () => {
    const cmd = await detectTestCommand('/fake', {
      _readFile: async () => { throw new Error('not found'); },
    });
    assert.equal(cmd, 'npm test');
  });

  it('returns npm test when package.json is malformed', async () => {
    const cmd = await detectTestCommand('/fake', {
      _readFile: async () => 'not json',
    });
    assert.equal(cmd, 'npm test');
  });
});

describe('runProjectTests', () => {
  it('returns passed:true when exec returns exitCode 0', async () => {
    const result = await runProjectTests({
      _exec: async () => ({ exitCode: 0, stdout: 'all pass', stderr: '' }),
      _readFile: async () => JSON.stringify({ scripts: { test: 'npm test' } }),
      _sanitize: () => {},
    });
    assert.ok(result.passed);
    assert.equal(result.exitCode, 0);
  });

  it('returns passed:false when exec returns exitCode 1', async () => {
    const result = await runProjectTests({
      _exec: async () => ({ exitCode: 1, stdout: '', stderr: 'FAIL test1' }),
      _readFile: async () => JSON.stringify({ scripts: { test: 'npm test' } }),
      _sanitize: () => {},
    });
    assert.ok(!result.passed);
    assert.equal(result.exitCode, 1);
  });

  it('extracts failing test names from output', async () => {
    const result = await runProjectTests({
      _exec: async () => ({ exitCode: 1, stdout: 'not ok 1 myTest', stderr: '' }),
      _readFile: async () => JSON.stringify({ scripts: { test: 'npm test' } }),
      _sanitize: () => {},
    });
    assert.ok(result.failingTests.includes('myTest'));
  });
});

describe('runTypecheck', () => {
  it('returns passed:true when typecheck passes', async () => {
    const result = await runTypecheck({
      _exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });
    assert.ok(result.passed);
  });

  it('extracts typecheck errors from output', async () => {
    const result = await runTypecheck({
      _exec: async () => ({
        exitCode: 1,
        stdout: 'src/index.ts(10,5): error TS2345: Argument not assignable',
        stderr: '',
      }),
    });
    assert.ok(result.typecheckErrors.some(e => e.includes('TS2345')));
  });
});
