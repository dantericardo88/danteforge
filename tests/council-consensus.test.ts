import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConsensus,
  assignVoteWeight,
  type WeightedVote,
} from '../src/matrix/engines/council-consensus.js';
import { resolveEffectiveMinJudges } from '../src/matrix/engines/council-member-health.js';

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

// Regression: "council --parallel merged nothing (Grok out of credits)".
// When a member goes out of credits mid-session, the live pool shrinks. The merge
// court must shrink min-judges to match the live pool, otherwise every candidate is
// unmergeable and the drive stalls (the bug behind the AskUserQuestion dialog).
describe('resolveEffectiveMinJudges — quorum adapts to live pool', () => {
  test('full 3-member pool keeps min-judges 2 (no behavior change)', () => {
    assert.equal(resolveEffectiveMinJudges(3, 2), 2);
  });

  test('Grok dies → 2 live members → min-judges drops 2 → 1 (council still merges)', () => {
    // The exact screenshot scenario: codex + claude-code remain after grok-build
    // exhausts credits. With min-judges fixed at 2, each candidate has only 1 possible
    // cross-member judge → INSUFFICIENT forever. Shrinking to 1 unblocks consensus.
    assert.equal(resolveEffectiveMinJudges(2, 2), 1);
  });

  test('1 live member → floored at 1 (never 0)', () => {
    assert.equal(resolveEffectiveMinJudges(1, 2), 1);
  });

  test('never raises the requested quorum (4 live, asked for 2 → 2)', () => {
    assert.equal(resolveEffectiveMinJudges(4, 2), 2);
  });

  test('degraded-quorum merges CARRY the fact (self-challenge #4 pin)', async () => {
    const { markDegradedQuorumMerges } = await import('../src/matrix/engines/council-member-health.js');
    const results = [
      { merged: true, memberId: 'codex', slotId: 'codex-0', dissentLog: [] as string[] },
      { merged: false, memberId: 'claude-code', slotId: 'claude-0', dissentLog: [] as string[] },
    ];
    // Degraded (1 judge under a 2-judge policy): the MERGED result gets provenance, the unmerged doesn't.
    assert.equal(markDegradedQuorumMerges(results, 1, 2, 2), 1);
    assert.match(results[0]!.dissentLog[0]!, /quorum-degraded.*1 judge.*policy of 2/);
    assert.equal(results[1]!.dissentLog.length, 0);
    // Full quorum: nothing flagged, nothing mutated.
    const clean = [{ merged: true, memberId: 'codex', dissentLog: [] as string[] }];
    assert.equal(markDegradedQuorumMerges(clean, 2, 2, 3), 0);
    assert.equal(clean[0]!.dissentLog.length, 0);
  });

  test('end-to-end: shrunk quorum turns the dead-judge FAIL into a PASS', () => {
    // Before the fix: minPasses == minJudges == 2, but dead grok casts UNCLEAR →
    // only 1 PASS possible → FAIL (this is the merged-nothing bug, proven below).
    const liveJudgePlusDead: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'claude-code', builderMemberId: 'codex' }),
      makeVote({ verdict: 'UNCLEAR', judgeMemberId: 'grok-build', builderMemberId: 'codex' }),
    ];
    assert.equal(computeConsensus(liveJudgePlusDead, { minJudges: 2, minPasses: 2 }).verdict, 'FAIL');

    // After the fix: grok is excluded from judging entirely and the quorum shrinks to
    // 1, so the single live judge's PASS carries.
    const k = resolveEffectiveMinJudges(2, 2); // = 1
    const liveOnly: WeightedVote[] = [
      makeVote({ verdict: 'PASS', judgeMemberId: 'claude-code', builderMemberId: 'codex' }),
    ];
    assert.equal(computeConsensus(liveOnly, { minJudges: k, minPasses: k }).verdict, 'PASS');
  });
});
