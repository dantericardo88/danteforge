import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConsensus,
  assignVoteWeight,
  type WeightedVote,
} from '../src/matrix/engines/council-consensus.js';

function makeVote(
  overrides: Partial<WeightedVote> & Pick<WeightedVote, 'verdict' | 'judgeMemberId' | 'builderMemberId'>,
): WeightedVote {
  return {
    judgeSlotId: `${overrides.judgeMemberId}-0`,
    weight: assignVoteWeight(overrides.judgeMemberId, overrides.builderMemberId),
    confidence: 'HIGH',
    reason: 'test',
    dissentSummary: '',
    ...overrides,
  };
}

describe('assignVoteWeight', () => {
  test('cross-member judge → 1.0', () => {
    assert.equal(assignVoteWeight('codex', 'claude-code'), 1.0);
    assert.equal(assignVoteWeight('grok-build', 'codex'), 1.0);
  });

  test('same-member judge → 0.5', () => {
    assert.equal(assignVoteWeight('codex', 'codex'), 0.5);
    assert.equal(assignVoteWeight('claude-code', 'claude-code'), 0.5);
  });
});

describe('computeConsensus', () => {
  test('two PASS votes → PASS', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'PASS');
    assert.ok(r.weightedScore >= 0.5);
    assert.ok(r.crossMemberJudges >= 1);
  });

  test('PASS + FAIL tie → SPLIT (not PASS)', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'FAIL', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.notEqual(r.verdict, 'PASS');
  });

  test('two FAIL votes → FAIL', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'FAIL', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'FAIL', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'FAIL');
  });

  test('empty votes with minJudges:2 → INSUFFICIENT', () => {
    const r = computeConsensus([], { minJudges: 2 });
    assert.equal(r.verdict, 'INSUFFICIENT');
    assert.equal(r.minJudgesMet, false);
  });

  test('single vote with minJudges:2 → INSUFFICIENT', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'INSUFFICIENT');
  });

  test('same-member votes do not satisfy N-of-M cross-member judge quorum', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'codex' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'grok-build', builderMemberId: 'codex' }),
    ];

    const r = computeConsensus(votes, { minJudges: 2 });

    assert.equal(r.crossMemberJudges, 1);
    assert.equal(r.minJudgesMet, false);
    assert.equal(r.verdict, 'INSUFFICIENT');
  });

  test('two cross-member votes satisfy N-of-M consensus quorum', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'grok-build', builderMemberId: 'codex' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'claude-code', builderMemberId: 'codex' }),
    ];

    const r = computeConsensus(votes, { minJudges: 2 });

    assert.equal(r.crossMemberJudges, 2);
    assert.equal(r.verdict, 'PASS');
  });

  test('UNCLEAR votes do not count as PASS', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.notEqual(r.verdict, 'PASS');
  });

  test('1 PASS + 1 UNCLEAR (50% abstain) → PASS — 50% is not a majority', () => {
    // Exactly 50% abstention is NOT UNCLEAR-dominant (majority requires >50%).
    // This handles the operational case where one judge is unavailable (API 403)
    // but the other real judge gave a clear PASS.
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'PASS');
  });

  test('UNCLEAR-dominant: 2 PASS + 3 UNCLEAR (60% abstain) → FAIL', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'gemini-cli', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'FAIL');
    assert.ok(r.summary.includes('UNCLEAR-dominant'));
  });

  test('UNCLEAR-dominant: 2 UNCLEAR → FAIL with summary', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'FAIL');
    assert.ok(r.summary.includes('2/2'));
  });

  test('UNCLEAR minority: 2 PASS + 1 UNCLEAR → PASS (not blocked)', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'PASS');
  });

  test('PASS without any cross-member judge → FAIL (no cross-member PASS)', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'claude-code', builderMemberId: 'claude-code', weight: 0.5 }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'claude-code', builderMemberId: 'claude-code', weight: 0.5 }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.crossMemberJudges, 0);
    assert.notEqual(r.verdict, 'PASS');
  });

  test('dissent is preserved in dissentLog even on PASS', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code', dissentSummary: 'minor concern' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.dissentLog.length, 1);
    assert.ok(r.dissentLog[0]!.includes('minor concern'));
  });

  test('summary string is non-empty', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'grok-build' }),
      makeVote({ verdict: 'FAIL', judgeMemberId: 'claude-code', builderMemberId: 'grok-build' }),
    ];
    const r = computeConsensus(votes, { minJudges: 2 });
    assert.ok(r.summary.length > 0);
  });

  test('custom passFraction: 2 PASS + 1 FAIL with passFraction 0.6 → PASS (0.667 >= 0.6)', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'FAIL', judgeMemberId: 'codex', builderMemberId: 'claude-code', weight: 1.0 }),
    ];
    const r = computeConsensus(votes, { minJudges: 2, passFraction: 0.6 });
    assert.equal(r.verdict, 'PASS');
    assert.ok(r.weightedScore >= 0.6);
  });

  test('minJudges:1 single cross-member PASS → PASS', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 1 });
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.minJudgesMet, true);
  });

  test('explicit N-of-M threshold blocks one PASS plus abstention when two PASS votes are required', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'FAIL', judgeMemberId: 'gemini-cli', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 3, minPasses: 2 });
    assert.equal(r.verdict, 'FAIL');
    assert.equal(r.passVotes, 1);
    assert.equal(r.requiredPassVotes, 2);
    assert.match(r.summary, /1\/2 PASS votes/);
  });

  test('explicit N-of-M threshold passes when enough cross-member judges vote PASS', () => {
    const votes: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'codex', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'PASS', judgeMemberId: 'grok-build', builderMemberId: 'claude-code' }),
      makeVote({ verdict: 'FAIL', judgeMemberId: 'gemini-cli', builderMemberId: 'claude-code' }),
    ];
    const r = computeConsensus(votes, { minJudges: 3, minPasses: 2 });
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.passVotes, 2);
    assert.equal(r.requiredPassVotes, 2);
  });
});
