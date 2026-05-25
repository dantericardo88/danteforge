// Tests for CouncilDebate engine:
//   - Round structure (rebuttal + judge re-eval)
//   - Consensus resolution from judge verdicts
//   - Early exit on PASS consensus
//   - Fallback verdict on runPrompt error
//   - Transcript shape (rounds, finalVerdicts, finalConsensus)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runDebate } from '../src/matrix/engines/council-debate.js';
import type { MemberVerdict } from '../src/matrix/engines/council-merge-court.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeVerdict(
  judgeId: 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code',
  verdict: 'PASS' | 'FAIL' | 'UNCLEAR',
): MemberVerdict {
  return {
    judgeId,
    verdict,
    confidence: 'HIGH',
    scoreSuggestion: verdict === 'PASS' ? 8 : 3,
    reason: `Test reason for ${judgeId}`,
    blockingConcerns: verdict === 'FAIL' ? ['Missing error handling'] : [],
    dissentSummary: '',
    rawOutput: `VERDICT: ${verdict}\nCONFIDENCE: HIGH\nREASON: test\nSCORE_SUGGESTION: ${verdict === 'PASS' ? 8 : 3}\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none`,
  };
}

const STUB_REBUTTAL = 'REBUTTAL: The implementation correctly handles all edge cases.';

function makePassRunPrompt() {
  return async (_memberId: string, _prompt: string, _cwd: string): Promise<string> => {
    return [
      'VERDICT: PASS',
      'CONFIDENCE: HIGH',
      'REASON: Builder addressed all concerns.',
      'SCORE_SUGGESTION: 8',
      'BLOCKING_ISSUES: none',
      'BLOCKING_CONCERNS: none',
      'DISSENT: none',
    ].join('\n');
  };
}

function makeFailRunPrompt() {
  return async (_memberId: string, prompt: string, _cwd: string): Promise<string> => {
    if (prompt.includes('BUILDER REBUTTAL')) return STUB_REBUTTAL;
    return [
      'VERDICT: FAIL',
      'CONFIDENCE: MEDIUM',
      'REASON: Issues remain.',
      'SCORE_SUGGESTION: 4',
      'BLOCKING_ISSUES: Missing tests',
      'BLOCKING_CONCERNS:\n- No coverage for edge cases',
      'DISSENT: none',
    ].join('\n');
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runDebate — consensus resolution', () => {
  it('returns PASS immediately if initial verdicts are already PASS', async () => {
    const transcript = await runDebate({
      builderId: 'claude-code',
      judgeIds: ['codex', 'grok-build'],
      initialVerdicts: [makeVerdict('codex', 'PASS'), makeVerdict('grok-build', 'PASS')],
      goal: 'Implement council debate',
      diff: 'diff --git a/src/debate.ts ...',
      worktreePath: process.cwd(),
      maxRounds: 2,
      _runPrompt: makePassRunPrompt(),
    });

    assert.equal(transcript.finalConsensus, 'PASS');
    assert.equal(transcript.rounds.length, 0, 'Should skip all rounds when already PASS');
  });

  it('runs one round and reaches PASS if judges flip', async () => {
    const transcript = await runDebate({
      builderId: 'claude-code',
      judgeIds: ['codex', 'grok-build'],
      initialVerdicts: [makeVerdict('codex', 'FAIL'), makeVerdict('grok-build', 'FAIL')],
      goal: 'Implement council session state',
      diff: 'diff --git a/src/council-session-state.ts ...',
      worktreePath: process.cwd(),
      maxRounds: 2,
      _runPrompt: makePassRunPrompt(),
    });

    assert.equal(transcript.finalConsensus, 'PASS');
    assert.equal(transcript.rounds.length, 1, 'Should stop after round 1 when PASS is reached');
    assert.equal(transcript.rounds[0]!.consensus, 'PASS');
  });

  it('runs all rounds and returns FAIL if judges never flip', async () => {
    const transcript = await runDebate({
      builderId: 'claude-code',
      judgeIds: ['codex', 'grok-build'],
      initialVerdicts: [makeVerdict('codex', 'FAIL'), makeVerdict('grok-build', 'FAIL')],
      goal: 'Implement something',
      diff: 'diff ...',
      worktreePath: process.cwd(),
      maxRounds: 2,
      _runPrompt: makeFailRunPrompt(),
    });

    assert.equal(transcript.finalConsensus, 'FAIL');
    assert.equal(transcript.rounds.length, 2, 'Should run all maxRounds when PASS not reached');
  });
});

describe('runDebate — transcript shape', () => {
  it('transcript has correct builderId and round structure', async () => {
    const transcript = await runDebate({
      builderId: 'codex',
      judgeIds: ['claude-code', 'gemini-cli'],
      initialVerdicts: [makeVerdict('claude-code', 'FAIL'), makeVerdict('gemini-cli', 'FAIL')],
      goal: 'Test transcript shape',
      diff: 'diff ...',
      worktreePath: process.cwd(),
      maxRounds: 1,
      _runPrompt: makePassRunPrompt(),
    });

    assert.equal(transcript.builderId, 'codex');
    assert.equal(transcript.rounds.length, 1);
    const round = transcript.rounds[0]!;
    assert.equal(typeof round.builderRebuttal, 'string');
    assert.equal(round.judgeUpdates.length, 2);
    assert.ok(round.judgeUpdates.every(v => typeof v.verdict === 'string'));
  });

  it('each round carries judgeUpdates with blockingConcerns and dissentSummary', async () => {
    const transcript = await runDebate({
      builderId: 'grok-build',
      judgeIds: ['codex'],
      initialVerdicts: [makeVerdict('codex', 'FAIL')],
      goal: 'Test verdict fields',
      diff: 'diff ...',
      worktreePath: process.cwd(),
      maxRounds: 1,
      _runPrompt: makePassRunPrompt(),
    });

    const update = transcript.finalVerdicts[0]!;
    assert.ok(Array.isArray(update.blockingConcerns), 'blockingConcerns should be an array');
    assert.equal(typeof update.dissentSummary, 'string', 'dissentSummary should be a string');
  });
});

describe('runDebate — error resilience', () => {
  it('falls back to prior verdict if runPrompt throws for a judge', async () => {
    let callCount = 0;
    const flakyRunPrompt = async (memberId: string, _prompt: string, _cwd: string): Promise<string> => {
      callCount++;
      if (memberId === 'claude-code') return STUB_REBUTTAL;
      throw new Error('Simulated judge failure');
    };

    const initial = [makeVerdict('codex', 'FAIL')];
    const transcript = await runDebate({
      builderId: 'claude-code',
      judgeIds: ['codex'],
      initialVerdicts: initial,
      goal: 'Test error resilience',
      diff: 'diff ...',
      worktreePath: process.cwd(),
      maxRounds: 1,
      _runPrompt: flakyRunPrompt,
    });

    // Should have run (callCount > 0) and returned a transcript without crashing
    assert.ok(callCount > 0);
    assert.equal(transcript.rounds.length, 1);
    // Fallback: prior verdict preserved
    const fallbackVerdict = transcript.finalVerdicts[0]!;
    assert.equal(fallbackVerdict.judgeId, 'codex');
  });
});
