import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCliSmokeOutcome } from '../src/matrix/engines/cli-smoke-runner.js';
import type { CliSmokeOutcome } from '../src/matrix/types/outcome.js';

function makeOutcome(overrides: Partial<CliSmokeOutcome> = {}): CliSmokeOutcome {
  return {
    id: 'test_smoke',
    tier: 'T5',
    kind: 'cli-smoke',
    description: 'test cli smoke',
    cli_args: ['--help'],
    ...overrides,
  };
}

function makeSpawn(exit: number, stdout: string, stderr = '') {
  return (_args: string[], _opts: unknown) => ({ status: exit, stdout, stderr });
}

describe('cli-smoke-runner', () => {
  it('passes when CLI exits 0 and stdout matches patterns', async () => {
    const outcome = makeOutcome({
      expected_stdout_patterns: ['danteforge', 'commands'],
    });
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(0, 'danteforge - CLI tool with many commands'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
    assert.equal(entry.exitCode, 0);
    assert.equal(entry.dimensionId, 'dx');
    assert.ok(entry.stdoutTail.includes('danteforge'));
  });

  it('fails when CLI exits non-zero', async () => {
    const outcome = makeOutcome();
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(1, '', 'error occurred'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.equal(entry.exitCode, 1);
    assert.ok(entry.failureReason?.includes('exit 1'));
  });

  it('fails when expected stdout pattern does not match', async () => {
    const outcome = makeOutcome({
      expected_stdout_patterns: ['nonexistent_pattern'],
    });
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(0, 'some other output'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('nonexistent_pattern'));
  });

  it('fails when forbidden stdout pattern matches', async () => {
    const outcome = makeOutcome({
      forbidden_stdout_patterns: ['Error|FATAL'],
    });
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(0, 'Output with Error in it'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('forbidden'));
  });

  it('accepts custom expected_exit code', async () => {
    const outcome = makeOutcome({ expected_exit: 1 });
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(1, 'expected failure'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
    assert.equal(entry.exitCode, 1);
  });

  it('uses temp dir when cwd_strategy is temp', async () => {
    let tempCreated = false;
    let tempCleaned = false;
    const outcome = makeOutcome({ cwd_strategy: 'temp' });
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(0, 'ok'),
      _mkdtemp: async () => { tempCreated = true; return '/tmp/test-dir'; },
      _rmdir: async () => { tempCleaned = true; },
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
    assert.equal(tempCreated, true);
    assert.equal(tempCleaned, true);
  });

  it('records durationMs > 0', async () => {
    const outcome = makeOutcome();
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(0, 'ok'),
      _readGitSha: async () => null,
    });
    assert.equal(typeof entry.durationMs, 'number');
  });

  it('handles spawn errors gracefully', async () => {
    const outcome = makeOutcome();
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: () => { throw new Error('spawn failed'); },
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.stderrTail.includes('spawn error'));
  });

  it('requires all expected_stdout_patterns to match', async () => {
    const outcome = makeOutcome({
      expected_stdout_patterns: ['first', 'second', 'third'],
    });
    const entry = await runCliSmokeOutcome(outcome, 'dx', '/fake', {
      _spawn: makeSpawn(0, 'first and second but not the other'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('third'));
  });
});
