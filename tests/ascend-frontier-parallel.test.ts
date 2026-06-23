import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignRound, detectReciprocity, runParallelRound,
  type PushOutcome, type RoundAssignment,
} from '../src/core/ascend-frontier-parallel.js';
import type { DimState } from '../src/core/ascend-frontier-engine.js';
import type { CouncilMemberId } from '../src/matrix/engines/council-scheduler.js';

const NOW = '2026-06-03T00:00:00.000Z';
const MEMBERS: CouncilMemberId[] = ['codex', 'claude-code', 'grok-build'];

function dim(id: string, score: number, over: Partial<DimState> = {}): DimState {
  // demandBound:true by default — these tests exercise the PUSH-to-9 fan-out (a no-demand 8.0 dim FINISHES;
  // finish-mode is covered by the engine test).
  return { id, effectiveScore: score, frontierStatus: 'frozen', ceiling: null, attempts: 0, isMarketCapped: false, demandBound: true, ...over };
}

describe('assignRound — weakest-N per member, file-overlap defer', () => {
  test('assigns the weakest incomplete dims one per member', () => {
    const dims = [dim('a', 8.0), dim('b', 7.0), dim('c', 7.5), dim('d', 9.0, { frontierStatus: 'validated' })];
    const r = assignRound(dims, MEMBERS, { nowIso: NOW });
    assert.equal(r.length, 3);
    assert.deepEqual(r.map(a => a.dimId), ['b', 'c', 'a'], 'weakest first, validated d excluded');
    assert.deepEqual(r.map(a => a.memberId), MEMBERS);
  });

  test('defers a dim that file-collides with an already-assigned dim', () => {
    const dims = [dim('a', 7.0), dim('b', 7.1), dim('c', 7.2)];
    const touched = (id: string) => id === 'a' || id === 'b' ? ['src/shared.ts'] : ['src/c.ts'];
    const r = assignRound(dims, MEMBERS, { nowIso: NOW, touchedFiles: touched });
    // a takes src/shared.ts; b collides → deferred; c is clean → assigned. Only 2 this round.
    assert.deepEqual(r.map(a => a.dimId), ['a', 'c']);
  });

  test('skips dims below 7.0 (those belong to the build-to-7 phase)', () => {
    const r = assignRound([dim('a', 6.0), dim('b', 7.0)], MEMBERS, { nowIso: NOW });
    assert.deepEqual(r.map(a => a.dimId), ['b']);
  });
});

describe('detectReciprocity — rubber-stamp pairs', () => {
  function outcome(dimId: string, builder: CouncilMemberId, passedBy: CouncilMemberId[]): PushOutcome {
    return { dimId, builderId: builder, verdict: 'VALIDATED', passedByJudges: passedBy };
  }
  test('A passes B and B passes A → flagged pair', () => {
    const outcomes = [
      outcome('x', 'codex', ['claude-code']),      // codex's dim x passed by claude-code
      outcome('y', 'claude-code', ['codex']),      // claude-code's dim y passed by codex
      outcome('z', 'grok-build', ['codex', 'claude-code']),
    ];
    const pairs = detectReciprocity(outcomes);
    assert.equal(pairs.length, 1);
    assert.deepEqual([pairs[0]!.memberA, pairs[0]!.memberB].sort(), ['claude-code', 'codex']);
  });
  test('one-directional pass is NOT reciprocal', () => {
    const outcomes = [
      outcome('x', 'codex', ['claude-code']),
      outcome('y', 'claude-code', ['grok-build']), // claude-code did NOT pass codex's dim
    ];
    assert.equal(detectReciprocity(outcomes).length, 0);
  });
});

describe('runParallelRound', () => {
  test('build-all runs once (concurrent), promote runs SERIALLY, reciprocal pairs queued for audit', async () => {
    const assignments: RoundAssignment[] = [
      { memberId: 'codex', dimId: 'x' }, { memberId: 'claude-code', dimId: 'y' }, { memberId: 'grok-build', dimId: 'z' },
    ];
    type AuditEntry = { dimId: string; kind: string };
    const enq: AuditEntry[] = [];
    let buildAlls = 0;
    const promoteOrder: string[] = [];
    let concurrentPromotes = 0, maxConcurrent = 0;
    const r = await runParallelRound('/tmp/fake', assignments, {
      buildAll: async () => { buildAlls++; },
      promoteOne: async (_cwd, a) => {
        concurrentPromotes++; maxConcurrent = Math.max(maxConcurrent, concurrentPromotes);
        await Promise.resolve(); promoteOrder.push(a.dimId); concurrentPromotes--;
        return { dimId: a.dimId, builderId: a.memberId, verdict: 'VALIDATED',
          passedByJudges: a.dimId === 'x' ? ['claude-code'] : a.dimId === 'y' ? ['codex'] : ['codex', 'claude-code'] };
      },
      _enqueueAudit: async (_cwd, e) => { enq.push({ dimId: e.dimId, kind: e.kind }); },
      nowIso: NOW,
    });
    assert.equal(buildAlls, 1, 'one concurrent build-all for the whole round');
    assert.equal(maxConcurrent, 1, 'promotes are SERIAL — never two matrix-writers at once');
    assert.deepEqual(r.validated.sort(), ['x', 'y', 'z']);
    assert.equal(r.reciprocalPairs.length, 1, 'codex↔claude-code cross-passed');
    assert.equal(enq.filter(e => e.kind === 'reciprocal-pair').length, 2);
  });

  test('a failed promote degrades to REJECTED, never crashes the round', async () => {
    const r = await runParallelRound('/tmp/fake', [{ memberId: 'codex', dimId: 'x' }], {
      buildAll: async () => {},
      promoteOne: async () => { throw new Error('promote blew up'); },
      _enqueueAudit: async () => {},
      nowIso: NOW,
    });
    assert.equal(r.outcomes[0]!.verdict, 'REJECTED');
    assert.equal(r.validated.length, 0);
  });
});
