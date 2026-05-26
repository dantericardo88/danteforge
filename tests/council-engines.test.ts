// Tests for the 3 council engine modules and adapter judge-mode capture.
// All tests use injection seams — no real subprocesses, no disk I/O.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EventEmitter } from 'node:events';

// ── FileClaims ────────────────────────────────────────────────────────────────

import { FileClaims } from '../src/matrix/engines/council-file-claims.js';

describe('FileClaims', () => {
  it('accepts first claim on a file', () => {
    const claims = new FileClaims();
    const result = claims.claim('codex', ['src/foo.ts', 'src/bar.ts']);
    assert.deepEqual(result.accepted, ['src/foo.ts', 'src/bar.ts']);
    assert.deepEqual(result.rejected, []);
    assert.deepEqual(result.conflicts, []);
  });

  it('rejects second claim by a different member on same file', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/foo.ts']);
    const result = claims.claim('grok-build', ['src/foo.ts', 'src/new.ts']);
    assert.deepEqual(result.accepted, ['src/new.ts']);
    assert.deepEqual(result.rejected, ['src/foo.ts']);
    assert.equal(result.conflicts[0]?.claimedBy, 'codex');
  });

  it('allows same member to re-claim their own file', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/foo.ts']);
    const result = claims.claim('codex', ['src/foo.ts']);
    assert.deepEqual(result.accepted, ['src/foo.ts']);
    assert.deepEqual(result.rejected, []);
  });

  it('hasConflict returns true when another member holds the file', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/foo.ts']);
    assert.equal(claims.hasConflict('grok-build', ['src/foo.ts']), true);
    assert.equal(claims.hasConflict('codex', ['src/foo.ts']), false);
  });

  it('clear() removes all claims', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/foo.ts']);
    claims.clear();
    assert.equal(claims.size, 0);
    const result = claims.claim('grok-build', ['src/foo.ts']);
    assert.deepEqual(result.accepted, ['src/foo.ts']);
  });

  it('snapshot() lists all current claims', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/a.ts']);
    claims.claim('gemini-cli', ['src/b.ts']);
    const snap = claims.snapshot();
    assert.equal(snap.length, 2);
    assert.ok(snap.some(s => s.memberId === 'codex' && s.file === 'src/a.ts'));
  });
});

// ── ConvergenceTracker ────────────────────────────────────────────────────────

import { ConvergenceTracker } from '../src/matrix/engines/council-convergence.js';

describe('ConvergenceTracker', () => {
  it('dim is not stuck after fewer than threshold attempts', () => {
    const tracker = new ConvergenceTracker(3);
    tracker.record('testing', false, 1);
    tracker.record('testing', false, 2);
    assert.equal(tracker.isStuck('testing'), false);
  });

  it('dim is stuck after threshold failed attempts', () => {
    const tracker = new ConvergenceTracker(3);
    tracker.record('testing', false, 1);
    tracker.record('testing', false, 2);
    tracker.record('testing', false, 3);
    assert.equal(tracker.isStuck('testing'), true);
  });

  it('approved dim is never stuck regardless of attempt count', () => {
    const tracker = new ConvergenceTracker(3);
    tracker.record('testing', false, 1);
    tracker.record('testing', false, 2);
    tracker.record('testing', true, 3);
    assert.equal(tracker.isStuck('testing'), false);
    assert.equal(tracker.getConvergedDims().length, 1);
  });

  it('pruneStuck removes stuck dims from a list', () => {
    const tracker = new ConvergenceTracker(2);
    tracker.record('dim_a', false, 1);
    tracker.record('dim_a', false, 2);
    tracker.record('dim_b', true, 1);
    const dims = [{ dimensionId: 'dim_a' }, { dimensionId: 'dim_b' }, { dimensionId: 'dim_c' }];
    const pruned = tracker.pruneStuck(dims);
    assert.equal(pruned.length, 2);
    assert.ok(!pruned.some(d => d.dimensionId === 'dim_a'));
  });

  it('isDone() true when all dims are converged or stuck', () => {
    const tracker = new ConvergenceTracker(2);
    tracker.record('dim_a', true, 1);
    tracker.record('dim_b', false, 1);
    tracker.record('dim_b', false, 2);
    assert.equal(tracker.isDone(), true);
  });

  it('isDone() false when some dims still in progress', () => {
    const tracker = new ConvergenceTracker(3);
    tracker.record('dim_a', true, 1);
    tracker.record('dim_b', false, 1);
    assert.equal(tracker.isDone(), false);
  });

  it('summarize() returns correct counts', () => {
    const tracker = new ConvergenceTracker(2);
    tracker.record('dim_a', true, 1);
    tracker.record('dim_b', false, 1);
    tracker.record('dim_b', false, 2);
    tracker.record('dim_c', false, 1);
    const s = tracker.summarize();
    assert.equal(s.converged, 1);
    assert.equal(s.stuck, 1);
    assert.equal(s.inProgress, 1);
    assert.equal(s.stuckDims[0]?.dimensionId, 'dim_b');
  });
});

// ── CouncilMemberProfiles ─────────────────────────────────────────────────────

import { profileScore, bestMemberForDim, COUNCIL_PROFILES } from '../src/matrix/engines/council-member-profiles.js';

describe('CouncilMemberProfiles', () => {
  it('profileScore returns 0 for a non-matching dim', () => {
    const score = profileScore(COUNCIL_PROFILES['codex'], 'unrelated_dimension', 'Unrelated Dimension');
    assert.equal(score, 0);
  });

  it('profileScore returns >0 for a matching dim', () => {
    const score = profileScore(COUNCIL_PROFILES['codex'], 'testing_coverage', 'Testing Coverage');
    assert.ok(score > 0, `expected positive score, got ${score}`);
  });

  it('gemini-cli profile matches documentation dims', () => {
    const score = profileScore(COUNCIL_PROFILES['gemini-cli'], 'documentation', 'Documentation Quality');
    assert.ok(score > 0);
  });

  it('grok-build profile matches autonomy dims', () => {
    const score = profileScore(COUNCIL_PROFILES['grok-build'], 'autonomy', 'Autonomy & Self-Healing');
    assert.ok(score > 0);
  });

  it('bestMemberForDim returns a member id from candidates', () => {
    const candidates: Parameters<typeof bestMemberForDim>[2] = ['codex', 'grok-build', 'gemini-cli'];
    const best = bestMemberForDim('testing', 'Testing Quality', candidates, 0);
    assert.ok(candidates.includes(best), `${best} not in candidates`);
  });

  it('bestMemberForDim routes testing to codex (highest keyword match)', () => {
    const candidates: Parameters<typeof bestMemberForDim>[2] = ['codex', 'grok-build', 'gemini-cli', 'claude-code'];
    const best = bestMemberForDim('testing', 'Testing Coverage and TDD', candidates, 0);
    assert.equal(best, 'codex');
  });

  it('bestMemberForDim routes documentation to gemini-cli', () => {
    const candidates: Parameters<typeof bestMemberForDim>[2] = ['codex', 'grok-build', 'gemini-cli', 'claude-code'];
    const best = bestMemberForDim('documentation', 'Documentation & Guides', candidates, 0);
    assert.equal(best, 'gemini-cli');
  });

  it('bestMemberForDim falls back to round-robin when no keyword matches', () => {
    const candidates: Parameters<typeof bestMemberForDim>[2] = ['codex', 'gemini-cli'];
    const best0 = bestMemberForDim('xyz_completely_unknown', 'XYZ', candidates, 0);
    const best1 = bestMemberForDim('xyz_completely_unknown', 'XYZ', candidates, 1);
    assert.equal(best0, 'codex');
    assert.equal(best1, 'gemini-cli');
  });
});

// ── Adapter judge-mode capture (injection seams, no real subprocess) ──────────

import { CodexAdapter } from '../src/matrix/adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../src/matrix/adapters/claude-code-adapter.js';
import type { WorkPacket } from '../src/matrix/types/work-graph.js';
import type { AgentLease } from '../src/matrix/types/lease.js';

function makePacket(): WorkPacket {
  return {
    id: 'test.judge', dimensionId: 'testing',
    objective: 'Evaluate test coverage',
    acceptanceCriteria: ['Tests pass'],
    proof: { proofRequired: ['test output'] },
    globalForbidden: [], context: {},
  } as unknown as WorkPacket;
}

function makeLease(cwd = '/tmp/test'): AgentLease {
  return {
    id: 'lease.judge', worktreePath: cwd,
    allowedWritePaths: ['**'], allowedReadPaths: ['**'], forbiddenPaths: [],
  } as unknown as AgentLease;
}

const VERDICT_OUTPUT = 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: code is real\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none';

/** Creates a fake child process that emits `output` to stdout then closes with code 0. */
function makeFakeProc(output: string) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter;
    kill: () => boolean; pid: number;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => true;
  proc.pid = 0;
  setImmediate(() => {
    proc.stdout.emit('data', Buffer.from(output));
    proc.emit('close', 0);
  });
  return proc;
}

describe('CodexAdapter — judge mode', () => {
  it('captures stdout as finalMessage when judgeMode:true', async () => {
    const adapter = new CodexAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _spawn: () => makeFakeProc(VERDICT_OUTPUT) as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.ok(result.finalMessage?.includes('VERDICT: PASS'), `finalMessage: ${result.finalMessage}`);
    assert.equal(result.status, 'completed');
  });

  it('calls _gitDiff in judge mode to detect rogue writes', async () => {
    let gitDiffCalled = false;
    const adapter = new CodexAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _gitDiff: async () => { gitDiffCalled = true; return []; },
      _spawn: () => makeFakeProc('VERDICT: PASS') as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    await adapter.collectResult(handle);
    assert.equal(gitDiffCalled, true, 'gitDiff MUST be called in judge mode to catch rogue writes');
  });

  it('invalidates verdict when Codex judge modifies worktree', async () => {
    const reverted: string[] = [];
    const adapter = new CodexAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _preJudgeDiff: async () => [],               // clean baseline before judge runs
      _gitDiff: async () => ['src/rogue-edit.ts'], // judge wrote this after baseline
      _revertFile: async (_cwd, file) => { reverted.push(file); },
      _spawn: () => makeFakeProc('VERDICT: PASS') as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'failed', 'rogue Codex judge must be failed');
    assert.ok(result.errorReason?.includes('judge_wrote_files'), `errorReason: ${result.errorReason}`);
    assert.ok(result.finalMessage?.includes('invalidated'), `finalMessage: ${result.finalMessage}`);
    assert.deepEqual(reverted, ['src/rogue-edit.ts']);
  });
});

describe('ClaudeCodeAdapter — judge mode', () => {
  it('captures stdout as finalMessage when judgeMode:true', async () => {
    const adapter = new ClaudeCodeAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _gitDiff: async () => [],  // no files modified — clean judge
      _spawn: () => makeFakeProc(VERDICT_OUTPUT) as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.ok(result.finalMessage?.includes('VERDICT: PASS'), `finalMessage: ${result.finalMessage}`);
    assert.equal(result.status, 'completed');
  });

  it('invalidates verdict when judge modifies worktree — post-run diff assert', async () => {
    const reverted: string[] = [];
    const adapter = new ClaudeCodeAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _preJudgeDiff: async () => [],                // clean baseline before judge runs
      _gitDiff: async () => ['src/rogue-edit.ts'],  // judge wrote this after baseline
      _revertFile: async (_cwd, file) => { reverted.push(file); },
      _spawn: () => makeFakeProc('VERDICT: PASS') as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'failed', 'rogue judge must be failed');
    assert.ok(result.errorReason?.includes('judge_wrote_files'), `errorReason: ${result.errorReason}`);
    assert.ok(result.finalMessage?.includes('invalidated'), `finalMessage: ${result.finalMessage}`);
    assert.deepEqual(reverted, ['src/rogue-edit.ts'], 'rogue file must be reverted');
  });
});

// ── GrokBuildAdapter judge-mode capture ──────────────────────────────────────

import { GrokBuildAdapter } from '../src/matrix/adapters/grok-build-adapter.js';

describe('GrokBuildAdapter — judge mode', () => {
  it('captures stdout as finalMessage when judgeMode:true', async () => {
    const adapter = new GrokBuildAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _gitDiff: async () => [],
      _spawn: () => makeFakeProc(VERDICT_OUTPUT) as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.ok(result.finalMessage?.includes('VERDICT: PASS'), `finalMessage: ${result.finalMessage}`);
    assert.equal(result.status, 'completed');
  });

  it('invalidates verdict when Grok judge modifies worktree', async () => {
    const reverted: string[] = [];
    const adapter = new GrokBuildAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _preJudgeDiff: async () => [],               // clean baseline before judge runs
      _gitDiff: async () => ['src/rogue-edit.ts'], // judge wrote this after baseline
      _revertFile: async (_cwd, file) => { reverted.push(file); },
      _spawn: () => makeFakeProc('VERDICT: PASS') as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'failed', 'rogue Grok judge must be failed');
    assert.ok(result.errorReason?.includes('judge_wrote_files'), `errorReason: ${result.errorReason}`);
    assert.ok(result.finalMessage?.includes('invalidated'), `finalMessage: ${result.finalMessage}`);
    assert.deepEqual(reverted, ['src/rogue-edit.ts']);
  });
});

// ── GeminiCLIAdapter judge-mode capture ──────────────────────────────────────

import { GeminiCLIAdapter } from '../src/matrix/adapters/gemini-cli-adapter.js';

describe('GeminiCLIAdapter — judge mode', () => {
  it('captures stdout as finalMessage when judgeMode:true', async () => {
    const adapter = new GeminiCLIAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _gitDiff: async () => [],
      _spawn: () => makeFakeProc(VERDICT_OUTPUT) as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.ok(result.finalMessage?.includes('VERDICT: PASS'), `finalMessage: ${result.finalMessage}`);
    assert.equal(result.status, 'completed');
  });

  it('invalidates verdict when Gemini judge modifies worktree', async () => {
    const reverted: string[] = [];
    const adapter = new GeminiCLIAdapter({
      workPacket: makePacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _preJudgeDiff: async () => [],               // clean baseline before judge runs
      _gitDiff: async () => ['src/rogue-edit.ts'], // judge wrote this after baseline
      _revertFile: async (_cwd, file) => { reverted.push(file); },
      _spawn: () => makeFakeProc('VERDICT: PASS') as never,
    });
    const prepared = await adapter.prepareRun({ lease: makeLease(), cwd: '/tmp/test' });
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'failed', 'rogue Gemini judge must be failed');
    assert.ok(result.errorReason?.includes('judge_wrote_files'), `errorReason: ${result.errorReason}`);
    assert.ok(result.finalMessage?.includes('invalidated'), `finalMessage: ${result.finalMessage}`);
    assert.deepEqual(reverted, ['src/rogue-edit.ts']);
  });
});
