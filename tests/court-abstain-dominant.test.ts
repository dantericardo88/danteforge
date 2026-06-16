// Phase 3 (CH-010): the court must DECIDE — a strict-majority abstention is "could not decide"
// (re-attempt/escalate), NOT a clean merits rejection that silently parks a dim. Verified at both
// the consensus metric (computeConsensus.abstained/abstentionRate) and the push's court parser
// (parseCourtOutput.abstainDominant), which routes it to a re-attemptable non-run.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeConsensus, type WeightedVote } from '../src/matrix/engines/council-consensus.js';
import { parseCourtOutput } from '../src/cli/commands/ascend-frontier-runner.js';
import type { CouncilMemberId } from '../src/matrix/engines/council-scheduler.js';

function vote(verdict: WeightedVote['verdict'], judge: CouncilMemberId): WeightedVote {
  return { judgeSlotId: `${judge}-0`, judgeMemberId: judge, builderMemberId: 'codex', verdict, weight: 1, confidence: 'HIGH', reason: '' };
}

describe('computeConsensus — CH-010 abstention metric', () => {
  test('UNCLEAR-dominant (2 of 3 abstain, 1 FAIL) → abstained=true, verdict stays FAIL, rate 2/3', () => {
    const r = computeConsensus([vote('UNCLEAR', 'claude-code'), vote('UNCLEAR', 'grok-build'), vote('FAIL', 'gemini-cli')], { minJudges: 2, minPasses: 2 });
    assert.equal(r.abstained, true);
    assert.equal(r.verdict, 'FAIL'); // backward-compat: still non-PASS for existing callers
    assert.ok(Math.abs(r.abstentionRate - 2 / 3) < 1e-9);
  });

  test('a clean merits FAIL (2 FAIL + 1 PASS) is NOT abstained', () => {
    const r = computeConsensus([vote('FAIL', 'claude-code'), vote('FAIL', 'grok-build'), vote('PASS', 'gemini-cli')], { minJudges: 2, minPasses: 2 });
    assert.equal(r.abstained, false);
    assert.equal(r.abstentionRate, 0);
  });

  test('unanimous PASS is not abstained', () => {
    const r = computeConsensus([vote('PASS', 'claude-code'), vote('PASS', 'grok-build')], { minJudges: 2, minPasses: 2 });
    assert.equal(r.abstained, false);
    assert.equal(r.verdict, 'PASS');
  });
});

describe('parseCourtOutput — CH-010 abstain-dominant routing', () => {
  const out = (judges: Array<{ verdict: string; judgeId: string; unavailable?: boolean }>) =>
    ({ ok: false, stdout: JSON.stringify({ result: { verdict: 'REJECTED', judges } }) });

  test('2 of 3 UNCLEAR + 1 FAIL → abstainDominant, but NOT allAbstained', () => {
    const p = parseCourtOutput(out([{ verdict: 'UNCLEAR', judgeId: 'a' }, { verdict: 'UNCLEAR', judgeId: 'b' }, { verdict: 'FAIL', judgeId: 'c' }]));
    assert.equal(p.abstainDominant, true);
    assert.equal(p.allAbstained, false);
  });

  test('all UNCLEAR → both abstainDominant and allAbstained', () => {
    const p = parseCourtOutput(out([{ verdict: 'UNCLEAR', judgeId: 'a' }, { verdict: 'UNCLEAR', judgeId: 'b' }]));
    assert.equal(p.abstainDominant, true);
    assert.equal(p.allAbstained, true);
  });

  test('1 FAIL + 1 UNCLEAR (exactly 50%, not a majority) → NOT abstainDominant — the real vote decides', () => {
    const p = parseCourtOutput(out([{ verdict: 'FAIL', judgeId: 'a' }, { verdict: 'UNCLEAR', judgeId: 'b' }]));
    assert.equal(p.abstainDominant, false);
  });

  test('a clean rejection (2 FAIL) is not abstainDominant', () => {
    const p = parseCourtOutput(out([{ verdict: 'FAIL', judgeId: 'a' }, { verdict: 'FAIL', judgeId: 'b' }]));
    assert.equal(p.abstainDominant, false);
  });
});
