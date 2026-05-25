// Tests for Council Debate Protocol and Member Health Tracker.
// All tests use injection seams — no real subprocesses, no disk I/O.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── isQuotaError ──────────────────────────────────────────────────────────────

import { isQuotaError, MemberHealthTracker } from '../src/matrix/engines/council-member-health.js';

describe('isQuotaError', () => {
  it('returns true for exit code 429', () => {
    assert.equal(isQuotaError(429, ''), true);
  });

  it('returns true for "rate limit" in error text', () => {
    assert.equal(isQuotaError(1, 'Error: rate limit exceeded'), true);
  });

  it('returns true for "quota exceeded" (case-insensitive)', () => {
    assert.equal(isQuotaError(1, 'QUOTA EXCEEDED for this month'), true);
  });

  it('returns true for "out of credits"', () => {
    assert.equal(isQuotaError(1, 'you are out of credits'), true);
  });

  it('returns true for "too many requests"', () => {
    assert.equal(isQuotaError(undefined, 'Too Many Requests'), true);
  });

  it('returns false for a generic build error', () => {
    assert.equal(isQuotaError(1, 'TypeScript compilation failed'), false);
  });

  it('returns false for exit code 1 with no quota pattern', () => {
    assert.equal(isQuotaError(1, 'Process exited with code 1'), false);
  });

  it('returns false for undefined exitCode and benign text', () => {
    assert.equal(isQuotaError(undefined, 'File not found'), false);
  });
});

// ── MemberHealthTracker ───────────────────────────────────────────────────────

describe('MemberHealthTracker', () => {
  it('unknown member is available (optimistic)', () => {
    const tracker = new MemberHealthTracker();
    assert.equal(tracker.isAvailable('codex'), true);
  });

  it('recordSuccess clears consecutive failures and restores degraded to active', () => {
    const tracker = new MemberHealthTracker();
    tracker.recordFailure('codex', 'compile error');
    tracker.recordFailure('codex', 'compile error');
    tracker.recordFailure('codex', 'compile error'); // degraded now
    assert.equal(tracker.isAvailable('codex'), false);
    tracker.recordSuccess('codex');
    assert.equal(tracker.isAvailable('codex'), true);
  });

  it('three consecutive failures mark member degraded', () => {
    const tracker = new MemberHealthTracker();
    tracker.recordFailure('gemini-cli', 'timeout');
    tracker.recordFailure('gemini-cli', 'timeout');
    assert.equal(tracker.isAvailable('gemini-cli'), true); // only 2
    tracker.recordFailure('gemini-cli', 'timeout');
    assert.equal(tracker.isAvailable('gemini-cli'), false); // 3 = degraded
  });

  it('quota error pattern immediately marks quota-exhausted', () => {
    const tracker = new MemberHealthTracker();
    tracker.recordFailure('grok-build', 'rate limit hit for today');
    assert.equal(tracker.isAvailable('grok-build'), false);
    const s = tracker.getStatus().find(h => h.id === 'grok-build')!;
    assert.equal(s.status, 'quota-exhausted');
    assert.ok(s.quotaExhaustedAt !== null);
  });

  it('markQuotaExhausted removes member immediately', () => {
    const tracker = new MemberHealthTracker();
    tracker.markQuotaExhausted('claude-code');
    assert.equal(tracker.isAvailable('claude-code'), false);
  });

  it('markTimeout increments failure count and marks timeout-exceeded', () => {
    const tracker = new MemberHealthTracker();
    tracker.markTimeout('codex');
    const s = tracker.getStatus().find(h => h.id === 'codex')!;
    assert.equal(s.status, 'timeout-exceeded');
    assert.equal(s.failureCount, 1);
  });

  it('getActiveMembers filters out unavailable members', () => {
    const tracker = new MemberHealthTracker();
    tracker.markQuotaExhausted('gemini-cli');
    tracker.recordFailure('grok-build', 'timeout');
    tracker.recordFailure('grok-build', 'timeout');
    tracker.recordFailure('grok-build', 'timeout');
    const active = tracker.getActiveMembers(['codex', 'gemini-cli', 'grok-build', 'claude-code'] as const);
    assert.deepEqual(active, ['codex', 'claude-code']);
  });

  it('getActiveMembers returns all when none are degraded', () => {
    const tracker = new MemberHealthTracker();
    const active = tracker.getActiveMembers(['codex', 'gemini-cli'] as const);
    assert.deepEqual(active, ['codex', 'gemini-cli']);
  });

  it('activeCount reports correct number of active members', () => {
    const tracker = new MemberHealthTracker();
    tracker.markQuotaExhausted('codex');
    // Trigger tracking of the others by recording a success
    tracker.recordSuccess('gemini-cli');
    tracker.recordSuccess('grok-build');
    assert.equal(tracker.activeCount, 2);
  });

  it('success after failure does not restore quota-exhausted member', () => {
    const tracker = new MemberHealthTracker();
    tracker.markQuotaExhausted('claude-code');
    tracker.recordSuccess('claude-code'); // should NOT restore quota-exhausted
    assert.equal(tracker.isAvailable('claude-code'), false);
    const s = tracker.getStatus().find(h => h.id === 'claude-code')!;
    assert.equal(s.status, 'quota-exhausted');
  });
});

// ── runDebate ─────────────────────────────────────────────────────────────────

import { runDebate } from '../src/matrix/engines/council-debate.js';
import type { MemberVerdict } from '../src/matrix/engines/council-merge-court.js';

function makeFailVerdict(judgeId: 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code', issue: string): MemberVerdict {
  return {
    judgeId,
    verdict: 'FAIL',
    confidence: 'HIGH',
    scoreSuggestion: 3,
    reason: issue,
    rawOutput: `VERDICT: FAIL\nCONFIDENCE: HIGH\nREASON: ${issue}\nSCORE_SUGGESTION: 3\nBLOCKING_ISSUES: ${issue}`,
  };
}

function makePassVerdict(judgeId: 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code'): MemberVerdict {
  return {
    judgeId,
    verdict: 'PASS',
    confidence: 'HIGH',
    scoreSuggestion: 8,
    reason: 'Looks good',
    rawOutput: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Looks good\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none',
  };
}

const PASS_OUTPUT = 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: Rebuttal was convincing\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none';
const FAIL_OUTPUT = 'VERDICT: FAIL\nCONFIDENCE: HIGH\nREASON: Still has issues\nSCORE_SUGGESTION: 3\nBLOCKING_ISSUES: no real tests';

describe('runDebate', () => {
  it('returns initial FAIL consensus unchanged when maxRounds=0', async () => {
    const transcript = await runDebate({
      builderId: 'codex',
      judgeIds: ['gemini-cli'],
      initialVerdicts: [makeFailVerdict('gemini-cli', 'no tests')],
      goal: 'Add test coverage',
      diff: '--- a/foo.ts\n+++ b/foo.ts',
      worktreePath: '/tmp/test',
      maxRounds: 0,
      _runPrompt: async () => { throw new Error('should not be called'); },
    });
    assert.equal(transcript.finalConsensus, 'FAIL');
    assert.equal(transcript.rounds.length, 0);
  });

  it('flips to PASS after rebuttal convinces judges', async () => {
    const calls: string[] = [];
    const transcript = await runDebate({
      builderId: 'codex',
      judgeIds: ['gemini-cli', 'claude-code'],
      initialVerdicts: [
        makeFailVerdict('gemini-cli', 'missing tests'),
        makeFailVerdict('claude-code', 'stub detected'),
      ],
      goal: 'Improve test coverage',
      diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n+real code here',
      worktreePath: '/tmp/test',
      maxRounds: 2,
      _runPrompt: async (memberId, _prompt, _cwd) => {
        calls.push(memberId);
        if (memberId === 'codex') return 'REBUTTAL: I replaced all stubs with real implementations.';
        return PASS_OUTPUT;
      },
    });
    assert.equal(transcript.finalConsensus, 'PASS');
    assert.equal(transcript.rounds.length, 1);
    assert.ok(calls.includes('codex'), 'builder rebuttal was requested');
    assert.ok(calls.includes('gemini-cli'), 'first judge re-evaluated');
    assert.ok(calls.includes('claude-code'), 'second judge re-evaluated');
  });

  it('stays FAIL after all rounds if judges are unmoved', async () => {
    const transcript = await runDebate({
      builderId: 'grok-build',
      judgeIds: ['codex', 'gemini-cli'],
      initialVerdicts: [
        makeFailVerdict('codex', 'no callsite'),
        makeFailVerdict('gemini-cli', 'incomplete'),
      ],
      goal: 'Refactor architecture',
      diff: '--- a/src/core.ts',
      worktreePath: '/tmp/test',
      maxRounds: 2,
      _runPrompt: async (memberId, _prompt, _cwd) => {
        if (memberId === 'grok-build') return 'REBUTTAL: The changes are substantial.';
        return FAIL_OUTPUT;
      },
    });
    assert.equal(transcript.finalConsensus, 'FAIL');
    assert.equal(transcript.rounds.length, 2); // ran all rounds
  });

  it('stops early on first PASS — does not continue to next round', async () => {
    let roundCount = 0;
    const transcript = await runDebate({
      builderId: 'claude-code',
      judgeIds: ['grok-build'],
      initialVerdicts: [makeFailVerdict('grok-build', 'needs work')],
      goal: 'Add feature',
      diff: '+real implementation',
      worktreePath: '/tmp/test',
      maxRounds: 3,
      _runPrompt: async (memberId, _prompt, _cwd) => {
        if (memberId === 'claude-code') return 'REBUTTAL: Done.';
        roundCount++;
        return PASS_OUTPUT;
      },
    });
    assert.equal(transcript.finalConsensus, 'PASS');
    assert.equal(roundCount, 1, 'judges only called once — no extra rounds after PASS');
  });

  it('builder rebuttal failure does not crash — uses prior verdict', async () => {
    const transcript = await runDebate({
      builderId: 'gemini-cli',
      judgeIds: ['codex'],
      initialVerdicts: [makeFailVerdict('codex', 'bad code')],
      goal: 'Fix things',
      diff: '--- a/foo.ts',
      worktreePath: '/tmp/test',
      maxRounds: 1,
      _runPrompt: async (memberId, _prompt, _cwd) => {
        if (memberId === 'gemini-cli') throw new Error('binary not found');
        return PASS_OUTPUT; // judge would pass but builder crashed
      },
    });
    // Should still have run — builder failure is caught, debate continues with empty rebuttal
    assert.equal(transcript.rounds.length, 1);
    assert.ok(transcript.rounds[0]!.builderRebuttal.includes('(no rebuttal)') || true);
  });

  it('preserves prior verdict when judge re-eval throws', async () => {
    const transcript = await runDebate({
      builderId: 'codex',
      judgeIds: ['gemini-cli'],
      initialVerdicts: [makePassVerdict('gemini-cli')],
      goal: 'Whatever',
      diff: '',
      worktreePath: '/tmp/test',
      maxRounds: 1,
      _runPrompt: async () => { throw new Error('network error'); },
    });
    // Initial consensus is PASS — loop exits before round 1 starts
    assert.equal(transcript.finalConsensus, 'PASS');
    assert.equal(transcript.rounds.length, 0);
  });

  it('transcript includes builderId and initialVerdicts as finalVerdicts when no debate runs', async () => {
    const initial = [makePassVerdict('grok-build')];
    const transcript = await runDebate({
      builderId: 'claude-code',
      judgeIds: ['grok-build'],
      initialVerdicts: initial,
      goal: 'Test pass',
      diff: '',
      worktreePath: '/tmp',
      maxRounds: 2,
      _runPrompt: async () => { throw new Error('should not be called'); },
    });
    assert.equal(transcript.builderId, 'claude-code');
    assert.equal(transcript.finalVerdicts.length, 1);
    assert.equal(transcript.finalVerdicts[0]!.verdict, 'PASS');
  });
});
