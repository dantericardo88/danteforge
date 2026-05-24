import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeExecOutcome } from '../src/matrix/engines/runtime-exec-runner.js';
import type { RuntimeExecOutcome } from '../src/matrix/types/outcome.js';

function makeOutcome(overrides: Partial<RuntimeExecOutcome> = {}): RuntimeExecOutcome {
  return {
    id: 'test_runtime',
    tier: 'T5',
    kind: 'runtime-exec',
    description: 'test runtime exec',
    command: 'npx tsx --test tests/some.test.ts',
    ...overrides,
  };
}

function makeSpawn(exit: number, stdout: string, stderr = '', delayMs = 0) {
  return (_cmd: string, _opts: unknown) => {
    if (delayMs > 0) {
      const end = Date.now() + delayMs;
      while (Date.now() < end) { /* busy wait for test timing */ }
    }
    return { status: exit, stdout, stderr };
  };
}

describe('runtime-exec-runner', () => {
  it('passes when command exits 0', async () => {
    const outcome = makeOutcome();
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: makeSpawn(0, '10 tests passed'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
    assert.equal(entry.exitCode, 0);
    assert.equal(entry.dimensionId, 'testing');
  });

  it('fails when command exits non-zero', async () => {
    const outcome = makeOutcome();
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: makeSpawn(1, '', 'test failure'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('exit 1'));
  });

  it('rejects when duration is below min_duration_ms', async () => {
    const outcome = makeOutcome({ min_duration_ms: 5000 });
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: makeSpawn(0, 'instant result'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('too fast'));
  });

  it('passes when duration exceeds min_duration_ms', async () => {
    const outcome = makeOutcome({ min_duration_ms: 10 });
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: makeSpawn(0, 'result', '', 20),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
  });

  it('checks expected_output_pattern', async () => {
    const outcome = makeOutcome({ expected_output_pattern: 'pass' });
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: makeSpawn(0, '10 tests passed'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
  });

  it('fails when output pattern does not match', async () => {
    const outcome = makeOutcome({ expected_output_pattern: 'pass' });
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: makeSpawn(0, 'all good but no keyword'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('pattern'));
  });

  it('handles spawn errors gracefully', async () => {
    const outcome = makeOutcome();
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: () => { throw new Error('boom'); },
      _readGitSha: async () => null,
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.stderrTail.includes('spawn error'));
  });

  it('accepts custom expected_exit', async () => {
    const outcome = makeOutcome({ expected_exit: 2 });
    const entry = await runRuntimeExecOutcome(outcome, 'testing', '/fake', {
      _spawn: makeSpawn(2, 'expected exit 2'),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
  });
});
