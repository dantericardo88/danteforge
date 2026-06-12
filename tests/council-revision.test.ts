// council-revision.test.ts — Tests for the revision-then-rejudge loop
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRevision } from '../src/matrix/engines/council-revision.js';
import type { RevisionOptions } from '../src/matrix/engines/council-revision.js';
import type { MemberVerdict } from '../src/matrix/engines/council-merge-court.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-council-revision-loop-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeVerdict(judgeId: 'grok-build' | 'codex', verdict: 'PASS' | 'FAIL' | 'UNCLEAR'): MemberVerdict {
  return {
    judgeId,
    verdict,
    confidence: 'MEDIUM',
    scoreSuggestion: verdict === 'PASS' ? 7 : 4,
    reason: verdict === 'PASS' ? 'Implementation looks correct' : 'Missing error handling and tests',
    blockingConcerns: verdict === 'FAIL' ? ['no error handling', 'no tests'] : [],
    dissentSummary: '',
    rawOutput: verdict === 'PASS'
      ? 'VERDICT: PASS\nCONFIDENCE: MEDIUM\nREASON: Implementation looks correct\nSCORE_SUGGESTION: 7\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none'
      : 'VERDICT: FAIL\nCONFIDENCE: MEDIUM\nREASON: Missing error handling and tests\nSCORE_SUGGESTION: 4\nBLOCKING_ISSUES:\n- no error handling\n- no tests\nBLOCKING_CONCERNS:\n- no error handling\nDISSENT: none',
  };
}

function makeBaseOpts(overrides?: Partial<RevisionOptions>): RevisionOptions {
  return {
    builderId: 'claude-code',
    judgeIds: ['grok-build', 'codex'],
    initialVerdicts: [makeVerdict('grok-build', 'PASS'), makeVerdict('codex', 'FAIL')],
    goal: 'Improve testing dimension coverage',
    diff: 'diff --git a/src/test.ts b/src/test.ts\n+export function newFn() {}',
    worktreePath: '/fake/worktree',
    worktreeOpts: { projectPath: '/fake/project' },
    maxCycles: 1,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runRevision', () => {
  it('returns PASS when judges approve revised diff', async () => {
    let builderCallCount = 0;
    let judgeCallCount = 0;

    const opts = makeBaseOpts({
      _makeBuilderAdapter: (_id, _wp) => ({
        id: 'fake-builder',
        name: 'FakeBuilder',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `fake-${++builderCallCount}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: ['src/test.ts'], commandsExecuted: [], provider: 'fake',
          finalMessage: 'SELF_ASSESSMENT: I will add error handling and tests as requested.',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
      _makeJudgeAdapter: (id, _wp) => ({
        id: 'fake-judge',
        name: 'FakeJudge',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `judge-${id}-${++judgeCallCount}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: [], commandsExecuted: [], provider: 'fake',
          finalMessage: `VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Revised implementation addresses concerns\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none`,
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
    });

    // Override captureWorktreeDiff indirectly by using a worktreeOpts with fake git
    const result = await runRevision({
      ...opts,
      worktreeOpts: {
        projectPath: '/fake/project',
        _git: {
          worktreeAdd: async () => undefined,
          worktreeRemove: async () => undefined,
          branchDelete: async () => undefined,
          getDiff: async () => 'diff --git a/src/test.ts b/src/test.ts\n+export function newFn() {}\n+// error handling added',
        },
      },
    });

    assert.equal(result.finalConsensus, 'PASS');
    assert.equal(result.cycles.length, 1);
    assert.equal(result.cycles[0]!.consensus, 'PASS');
    // Builder was called twice: self-inspect + revision
    assert.equal(builderCallCount, 2);
    // Both judges re-evaluated
    assert.equal(judgeCallCount, 2);
  });

  it('returns FAIL when judges still reject after revision', async () => {
    const opts = makeBaseOpts({
      _makeBuilderAdapter: (_id, _wp) => ({
        id: 'fake-builder', name: 'FakeBuilder',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `fake`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: [], commandsExecuted: [], provider: 'fake',
          finalMessage: 'SELF_ASSESSMENT: I tried but the issues persist.',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
      _makeJudgeAdapter: (id, _wp) => ({
        id: 'fake-judge', name: 'FakeJudge',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `judge-${id}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: [], commandsExecuted: [], provider: 'fake',
          finalMessage: 'VERDICT: FAIL\nCONFIDENCE: HIGH\nREASON: Still missing tests\nSCORE_SUGGESTION: 3\nBLOCKING_ISSUES:\n- no tests added\nBLOCKING_CONCERNS:\n- no tests added\nDISSENT: none',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
      worktreeOpts: {
        projectPath: '/fake/project',
        _git: {
          worktreeAdd: async () => undefined,
          worktreeRemove: async () => undefined,
          branchDelete: async () => undefined,
          getDiff: async () => 'diff --git a/src/test.ts b/src/test.ts\n+// minor comment',
        },
      },
    });

    const result = await runRevision(opts);

    assert.equal(result.finalConsensus, 'FAIL');
    assert.equal(result.cycles.length, 1);
    assert.equal(result.cycles[0]!.consensus, 'FAIL');
  });

  it('does not run additional cycles when first cycle reaches PASS', async () => {
    let builderCalls = 0;

    const opts = makeBaseOpts({
      maxCycles: 3,
      _makeBuilderAdapter: (_id, _wp) => ({
        id: 'fake-builder', name: 'FakeBuilder',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `fake-${++builderCalls}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: [], commandsExecuted: [], provider: 'fake', finalMessage: 'fixed',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
      _makeJudgeAdapter: (id, _wp) => ({
        id: 'fake-judge', name: 'FakeJudge',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `judge-${id}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: [], commandsExecuted: [], provider: 'fake',
          finalMessage: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Looks good\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
      worktreeOpts: {
        projectPath: '/fake/project',
        _git: {
          worktreeAdd: async () => undefined,
          worktreeRemove: async () => undefined,
          branchDelete: async () => undefined,
          getDiff: async () => 'diff --git a/src/test.ts b/src/test.ts\n+// fixed',
        },
      },
    });

    const result = await runRevision(opts);

    assert.equal(result.finalConsensus, 'PASS');
    // Only 1 cycle ran (not 3), because PASS was reached
    assert.equal(result.cycles.length, 1);
    // Builder called twice: self-inspect + revision (within the 1 cycle)
    assert.equal(builderCalls, 2);
  });

  it('returns initial verdicts when all verdicts already PASS', async () => {
    const passVerdicts = [makeVerdict('grok-build', 'PASS'), makeVerdict('codex', 'PASS')];
    let builderCalls = 0;

    const opts = makeBaseOpts({
      initialVerdicts: passVerdicts,
      _makeBuilderAdapter: (_id, _wp) => ({
        id: 'fake-builder', name: 'FakeBuilder',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `fake-${++builderCalls}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: [], commandsExecuted: [], provider: 'fake', finalMessage: 'ok',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
    });

    const result = await runRevision(opts);

    assert.equal(result.finalConsensus, 'PASS');
    assert.equal(result.cycles.length, 0);
    // Builder never called — no revision needed
    assert.equal(builderCalls, 0);
  });

  it('does not ask the builder to edit code for transient judge API failures', async () => {
    const initialVerdicts: MemberVerdict[] = [
      makeVerdict('grok-build', 'PASS'),
      {
        judgeId: 'codex',
        verdict: 'FAIL',
        confidence: 'LOW',
        scoreSuggestion: null,
        reason: 'API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
        blockingConcerns: [],
        dissentSummary: '',
        rawOutput: 'API Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
      },
    ];
    let builderCalls = 0;
    const rejudgePrompts: string[] = [];

    const result = await runRevision(makeBaseOpts({
      initialVerdicts,
      _makeBuilderAdapter: () => {
        builderCalls++;
        throw new Error('builder should not receive a write-lease for judge infrastructure failures');
      },
      _makeJudgeAdapter: (_id, wp) => {
        rejudgePrompts.push(wp.objective);
        return {
          id: 'fake-judge', name: 'FakeJudge',
          isAvailable: async () => true,
          prepareRun: async (input) => ({ ...input, prepared: true }),
          startRun: async (input) => ({ runId: `judge-${_id}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
          streamEvents: async function* () { /* empty */ },
          stopRun: async () => undefined,
          collectResult: async (handle) => ({
            runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
            filesChanged: [], commandsExecuted: [], provider: 'fake',
            finalMessage: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Prior failure was transient judge infrastructure; unchanged diff is acceptable\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none',
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
          }),
        };
      },
      worktreeOpts: {
        projectPath: '/fake/project',
        _git: {
          worktreeAdd: async () => undefined,
          worktreeRemove: async () => undefined,
          branchDelete: async () => undefined,
          getDiff: async () => 'diff --git a/src/test.ts b/src/test.ts\n+export function newFn() {}',
        },
      },
    }));

    assert.equal(builderCalls, 0);
    assert.equal(result.finalConsensus, 'PASS');
    assert.equal(result.cycles.length, 1);
    assert.equal(result.cycles[0]!.selfAssessment, '(revision skipped: blocking verdicts were judge infrastructure failures, not actionable code concerns)');
    assert.equal(rejudgePrompts.length, 2);
    assert.equal(rejudgePrompts.some(prompt => prompt.includes('RUNTIME PROOF COMMANDS')), true);
  });

  it('records runtime proof and a frontier receipt for revised council work', async () => {
    const worktreePath = await makeTempDir();
    let rejudgePrompt = '';

    const opts = makeBaseOpts({
      worktreePath,
      proofCommands: ['node -e "console.log(\'council revision runtime proof\')"'],
      _makeBuilderAdapter: (_id, _wp) => ({
        id: 'fake-builder',
        name: 'FakeBuilder',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: `fake`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: ['src/matrix/engines/council-revision.ts'], commandsExecuted: [], provider: 'fake',
          finalMessage: 'WHAT_WORKED: kept approvals\nWHAT_TO_FIX: add runtime proof\nFIX_PLAN: emit receipt',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
      _makeJudgeAdapter: (id, wp) => {
        rejudgePrompt = wp.objective;
        return {
          id: 'fake-judge',
          name: 'FakeJudge',
          isAvailable: async () => true,
          prepareRun: async (input) => ({ ...input, prepared: true }),
          startRun: async (input) => ({ runId: `judge-${id}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
          streamEvents: async function* () { /* empty */ },
          stopRun: async () => undefined,
          collectResult: async (handle) => ({
            runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
            filesChanged: [], commandsExecuted: [], provider: 'fake',
            finalMessage: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Runtime proof receipt addresses the blocker\nSCORE_SUGGESTION: 9\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none',
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
          }),
        };
      },
      worktreeOpts: {
        projectPath: worktreePath,
        _git: {
          worktreeAdd: async () => undefined,
          worktreeRemove: async () => undefined,
          branchDelete: async () => undefined,
          getDiff: async () => 'diff --git a/src/matrix/engines/council-revision.ts b/src/matrix/engines/council-revision.ts\n+receipt emitted',
        },
      },
    });

    const result = await runRevision(opts);

    assert.equal(result.finalConsensus, 'PASS');
    assert.equal(result.frontierReceipts.length, 1);
    assert.match(rejudgePrompt, /RUNTIME PROOF COMMANDS/);
    assert.match(rejudgePrompt, /council revision runtime proof/);
    const receipt = result.frontierReceipts[0]!;
    const parsed = JSON.parse(await fs.readFile(receipt.receiptPath, 'utf8')) as Record<string, unknown>;
    assert.equal(parsed.dimensionId, 'council-revision');
    assert.equal(parsed.timeMachineCommitId, receipt.timeMachineCommitId);
    assert.match(receipt.timeMachineCommitId, /^tm_/);
    await assert.doesNotReject(() =>
      fs.access(path.join(worktreePath, '.danteforge', 'time-machine', 'commits', `${receipt.timeMachineCommitId}.json`)));
  });

  it('excludes the builder from rejudging its own revision and anonymizes peer review context', async () => {
    const judgeCalls: string[] = [];
    const prompts: string[] = [];
    const initialVerdicts: MemberVerdict[] = [
      {
        judgeId: 'claude-code',
        verdict: 'FAIL',
        confidence: 'HIGH',
        scoreSuggestion: 2,
        reason: 'Builder self-review must not count',
        blockingConcerns: ['self review'],
        dissentSummary: '',
        rawOutput: 'VERDICT: FAIL\nREASON: Builder self-review must not count\nBLOCKING_ISSUES:\n- self review',
      },
      {
        judgeId: 'codex',
        verdict: 'FAIL',
        confidence: 'HIGH',
        scoreSuggestion: 4,
        reason: 'Needs anonymous peer review',
        blockingConcerns: ['identity leakage'],
        dissentSummary: '',
        rawOutput: 'VERDICT: FAIL\nREASON: Needs anonymous peer review\nBLOCKING_ISSUES:\n- identity leakage',
      },
    ];

    const result = await runRevision(makeBaseOpts({
      builderId: 'claude-code',
      judgeIds: ['claude-code', 'codex', 'grok-build'],
      initialVerdicts,
      _makeBuilderAdapter: () => ({
        id: 'fake-builder', name: 'FakeBuilder',
        isAvailable: async () => true,
        prepareRun: async (input) => ({ ...input, prepared: true }),
        startRun: async (input) => ({ runId: 'builder-run', leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
        streamEvents: async function* () { /* empty */ },
        stopRun: async () => undefined,
        collectResult: async (handle) => ({
          runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
          filesChanged: [], commandsExecuted: [], provider: 'fake',
          finalMessage: 'WHAT_TO_FIX: preserve anonymity and exclude builder judges',
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
        }),
      }),
      _makeJudgeAdapter: (id, wp) => {
        judgeCalls.push(id);
        prompts.push(wp.objective);
        return {
          id: 'fake-judge', name: 'FakeJudge',
          isAvailable: async () => true,
          prepareRun: async (input) => ({ ...input, prepared: true }),
          startRun: async (input) => ({ runId: `judge-${id}`, leaseId: input.lease.id, provider: 'fake', startedAt: new Date().toISOString() }),
          streamEvents: async function* () { /* empty */ },
          stopRun: async () => undefined,
          collectResult: async (handle) => ({
            runId: handle.runId, leaseId: handle.leaseId, status: 'completed',
            filesChanged: [], commandsExecuted: [], provider: 'fake',
            finalMessage: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Cross-member anonymous review passed\nSCORE_SUGGESTION: 9\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none',
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), events: [],
          }),
        };
      },
      worktreeOpts: {
        projectPath: '/fake/project',
        _git: {
          worktreeAdd: async () => undefined,
          worktreeRemove: async () => undefined,
          branchDelete: async () => undefined,
          getDiff: async () => 'diff --git a/src/matrix/engines/council-revision.ts b/src/matrix/engines/council-revision.ts\n+anonymous peer review',
        },
      },
    }));

    assert.equal(result.finalConsensus, 'PASS');
    assert.deepEqual(judgeCalls.sort(), ['codex', 'grok-build']);
    assert.equal(prompts.some(prompt => prompt.includes('[claude-code:')), false);
    assert.equal(prompts.some(prompt => prompt.includes('[codex:')), false);
    assert.equal(prompts.some(prompt => prompt.includes('Reviewer-')), true);
  });
});
