// Tests for Fix A: capability_test gate
// Verifies: types, runner, score cap enforcement, and CLI verification path.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCapabilityTest,
  runCapabilityTests,
  applyScoreCap,
} from '../src/matrix/engines/capability-test-runner.js';
import {
  isCapabilityTestSpec,
  isNoCapabilityTest,
  CAPABILITY_TEST_SCORE_CAP,
} from '../src/matrix/types/capability-test.js';
import type { CapabilityTestEntry } from '../src/matrix/types/capability-test.js';
import { runMergeCourt } from '../src/matrix/courts/merge-court.js';
import type { MergeCourtInput, RunMergeCourtOptions } from '../src/matrix/courts/merge-court.js';
import type { CapabilityTestVerdict } from '../src/matrix/engines/capability-test-runner.js';

// ── Type guard tests ─────────────────────────────────────────────────────────

describe('CapabilityTest type guards', () => {
  it('isCapabilityTestSpec: accepts valid spec', () => {
    const spec: CapabilityTestEntry = { command: 'echo ok', description: 'test' };
    assert.ok(isCapabilityTestSpec(spec));
  });

  it('isCapabilityTestSpec: rejects marker', () => {
    const marker: CapabilityTestEntry = { no_capability_test: true, reason: 'n/a' };
    assert.ok(!isCapabilityTestSpec(marker));
  });

  it('isNoCapabilityTest: accepts marker', () => {
    const marker: CapabilityTestEntry = { no_capability_test: true, reason: 'live API required' };
    assert.ok(isNoCapabilityTest(marker));
  });

  it('isNoCapabilityTest: rejects spec', () => {
    const spec: CapabilityTestEntry = { command: 'echo ok', description: 'test' };
    assert.ok(!isNoCapabilityTest(spec));
  });

  it('CAPABILITY_TEST_SCORE_CAP is 5.0', () => {
    assert.strictEqual(CAPABILITY_TEST_SCORE_CAP, 5.0);
  });
});

// ── Runner tests ─────────────────────────────────────────────────────────────

describe('runCapabilityTest', () => {
  const passingSpawn = () => ({ status: 0, stdout: 'ok', stderr: '' });
  const failingSpawn = () => ({ status: 1, stdout: '', stderr: 'error' });

  it('a REAL product run that exits 0 earns the full 10 (grading-integrity #1)', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'planning_quality',
      capabilityTest: { command: 'node dist/index.js plan "build a thing"', description: 'real product run' },
      _spawnSync: passingSpawn,
    });
    assert.ok(verdict.allowed);
    assert.strictEqual(verdict.scoreCap, 10);
    assert.ok(verdict.result?.passed);
  });

  it('a passing TEST SUITE proves wiring, not capability → capped at 7.0, not 10 (grading-integrity #1)', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'testing',
      capabilityTest: { command: 'npm test', description: 'run tests' },
      _spawnSync: passingSpawn,
    });
    assert.ok(verdict.allowed, 'a passing test suite still permits scores above 5.0…');
    assert.strictEqual(verdict.scoreCap, 7.0, '…but only up to the structural ceiling, never 10');
  });

  it('a --help reachability PROXY that exits 0 is capped at 7.0, never 10 (the #1 inflation vector)', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'depth_doctrine',
      capabilityTest: { command: 'node dist/index.js validate --help && node dist/index.js gap --help', description: 'tooling reachable' },
      _spawnSync: passingSpawn,
    });
    assert.ok(verdict.allowed);
    assert.strictEqual(verdict.scoreCap, 7.0, 'a usage banner cannot certify a 9');
    assert.match(verdict.reason, /reachability|wired|proves/i);
  });

  it('a GREEN-FORCING wrapper that exits 0 measures nothing → capped at 5.0, not allowed above (grading-integrity #1)', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'rigged_dim',
      capabilityTest: { command: 'node dist/index.js plan x || true', description: 'rigged' },
      _spawnSync: passingSpawn,
    });
    assert.ok(!verdict.allowed, 'a rigged pass must not authorize scores above 5.0');
    assert.strictEqual(verdict.scoreCap, CAPABILITY_TEST_SCORE_CAP);
  });

  it('returns allowed=false when spawn exits 1', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'testing',
      capabilityTest: { command: 'npm test', description: 'run tests' },
      _spawnSync: failingSpawn,
    });
    assert.ok(!verdict.allowed);
    assert.strictEqual(verdict.scoreCap, CAPABILITY_TEST_SCORE_CAP);
    assert.ok(!verdict.result?.passed);
  });

  it('returns capped verdict when capability_test is undefined', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'ghost_text',
      capabilityTest: undefined,
    });
    assert.ok(!verdict.allowed);
    assert.strictEqual(verdict.scoreCap, CAPABILITY_TEST_SCORE_CAP);
    assert.ok(verdict.reason.includes('No capability_test'));
  });

  it('returns capped verdict for no_capability_test marker', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'token_economy',
      capabilityTest: { no_capability_test: true, reason: 'requires live LLM' },
    });
    assert.ok(!verdict.allowed);
    assert.strictEqual(verdict.scoreCap, CAPABILITY_TEST_SCORE_CAP);
    assert.ok(verdict.reason.includes('requires live LLM') || verdict.reason.includes('no_capability_test'));
  });

  it('returns capped verdict for malformed capability_test', () => {
    const verdict = runCapabilityTest({
      dimensionId: 'bad_dim',
      capabilityTest: { command: 123 } as unknown as CapabilityTestEntry,
    });
    assert.ok(!verdict.allowed);
    assert.strictEqual(verdict.scoreCap, CAPABILITY_TEST_SCORE_CAP);
  });
});

// ── applyScoreCap tests ──────────────────────────────────────────────────────

describe('applyScoreCap', () => {
  it('returns score unchanged when allowed', () => {
    const verdict: CapabilityTestVerdict = {
      dimensionId: 'd', allowed: true, scoreCap: 10, reason: 'pass',
    };
    assert.strictEqual(applyScoreCap(8.5, verdict), 8.5);
  });

  it('clamps score to scoreCap when not allowed', () => {
    const verdict: CapabilityTestVerdict = {
      dimensionId: 'd', allowed: false, scoreCap: CAPABILITY_TEST_SCORE_CAP, reason: 'fail',
    };
    assert.strictEqual(applyScoreCap(8.5, verdict), CAPABILITY_TEST_SCORE_CAP);
    assert.strictEqual(applyScoreCap(5.0, verdict), 5.0);
    assert.strictEqual(applyScoreCap(4.0, verdict), 4.0);
  });
});

// ── runCapabilityTests batch tests ───────────────────────────────────────────

describe('runCapabilityTests batch', () => {
  it('returns one verdict per entry', () => {
    const passSpawn = () => ({ status: 0, stdout: '', stderr: '' });
    const failSpawn = () => ({ status: 1, stdout: '', stderr: '' });
    const entries = [
      { dimensionId: 'a', capabilityTest: { command: 'echo', description: 'd' } as CapabilityTestEntry },
      { dimensionId: 'b', capabilityTest: undefined },
    ];
    const [va, vb] = runCapabilityTests(entries, process.cwd(), passSpawn);
    assert.ok(va.allowed);
    assert.ok(!vb.allowed);
    void failSpawn; // referenced to satisfy lint
  });
});

// ── Merge court capability gate tests ────────────────────────────────────────

describe('Merge court capability gate', () => {
  function buildInput(
    scoreDeltaAfter: number,
    capabilityPassed: boolean,
  ): { input: MergeCourtInput; opts: RunMergeCourtOptions } {
    const input: MergeCourtInput = {
      candidate: {
        candidateId: 'c1',
        leaseId: 'l1',
        workPacketId: 'wp1',
        branch: 'matrix/testing/fake-abc',
        gateReportId: 'gr1',
        filesChanged: ['src/core/feature.ts'],
        scoreDelta: { dimensionId: 'testing', before: 5.0, after: scoreDeltaAfter },
      },
      lease: {
        id: 'l1', workPacketId: 'wp1', provider: 'fake', agentRole: 'dimension-engineer',
        branch: 'matrix/testing/fake-abc', worktreePath: '/tmp/wt1',
        allowedWritePaths: ['src/'], allowedReadPaths: [], forbiddenPaths: [],
        requiredCommands: [], budget: { maxTokens: 100, maxRuntimeMinutes: 30, maxIterations: 5 },
        status: 'completed',
      },
      workPacket: {
        id: 'wp1', title: 'Close testing', objective: 'Improve testing', dimensionId: 'testing',
        paths: { ownedPaths: ['src/'], readOnlyPaths: [], forbiddenPaths: [] },
        dependsOn: [], mayConflictWith: [],
        acceptanceCriteria: ['tests pass'], proof: { proofRequired: ['typecheck'] },
        tasteGateRequired: false, redTeamRequired: false,
        rollbackPlan: 'discard', riskLevel: 'low', createdAt: new Date().toISOString(),
      },
      gateReport: { id: 'gr1', leaseId: 'l1', workPacketId: 'wp1', status: 'passed', checks: [], createdAt: new Date().toISOString() },
      capabilityTest: { command: 'npm test', description: 'run tests' },
    };

    const capVerdict: CapabilityTestVerdict = {
      dimensionId: 'testing',
      allowed: capabilityPassed,
      scoreCap: capabilityPassed ? 10 : CAPABILITY_TEST_SCORE_CAP,
      reason: capabilityPassed ? 'capability_test passed' : 'capability_test failed',
    };

    const opts: RunMergeCourtOptions = {
      candidates: [input],
      conflictReport: { generatedAt: new Date().toISOString(), conflicts: [] },
      _runMerge: async () => ({ success: true }),
      _createTimeMachineCommit: async () => ({ eventId: 'tm.test.1' }),
      _checkLocViolations: async () => [],
      _runSecurityCourt: async () => ({ recommendation: 'allow_merge', blockedBy: [], criticalCount: 0 }),
      _runCapabilityTest: () => capVerdict,
      _now: () => new Date().toISOString(),
    };

    return { input, opts };
  }

  it('blocks score > 5.0 when capability_test fails', async () => {
    const { opts } = buildInput(8.5, false);
    const result = await runMergeCourt(opts);
    assert.strictEqual(result.decisions.length, 1);
    const d = result.decisions[0];
    assert.ok(
      d.decision === 'BLOCKED_BY_POLICY' || d.decision === 'REJECTED',
      `expected BLOCKED_BY_POLICY or REJECTED, got ${d.decision}`,
    );
    assert.ok(d.reason.includes('capability_test') || d.reason.includes('5'), d.reason);
  });

  it('allows score > 5.0 when capability_test passes', async () => {
    const { opts } = buildInput(8.5, true);
    const result = await runMergeCourt(opts);
    assert.strictEqual(result.decisions.length, 1);
    assert.strictEqual(result.decisions[0].decision, 'APPROVED');
  });

  it('allows score <= 5.0 even when capability_test fails', async () => {
    const { opts } = buildInput(4.5, false);
    const result = await runMergeCourt(opts);
    assert.strictEqual(result.decisions.length, 1);
    assert.strictEqual(result.decisions[0].decision, 'APPROVED');
  });
});
