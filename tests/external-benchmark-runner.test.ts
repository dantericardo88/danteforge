// Phase 1b: external-benchmark outcomes run a REGISTERED suite + enforce min_pass_rate (not bare exit-0).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runExternalBenchmarkOutcome, parsePassRate, type ExternalBenchmarkDeps } from '../src/matrix/engines/external-benchmark-runner.js';
import type { ExternalBenchmarkOutcome } from '../src/matrix/types/outcome.js';

function outcome(over: Partial<ExternalBenchmarkOutcome> = {}): ExternalBenchmarkOutcome {
  return { id: 'o', kind: 'external-benchmark', tier: 'T8', benchmark: 'humaneval', min_pass_rate: 0.8, command: 'run-bench', ...over } as ExternalBenchmarkOutcome;
}
function spawnReturning(status: number, stdout = '', stderr = ''): ExternalBenchmarkDeps['_spawn'] {
  return () => ({ status, stdout, stderr });
}
const deps = (spawn: ExternalBenchmarkDeps['_spawn']): ExternalBenchmarkDeps => ({ _spawn: spawn, _readGitSha: async () => 'abc' });

describe('parsePassRate', () => {
  it('parses JSON, percent, N/M, and swe-bench "resolved" shapes; null when none', () => {
    assert.equal(parsePassRate('{"passRate":0.82}'), 0.82);
    assert.equal(parsePassRate('pass rate: 82%'), 0.82);
    assert.equal(Math.round(parsePassRate('41/50 passed')! * 100), 82);
    assert.equal(parsePassRate('resolved: 30/60'), 0.5);
    assert.equal(parsePassRate('the run finished'), null);
  });
});

describe('runExternalBenchmarkOutcome', () => {
  it('REJECTS an unregistered "benchmark" (cannot count as external grounding)', async () => {
    const e = await runExternalBenchmarkOutcome(outcome({ benchmark: 'my-totally-real-bench' }), 'd', '/x', deps(spawnReturning(0, '{"passRate":1.0}')));
    assert.equal(e.passed, false);
    assert.match(e.failureReason ?? '', /not a registered external suite/);
  });

  it('a registered suite with rate >= min_pass_rate PASSES', async () => {
    const e = await runExternalBenchmarkOutcome(outcome({ min_pass_rate: 0.8 }), 'd', '/x', deps(spawnReturning(0, 'pass rate: 85%')));
    assert.equal(e.passed, true);
  });

  it('a registered suite with rate BELOW min_pass_rate FAILS (the exit-0 shell hole closed)', async () => {
    const e = await runExternalBenchmarkOutcome(outcome({ min_pass_rate: 0.8 }), 'd', '/x', deps(spawnReturning(0, 'pass rate: 60%')));
    assert.equal(e.passed, false, 'exit 0 is not enough — the rate must meet min_pass_rate');
    assert.match(e.failureReason ?? '', /60.*<.*80/);
  });

  it('no parseable rate falls back to exit code (the command self-enforces)', async () => {
    const pass = await runExternalBenchmarkOutcome(outcome(), 'd', '/x', deps(spawnReturning(0, 'done, all good')));
    assert.equal(pass.passed, true);
    const fail = await runExternalBenchmarkOutcome(outcome(), 'd', '/x', deps(spawnReturning(1, 'threshold not met')));
    assert.equal(fail.passed, false);
  });

  it('stamps the dim/outcome ids, tier, gitSha, and a stdout tail', async () => {
    const e = await runExternalBenchmarkOutcome(outcome(), 'depth_doctrine', '/x', deps(spawnReturning(0, 'pass rate: 90%')));
    assert.equal(e.dimensionId, 'depth_doctrine');
    assert.equal(e.outcomeId, 'o');
    assert.equal(e.tier, 'T8');
    assert.equal(e.gitSha, 'abc');
    assert.match(e.stdoutTail, /pass rate: 90%/);
  });

  it('persists the parsed pass rate as a first-class field (the benchmark→score wire)', async () => {
    const e = await runExternalBenchmarkOutcome(outcome({ min_pass_rate: 0.05 }), 'd', '/x', deps(spawnReturning(0, '{"pass_rate": 0.12}')));
    assert.equal(e.passed, true);
    assert.equal(e.passRate, 0.12, 'rate is stored structurally, not only in stdoutTail');
    // null when the command prints no recognizable rate (then `passed` falls back to the exit code)
    const noRate = await runExternalBenchmarkOutcome(outcome(), 'd', '/x', deps(spawnReturning(0, 'done')));
    assert.equal(noRate.passRate, null);
  });

  // CH-036 wire: swe-bench-live (contamination-resistant) is a registered suite, and the runner consumes
  // the LIVE grader's own output shapes — `resolved N/5` and `{"pass_rate":..}` — to mint an HONEST receipt.
  it('accepts swe-bench-live and mints an HONEST FAILED receipt from the real 0/5 Live output', async () => {
    const liveOut = 'SWE-bench-Live grader (contamination-resistant): resolved 0/5\n{"pass_rate":0,"resolved":0,"total":5}';
    const e = await runExternalBenchmarkOutcome(
      outcome({ benchmark: 'swe-bench-live', min_pass_rate: 0.1, command: 'node scripts/run-swebench-grounding.mjs --dataset live' }),
      'code_generation', '/x', deps(spawnReturning(0, liveOut)),
    );
    assert.equal(e.passed, false, '0/5 must FAIL — exit 0 is not enough; the parsed rate (0) is below min_pass_rate');
    assert.match(e.failureReason ?? '', /swe-bench-live pass rate 0\.0% < required min_pass_rate 10\.0%/);
  });

  it('swe-bench-live PASSES once the resolve rate meets the bar (the climb target is reachable)', async () => {
    const e = await runExternalBenchmarkOutcome(
      outcome({ benchmark: 'swe-bench-live', min_pass_rate: 0.1 }),
      'code_generation', '/x', deps(spawnReturning(0, 'resolved 3/5')),
    );
    assert.equal(e.passed, true, '3/5 = 60% ≥ 10% min — a non-zero climb produces a passing grounded receipt');
  });
});
