import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runE2eWorkflowOutcome } from '../src/matrix/engines/e2e-workflow-runner.js';
import type { E2eWorkflowOutcome } from '../src/matrix/types/outcome.js';

function makeOutcome(overrides: Partial<E2eWorkflowOutcome> = {}): E2eWorkflowOutcome {
  return {
    id: 'test_e2e',
    tier: 'T7',
    kind: 'e2e-workflow',
    description: 'test e2e workflow',
    steps: [
      { cli_args: ['--help'], expected_exit: 0 },
    ],
    ...overrides,
  };
}

function makeSpawn(exitMap: Record<string, number> = {}, stdoutMap: Record<string, string> = {}) {
  return (args: string[], _opts: unknown) => {
    const key = args.slice(1).join(' ');
    const status = exitMap[key] ?? 0;
    const stdout = stdoutMap[key] ?? `ok: ${key}`;
    return { status, stdout, stderr: '' };
  };
}

describe('e2e-workflow-runner', () => {
  it('passes when all steps succeed', async () => {
    const outcome = makeOutcome({
      steps: [
        { cli_args: ['score', '--prompt'], expected_exit: 0 },
        { cli_args: ['--help'], expected_exit: 0 },
      ],
    });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', '/fake', {
      _spawn: makeSpawn(),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
    assert.ok(entry.stdoutTail.includes('Step 1'));
    assert.ok(entry.stdoutTail.includes('Step 2'));
  });

  it('fails when a step exits non-zero', async () => {
    const outcome = makeOutcome({
      steps: [
        { cli_args: ['step-1'], expected_exit: 0 },
        { cli_args: ['step-2'], expected_exit: 0 },
        { cli_args: ['step-3'], expected_exit: 0 },
      ],
    });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', '/fake', {
      _spawn: makeSpawn({ 'step-2': 1 }),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('step 2'));
    // Step 3 should NOT have run
    assert.ok(!entry.stdoutTail.includes('Step 3'));
  });

  it('validates expected_stdout_patterns per step', async () => {
    const outcome = makeOutcome({
      steps: [
        {
          cli_args: ['score', '--prompt'],
          expected_exit: 0,
          expected_stdout_patterns: ['Score'],
        },
      ],
    });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', '/fake', {
      _spawn: makeSpawn({}, { 'score --prompt': 'Your Score is 9.0' }),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
  });

  it('fails when expected_stdout_patterns do not match', async () => {
    const outcome = makeOutcome({
      steps: [
        {
          cli_args: ['score'],
          expected_exit: 0,
          expected_stdout_patterns: ['missing_keyword'],
        },
      ],
    });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', '/fake', {
      _spawn: makeSpawn({}, { 'score': 'some output' }),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('missing_keyword'));
  });

  it('validates expected_artifacts after each step', async () => {
    const cwd = path.resolve('/fake');
    const expectedPath = path.join(cwd, 'output.json');
    const existingPaths = new Set([expectedPath]);
    const outcome = makeOutcome({
      steps: [
        {
          cli_args: ['generate'],
          expected_exit: 0,
          expected_artifacts: ['output.json'],
        },
      ],
    });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', cwd, {
      _spawn: makeSpawn(),
      _exists: async (p: string) => existingPaths.has(p),
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
  });

  it('fails when expected artifact is missing', async () => {
    const outcome = makeOutcome({
      steps: [
        {
          cli_args: ['generate'],
          expected_exit: 0,
          expected_artifacts: ['missing.json'],
        },
      ],
    });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', '/fake', {
      _spawn: makeSpawn(),
      _exists: async () => false,
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, false);
    assert.ok(entry.failureReason?.includes('missing.json'));
  });

  it('uses temp dir when cwd_strategy is temp', async () => {
    let tempCreated = false;
    let tempCleaned = false;
    const outcome = makeOutcome({ cwd_strategy: 'temp' });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', '/fake', {
      _spawn: makeSpawn(),
      _mkdtemp: async () => { tempCreated = true; return '/tmp/e2e-test'; },
      _rmdir: async () => { tempCleaned = true; },
      _readGitSha: async () => 'abc123',
    });
    assert.equal(entry.passed, true);
    assert.equal(tempCreated, true);
    assert.equal(tempCleaned, true);
  });

  it('handles spawn errors in steps gracefully', async () => {
    const outcome = makeOutcome({
      steps: [{ cli_args: ['crash'] }],
    });
    const entry = await runE2eWorkflowOutcome(outcome, 'fn', '/fake', {
      _spawn: () => { throw new Error('spawn boom'); },
      _readGitSha: async () => null,
    });
    assert.equal(entry.passed, false);
  });
});
