import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runFrontierReviewCourt, buildFrontierJudgePrompt, type FrontierReviewInput,
} from '../src/matrix/courts/frontier-review-court.js';
import type { CouncilMemberId } from '../src/matrix/engines/council-scheduler.js';

function input(over: Partial<FrontierReviewInput> = {}): FrontierReviewInput {
  return {
    dimId: 'repo_level_context',
    frontierSpec: {
      version: 1, target_score: 9.0, status: 'frozen',
      leader_target: { competitor: 'Cursor', score: 9.5, observed_capability: 'whole-repo symbol map + import graph + citations' },
      real_user_path: { required_callsite: 'src/context/repo-map.ts', run_command: 'node dist/index.js context inspect --project fixtures/real', observable_artifacts: [{ kind: 'json', path: 'out/repo-map.json' }] },
      required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
    },
    evidence: {
      runCommand: 'node dist/index.js context inspect --project fixtures/real',
      requiredCallsite: 'src/context/repo-map.ts',
      artifactPath: 'out/repo-map.json',
      artifactExcerpt: '{ "symbols": 990, "importGraph": {...}, "citations": [...] }',
      receipts: [{ sessionId: 's1', passed: true, tier: 'T5' }, { sessionId: 's2', passed: true, tier: 'T7' }],
    },
    ...over,
  };
}

const MEMBERS: CouncilMemberId[] = ['codex', 'claude-code'];

function judgeReturning(map: Record<string, string>) {
  return async (id: CouncilMemberId) => map[id] ?? 'VERDICT: UNCLEAR';
}

describe('frontier-review-court — the automated 9.0 semantic gate', () => {
  test('builds a prompt that names the competitor, capability, and the real run', () => {
    const p = buildFrontierJudgePrompt(input());
    assert.match(p, /Cursor/);
    assert.match(p, /whole-repo symbol map/);
    assert.match(p, /context inspect --project fixtures\/real/);
    assert.match(p, /prepared\/toy fixture/);
  });

  test('two cross-member PASS → VALIDATED', async () => {
    const r = await runFrontierReviewCourt(input(), {
      members: MEMBERS,
      runJudge: judgeReturning({ codex: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: real repo map, matches Cursor', 'claude-code': 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: genuine' }),
    });
    assert.equal(r.verdict, 'VALIDATED');
    assert.equal(r.vote.pass, 2);
  });

  test('one PASS + one FAIL → REJECTED (no consensus; builder cannot self-certify)', async () => {
    const r = await runFrontierReviewCourt(input(), {
      members: MEMBERS,
      runJudge: judgeReturning({ codex: 'VERDICT: PASS\nREASON: looks good', 'claude-code': 'VERDICT: FAIL\nREASON: this is a prepared fixture, not real usage' }),
    });
    assert.equal(r.verdict, 'REJECTED');
  });

  test('a fixture-flagging FAIL keeps it out of 9.0', async () => {
    const r = await runFrontierReviewCourt(input(), {
      members: MEMBERS,
      runJudge: judgeReturning({ codex: 'VERDICT: FAIL\nREASON: narrow toy input', 'claude-code': 'VERDICT: FAIL\nREASON: does not match Cursor breadth' }),
    });
    assert.equal(r.verdict, 'REJECTED');
    assert.equal(r.vote.fail, 2);
  });

  test('judges can flag an honest CEILING — surfaced as ceilingSignal', async () => {
    const r = await runFrontierReviewCourt(input({ dimId: 'enterprise_readiness' }), {
      members: MEMBERS,
      runJudge: judgeReturning({
        codex: 'VERDICT: FAIL\nCEILING: yes\nREASON: market dim, pre-release cannot reach 9',
        'claude-code': 'VERDICT: FAIL\nCEILING: yes\nREASON: honest market cap',
      }),
    });
    assert.equal(r.verdict, 'REJECTED');
    assert.equal(r.ceilingSignal, 2, 'both judges flagged an honest ceiling');
  });

  test('builder-never-judges: the builder is excluded; only the other members judge', async () => {
    const asked: string[] = [];
    const r = await runFrontierReviewCourt(input(), {
      members: ['codex', 'claude-code', 'grok-build'],
      builderMemberId: 'codex', // codex built this dim → must not judge it
      runJudge: async (id) => { asked.push(id); return 'VERDICT: PASS\nREASON: genuine'; },
    });
    assert.ok(!asked.includes('codex'), 'the builder (codex) was NOT asked to judge its own dim');
    assert.deepEqual(asked.sort(), ['claude-code', 'grok-build']);
    assert.equal(r.verdict, 'VALIDATED'); // 2 cross-member PASS
    assert.equal(r.vote.crossMember, 2);
  });

  test('parallel unanimous gate: with builder excluded, one FAIL from the other two blocks 9.0', async () => {
    const r = await runFrontierReviewCourt(input(), {
      members: ['codex', 'claude-code', 'grok-build'],
      builderMemberId: 'codex', minJudges: 2,
      runJudge: async (id) => id === 'grok-build' ? 'VERDICT: FAIL\nREASON: prepared fixture' : 'VERDICT: PASS\nREASON: ok',
    });
    assert.equal(r.verdict, 'REJECTED', 'unanimous 2-of-2 required — a single FAIL blocks');
  });

  test('a judge error degrades to UNCLEAR, never a silent PASS, and is marked unavailable (CH-020)', async () => {
    const r = await runFrontierReviewCourt(input(), {
      members: MEMBERS,
      runJudge: async (id) => { if (id === 'codex') throw new Error('quota'); return 'VERDICT: PASS\nREASON: ok'; },
    });
    // 1 PASS + 1 UNCLEAR with minPasses=2 cannot validate.
    assert.equal(r.verdict, 'REJECTED');
    assert.equal(r.vote.unclear, 1);
    // CH-020: the thrown judge is flagged unavailable (adapter failure), the voting judge is not.
    assert.equal(r.judges.find(j => j.judgeId === 'codex')?.unavailable, true, 'a thrown judge could not run');
    assert.equal(r.judges.find(j => j.judgeId !== 'codex' && j.verdict === 'PASS')?.unavailable, false, 'a judge that voted is available');
  });

  test('every judge unavailable → all marked unavailable (structural outage signal, CH-020)', async () => {
    const r = await runFrontierReviewCourt(input(), {
      members: MEMBERS,
      // Both the court-caught throw AND the CLI "judge unavailable — <reason>" marker count as unavailable.
      runJudge: async (id) => { if (id === 'codex') throw new Error('usage limit'); return 'VERDICT: UNCLEAR\nREASON: judge unavailable — try again at 8:45 PM'; },
    });
    assert.equal(r.verdict, 'REJECTED');
    assert.ok(r.judges.length >= 2 && r.judges.every(j => j.unavailable === true), 'a fully-down council marks every judge unavailable');
  });
});
