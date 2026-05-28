// outcome-runner-advanced.test.ts
//
// Covers: flake_tolerance retry (shell + runtime-exec), runAllOutcomes aggregation,
// validateOutcomeForTier T7/T8, and validateOutcomesForDuplicateIds.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { runOneOutcome, runAllOutcomes } from '../src/matrix/engines/outcome-runner.js';
import { runRuntimeExecOutcome } from '../src/matrix/engines/runtime-exec-runner.js';
import {
  validateOutcomeForTier,
  validateOutcomesForDuplicateIds,
  type Outcome,
  type ShellOutcome,
  type RuntimeExecOutcome,
} from '../src/matrix/types/outcome.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStore() {
  const store = new Map<string, string>();
  return {
    store,
    _readFile: async (p: string) => {
      const v = store.get(p);
      if (!v) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    _writeFile: async (p: string, d: string) => { store.set(p, d); },
    _exists: async (p: string) => store.has(p),
    _mkdir: async () => {},
  };
}

function makeShellOutcome(id: string, tier: Outcome['tier'] = 'T1'): ShellOutcome {
  return { id, tier, description: `${id} description`, command: `echo ${id}` };
}

// ── flake_tolerance: shell outcomes ─────────────────────────────────────────

describe('runOneOutcome — flake_tolerance (shell)', () => {
  it('retries once on failure when flake_tolerance > 0, passes on retry', async () => {
    const fs = makeStore();
    let calls = 0;
    const outcome: ShellOutcome = {
      id: 'flaky', tier: 'T1', description: 'flaky test',
      command: 'echo test', flake_tolerance: 0.5,
    };
    const entry = await runOneOutcome({
      dimensionId: 'testing', outcome, cwd: '/p', forceCold: true,
      _spawn: () => { calls++; return { status: calls === 1 ? 1 : 0, stdout: 'ok', stderr: '' }; },
      _readGitSha: async () => 'abc123',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(calls, 2, 'should have called spawn twice (initial + retry)');
    assert.equal(entry.passed, true, 'should pass after retry succeeds');
    assert.equal(entry.failureReason, undefined, 'no failure reason when retry passes');
    assert.equal(entry.exitCode, 0, 'exit code should reflect the passing retry run');
  });

  it('still fails when both the initial run and retry fail', async () => {
    const fs = makeStore();
    let calls = 0;
    const outcome: ShellOutcome = {
      id: 'always-fails', tier: 'T1', description: 'always fails',
      command: 'exit 1', flake_tolerance: 0.5,
    };
    const entry = await runOneOutcome({
      dimensionId: 'testing', outcome, cwd: '/p', forceCold: true,
      _spawn: () => { calls++; return { status: 1, stdout: '', stderr: 'fail' }; },
      _readGitSha: async () => 'abc123',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(calls, 2, 'should retry even when consistently failing');
    assert.equal(entry.passed, false, 'should fail when all attempts fail');
    assert.ok(entry.failureReason, 'should carry a failure reason');
  });

  it('does NOT retry when flake_tolerance is 0 (default)', async () => {
    const fs = makeStore();
    let calls = 0;
    const outcome: ShellOutcome = {
      id: 'strict', tier: 'T1', description: 'strict test',
      command: 'exit 1', // no flake_tolerance
    };
    const entry = await runOneOutcome({
      dimensionId: 'testing', outcome, cwd: '/p', forceCold: true,
      _spawn: () => { calls++; return { status: 1, stdout: '', stderr: '' }; },
      _readGitSha: async () => 'abc123',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(calls, 1, 'should call spawn exactly once with no flake_tolerance');
    assert.equal(entry.passed, false);
  });

  it('uses retry stdout in evidence when retry passes', async () => {
    const fs = makeStore();
    let calls = 0;
    const outcome: ShellOutcome = {
      id: 'flaky-pattern', tier: 'T1', description: 'flaky with pattern check',
      command: 'echo test', flake_tolerance: 0.5,
      expected_output_pattern: 'retry-output',
    };
    const entry = await runOneOutcome({
      dimensionId: 'testing', outcome, cwd: '/p', forceCold: true,
      _spawn: () => {
        calls++;
        // First call: exits 0 but stdout does not match pattern → fails
        // Second call: exits 0 and stdout matches pattern → passes
        return { status: 0, stdout: calls === 1 ? 'initial-output' : 'retry-output', stderr: '' };
      },
      _readGitSha: async () => 'abc123',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(calls, 2);
    assert.equal(entry.passed, true, 'should pass when retry matches the pattern');
    assert.ok(entry.stdoutTail.includes('retry-output'), 'evidence should use the retry stdout');
  });

  it('correctly passes when first run already succeeds (no retry needed)', async () => {
    const fs = makeStore();
    let calls = 0;
    const outcome: ShellOutcome = {
      id: 'passes-first', tier: 'T1', description: 'passes on first try',
      command: 'echo ok', flake_tolerance: 0.5,
    };
    const entry = await runOneOutcome({
      dimensionId: 'testing', outcome, cwd: '/p', forceCold: true,
      _spawn: () => { calls++; return { status: 0, stdout: 'ok', stderr: '' }; },
      _readGitSha: async () => 'abc123',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(calls, 1, 'should not retry when first run passes');
    assert.equal(entry.passed, true);
  });
});

// ── flake_tolerance: runtime-exec outcomes ───────────────────────────────────

describe('runRuntimeExecOutcome — flake_tolerance', () => {
  it('retries once on failure when flake_tolerance > 0', async () => {
    let calls = 0;
    const outcome: RuntimeExecOutcome = {
      id: 'flaky-runtime', tier: 'T3', kind: 'runtime-exec',
      description: 'flaky runtime test', command: 'npx tsx --test t.ts',
      required_callsite: 'src/foo.ts', flake_tolerance: 0.5,
    };
    const entry = await runRuntimeExecOutcome(outcome, 'dim1', '/p', {
      _spawn: () => { calls++; return { status: calls === 1 ? 1 : 0, stdout: 'test passed', stderr: '' }; },
      _readGitSha: async () => 'sha1',
    });
    assert.equal(calls, 2, 'should retry once on failure');
    assert.equal(entry.passed, true, 'should pass after retry');
  });

  it('does not retry when flake_tolerance is absent', async () => {
    let calls = 0;
    const outcome: RuntimeExecOutcome = {
      id: 'strict-runtime', tier: 'T3', kind: 'runtime-exec',
      description: 'strict runtime', command: 'npx tsx --test t.ts',
      required_callsite: 'src/foo.ts',
    };
    const entry = await runRuntimeExecOutcome(outcome, 'dim1', '/p', {
      _spawn: () => { calls++; return { status: 1, stdout: '', stderr: 'fail' }; },
      _readGitSha: async () => 'sha1',
    });
    assert.equal(calls, 1, 'no retry without flake_tolerance');
    assert.equal(entry.passed, false);
  });
});

// ── runAllOutcomes ────────────────────────────────────────────────────────────

describe('runAllOutcomes', () => {
  it('aggregates results across multiple dimensions', async () => {
    const fs = makeStore();
    const result = await runAllOutcomes({
      cwd: '/p',
      dimensions: [
        { id: 'dim1', outcomes: [makeShellOutcome('o1'), makeShellOutcome('o2')] },
        { id: 'dim2', outcomes: [makeShellOutcome('o3')] },
      ],
      _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      _readGitSha: async () => 'abc',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(result.totalOutcomes, 3);
    assert.equal(result.passingOutcomes, 3);
    assert.equal(result.failingOutcomes, 0);
    assert.equal(result.perDimension.length, 2);
    assert.equal(result.perDimension[0]!.dimensionId, 'dim1');
    assert.equal(result.perDimension[0]!.total, 2);
    assert.equal(result.perDimension[0]!.passing, 2);
    assert.equal(result.perDimension[1]!.dimensionId, 'dim2');
    assert.equal(result.perDimension[1]!.total, 1);
    assert.equal(result.evidence.size, 3);
  });

  it('skips dimensions with no outcomes', async () => {
    const fs = makeStore();
    const result = await runAllOutcomes({
      cwd: '/p',
      dimensions: [
        { id: 'dim_empty', outcomes: [] },
        { id: 'dim_no_outcomes' },
        { id: 'dim_real', outcomes: [makeShellOutcome('o1')] },
      ],
      _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      _readGitSha: async () => 'abc',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(result.totalOutcomes, 1);
    assert.equal(result.perDimension.length, 1, 'empty dims must not appear in perDimension');
    assert.equal(result.perDimension[0]!.dimensionId, 'dim_real');
  });

  it('filters to a single dimension when dim option is provided', async () => {
    const fs = makeStore();
    const result = await runAllOutcomes({
      cwd: '/p',
      dim: 'dim1',
      dimensions: [
        { id: 'dim1', outcomes: [makeShellOutcome('o1')] },
        { id: 'dim2', outcomes: [makeShellOutcome('o2')] },
      ],
      _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      _readGitSha: async () => 'abc',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(result.totalOutcomes, 1);
    assert.equal(result.perDimension.length, 1);
    assert.equal(result.perDimension[0]!.dimensionId, 'dim1');
  });

  it('counts passing and failing outcomes correctly per dimension', async () => {
    const fs = makeStore();
    let callCount = 0;
    const result = await runAllOutcomes({
      cwd: '/p',
      dimensions: [{ id: 'dim1', outcomes: [makeShellOutcome('pass-o'), makeShellOutcome('fail-o')] }],
      _spawn: () => {
        callCount++;
        return { status: callCount === 1 ? 0 : 1, stdout: '', stderr: '' };
      },
      _readGitSha: async () => 'abc',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(result.passingOutcomes, 1);
    assert.equal(result.failingOutcomes, 1);
    assert.equal(result.perDimension[0]!.failing, 1);
    assert.equal(result.perDimension[0]!.passing, 1);
  });

  it('treats spawn errors as failed outcomes (does not rethrow)', async () => {
    const fs = makeStore();
    // spawn errors are caught inside runOneOutcome and produce a failed entry
    const result = await runAllOutcomes({
      cwd: '/p',
      dimensions: [{ id: 'dim1', outcomes: [makeShellOutcome('error-o')] }],
      _spawn: () => { throw new Error('ENOENT: spawn failed'); },
      _readGitSha: async () => 'abc',
      _createTimeMachineCommit: null,
      ...fs,
    });
    assert.equal(result.totalOutcomes, 1);
    assert.equal(result.failingOutcomes, 1, 'spawn error should count as outcome failure');
    assert.equal(result.evidence.size, 1, 'evidence entry should be produced even on spawn error');
  });

  it('reports progress for each outcome via _onProgress', async () => {
    const fs = makeStore();
    const progressMsgs: string[] = [];
    await runAllOutcomes({
      cwd: '/p',
      dimensions: [{ id: 'dim1', outcomes: [makeShellOutcome('o1'), makeShellOutcome('o2')] }],
      _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      _readGitSha: async () => 'abc',
      _createTimeMachineCommit: null,
      _onProgress: (msg) => { progressMsgs.push(msg); },
      ...fs,
    });
    assert.equal(progressMsgs.length, 2, 'should emit one progress message per outcome');
    assert.ok(progressMsgs[0]!.includes('dim1/o1'), 'progress message should name the outcome');
  });
});

// ── validateOutcomeForTier T7/T8 ─────────────────────────────────────────────

describe('validateOutcomeForTier — T7 multi-receipt consensus', () => {
  it('errors when fewer than 3 T5+ sibling outcomes are present', () => {
    const t7: RuntimeExecOutcome = {
      id: 't7-proof', tier: 'T7', kind: 'runtime-exec',
      description: 'multi-receipt proof',
      command: 'npx tsx --test proof.ts',
      required_callsite: 'src/foo.ts',
    };
    const a: RuntimeExecOutcome = {
      id: 'a', tier: 'T5', kind: 'runtime-exec',
      description: 'a', command: 'npx tsx --test a.ts',
      required_callsite: 'src/a.ts',
    };
    // 2 total T5+ (t7 + a) which is < 3 → multi-receipt error expected
    const errors = validateOutcomeForTier(t7, { siblingOutcomes: [t7, a] });
    const multiReceiptErr = errors.find(e => e.reason.includes('multi-receipt') || e.reason.includes('3+'));
    assert.ok(multiReceiptErr, 'T7 with < 3 T5+ siblings should produce a multi-receipt error');
  });

  it('does NOT produce a multi-receipt error when 3+ T5+ siblings are present', () => {
    const t7: RuntimeExecOutcome = {
      id: 't7-proof', tier: 'T7', kind: 'runtime-exec',
      description: 'multi-receipt proof',
      command: 'npx tsx --test proof.ts',
      required_callsite: 'src/foo.ts',
    };
    const siblings: RuntimeExecOutcome[] = ['a', 'b'].map(id => ({
      id, tier: 'T5' as const, kind: 'runtime-exec' as const,
      description: id, command: `npx tsx --test ${id}.ts`,
      required_callsite: `src/${id}.ts`,
    }));
    // 3 total T5+ outcomes (t7 + a + b) → no multi-receipt error
    const errors = validateOutcomeForTier(t7, { siblingOutcomes: [t7, ...siblings] });
    const multiReceiptErr = errors.find(e => e.reason.includes('multi-receipt') || e.reason.includes('3+'));
    assert.equal(multiReceiptErr, undefined, 'T7 with 3 T5+ siblings should not produce multi-receipt error');
  });
});

describe('validateOutcomeForTier — T8 live verification', () => {
  it('errors when T8 outcome is not telemetry kind', () => {
    const t8: RuntimeExecOutcome = {
      id: 't8-proof', tier: 'T8', kind: 'runtime-exec',
      description: 'live verification',
      command: 'npx tsx --test t.ts',
      required_callsite: 'src/foo.ts',
    };
    const errors = validateOutcomeForTier(t8);
    const t8Err = errors.find(e => e.tier === 'T8' && e.reason.includes('live verification'));
    assert.ok(t8Err, 'T8 non-telemetry outcome must produce a T8 error');
  });
});

// ── runAllOutcomes duplicate-id guard: cross-tier collision ──────────────────

describe('runAllOutcomes — duplicate id guard', () => {
  it('catches cross-tier duplicate ids even when a tier filter is active', async () => {
    const fs = makeStore();
    // Two outcomes with the same id in different tiers — the prior implementation
    // only validated the tier-filtered subset, so this slipped through undetected.
    const dims = [{
      id: 'dim1',
      outcomes: [
        { id: 'dup', tier: 'T3' as const, description: 'T3 dup', command: 'echo t3' },
        { id: 'dup', tier: 'T5' as const, description: 'T5 dup', command: 'npx tsx --test x.ts', required_callsite: 'src/x.ts' },
      ],
    }];
    // Run with tier filter that would previously let only the T5 outcome through
    // without detecting the duplicate.
    const result = await runAllOutcomes({
      cwd: '/p',
      dimensions: dims,
      tier: 'T5',
      _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      _readGitSha: async () => 'sha1',
      _createTimeMachineCommit: null,
      ...fs,
    });
    // The duplicate guard must fire even with a tier filter — all tier-filtered
    // outcomes are marked failed, not run.
    assert.equal(result.totalOutcomes, 1, 'one tier-filtered outcome counted');
    assert.equal(result.failingOutcomes, 1, 'must be failed — not run due to duplicate');
    assert.equal(result.passingOutcomes, 0, 'must not have passed');
    const entry = [...result.evidence.values()][0];
    assert.ok(entry?.failureReason?.includes('duplicate'), 'failure reason must mention duplicate');
  });

  it('writes duplicate-failure entries to disk so stale passing receipts are invalidated', async () => {
    const diskStore = makeStore();
    // Compute the expected evidence path the runner will use (normalised for the OS).
    const cwd = process.platform === 'win32' ? 'C:\\tmp\\testcwd' : '/tmp/testcwd';
    const expectedPath = path.join(cwd, '.danteforge', 'outcome-evidence', 'sha1-dim1-dup.json');

    // Pre-seed a passing receipt on disk at the would-be evidence path.
    diskStore.store.set(expectedPath, JSON.stringify({
      dimensionId: 'dim1', outcomeId: 'dup', tier: 'T3',
      gitSha: 'sha1', passed: true, exitCode: 0, durationMs: 10,
      stdoutTail: 'old pass', stderrTail: '', ranAt: '2024-01-01T00:00:00Z',
      evidencePath: expectedPath,
    }));

    const dims = [{
      id: 'dim1',
      outcomes: [
        { id: 'dup', tier: 'T3' as const, description: 'first dup', command: 'echo first' },
        { id: 'dup', tier: 'T3' as const, description: 'second dup', command: 'echo second' },
      ],
    }];
    await runAllOutcomes({
      cwd,
      dimensions: dims,
      _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
      _readGitSha: async () => 'sha1',
      _createTimeMachineCommit: null,
      ...diskStore,
    });
    // The file on disk must now contain a failure entry, not the old passing one.
    const onDisk = diskStore.store.get(expectedPath);
    assert.ok(onDisk, 'evidence file must exist on disk');
    const parsed = JSON.parse(onDisk);
    assert.equal(parsed.passed, false, 'disk evidence must be the duplicate-failure entry');
    assert.ok(parsed.failureReason?.includes('duplicate'), 'failure reason must mention duplicate');
  });
});

// ── validateOutcomesForDuplicateIds ──────────────────────────────────────────

describe('validateOutcomesForDuplicateIds', () => {
  it('returns empty array when all outcome ids are unique', () => {
    const outcomes: Outcome[] = [
      { id: 'a', tier: 'T1', description: 'a', command: 'echo a' },
      { id: 'b', tier: 'T2', description: 'b', command: 'echo b', required_callsite: 'src/b.ts' },
      { id: 'c', tier: 'T3', description: 'c', command: 'echo c', required_callsite: 'src/c.ts' },
    ];
    const errors = validateOutcomesForDuplicateIds(outcomes);
    assert.equal(errors.length, 0);
  });

  it('returns one error per duplicate id', () => {
    const outcomes: Outcome[] = [
      { id: 'dup', tier: 'T1', description: 'first dup', command: 'echo first' },
      { id: 'dup', tier: 'T2', description: 'second dup', command: 'echo second', required_callsite: 'src/x.ts' },
      { id: 'unique', tier: 'T1', description: 'unique', command: 'echo unique' },
    ];
    const errors = validateOutcomesForDuplicateIds(outcomes);
    assert.equal(errors.length, 1, 'one duplicate pair should produce exactly one error');
    assert.equal(errors[0]!.outcomeId, 'dup');
    assert.ok(errors[0]!.reason.includes('Duplicate'), 'error reason should identify the collision');
    assert.ok(errors[0]!.remedy, 'error should include a remedy');
  });

  it('handles multiple different duplicate ids independently', () => {
    const outcomes: Outcome[] = [
      { id: 'dup1', tier: 'T1', description: 'a', command: 'echo a' },
      { id: 'dup1', tier: 'T2', description: 'b', command: 'echo b', required_callsite: 'src/b.ts' },
      { id: 'dup2', tier: 'T1', description: 'c', command: 'echo c' },
      { id: 'dup2', tier: 'T2', description: 'd', command: 'echo d', required_callsite: 'src/d.ts' },
    ];
    const errors = validateOutcomesForDuplicateIds(outcomes);
    assert.equal(errors.length, 2, 'two distinct duplicate ids should each produce one error');
    const ids = errors.map(e => e.outcomeId).sort();
    assert.deepEqual(ids, ['dup1', 'dup2']);
  });

  it('returns empty array for an empty outcomes list', () => {
    const errors = validateOutcomesForDuplicateIds([]);
    assert.equal(errors.length, 0);
  });

  it('reports duplicate id correctly when it appears 3 times', () => {
    // The function emits one error per duplicate encounter (2nd, 3rd, etc.),
    // not just one error total.
    const outcomes: Outcome[] = [
      { id: 'triple', tier: 'T1', description: '1', command: 'echo 1' },
      { id: 'triple', tier: 'T1', description: '2', command: 'echo 2' },
      { id: 'triple', tier: 'T1', description: '3', command: 'echo 3' },
    ];
    const errors = validateOutcomesForDuplicateIds(outcomes);
    // 2nd and 3rd occurrences both produce errors
    assert.equal(errors.length, 2, 'three occurrences of the same id = two duplicate errors');
    assert.ok(errors.every(e => e.outcomeId === 'triple'));
  });
});
