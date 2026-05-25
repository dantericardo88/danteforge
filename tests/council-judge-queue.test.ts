import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilJudgeQueue, type JudgeCandidate } from '../src/matrix/engines/council-judge-queue.js';
import type { CouncilSlot } from '../src/matrix/engines/council-slot.js';

function makeCandidate(overrides: Partial<JudgeCandidate> & { slotId: string; memberId: JudgeCandidate['memberId'] }): JudgeCandidate {
  return {
    candidateId: `cand-${overrides.slotId}-${Date.now()}`,
    dimensionId: 'testing',
    worktreePath: `/tmp/wt-${overrides.slotId}`,
    changedFiles: ['src/foo.ts'],
    completedAt: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  };
}

function makeSlot(memberId: JudgeCandidate['memberId'], slotIdx = 0): CouncilSlot {
  return { memberId, slotIdx, slotId: `${memberId}-${slotIdx}` };
}

describe('CouncilJudgeQueue — enqueue and assign', () => {
  test('enqueue then assignNextJudge picks cross-member slot', () => {
    const q = new CouncilJudgeQueue();
    q.enqueue(makeCandidate({ slotId: 'claude-code-0', memberId: 'claude-code' }));
    const slots: CouncilSlot[] = [makeSlot('codex', 0), makeSlot('grok-build', 0)];
    const next = q.assignNextJudge(slots);
    assert.ok(next !== null);
    assert.notEqual(next!.judgeSlot.memberId, 'claude-code');
  });

  test('returns null when no cross-member slot available', () => {
    const q = new CouncilJudgeQueue();
    q.enqueue(makeCandidate({ slotId: 'codex-0', memberId: 'codex' }));
    const slots: CouncilSlot[] = [makeSlot('codex', 1)]; // same member
    const next = q.assignNextJudge(slots);
    assert.equal(next, null);
  });

  test('returns null when queue is empty', () => {
    const q = new CouncilJudgeQueue();
    const slots: CouncilSlot[] = [makeSlot('codex', 0)];
    assert.equal(q.assignNextJudge(slots), null);
  });

  test('FIFO: earliest candidate assigned first', () => {
    const q = new CouncilJudgeQueue();
    const first = makeCandidate({ slotId: 'claude-code-0', memberId: 'claude-code', candidateId: 'first' });
    const second = makeCandidate({ slotId: 'claude-code-1', memberId: 'claude-code', candidateId: 'second' });
    q.enqueue(first);
    q.enqueue(second);
    const slots: CouncilSlot[] = [makeSlot('codex', 0)];
    const next = q.assignNextJudge(slots);
    assert.equal(next!.candidate.candidateId, 'first');
  });

  test('already under-review candidate is skipped', () => {
    const q = new CouncilJudgeQueue();
    q.enqueue(makeCandidate({ slotId: 'claude-code-0', memberId: 'claude-code', candidateId: 'c1' }));
    q.enqueue(makeCandidate({ slotId: 'claude-code-1', memberId: 'claude-code', candidateId: 'c2' }));
    const slots: CouncilSlot[] = [makeSlot('codex', 0), makeSlot('grok-build', 0)];
    // First assign claims c1
    const first = q.assignNextJudge(slots);
    assert.equal(first!.candidate.candidateId, 'c1');
    // Second assign gets c2 (c1 is now under-review)
    const second = q.assignNextJudge(slots);
    assert.equal(second!.candidate.candidateId, 'c2');
  });
});

describe('CouncilJudgeQueue — markJudgeComplete', () => {
  test('PASS verdict → status: merged', () => {
    const q = new CouncilJudgeQueue();
    const cand = makeCandidate({ slotId: 'codex-0', memberId: 'codex', candidateId: 'cpass' });
    q.enqueue(cand);
    q.assignNextJudge([makeSlot('claude-code', 0)]);
    q.markJudgeComplete('cpass', 'PASS');
    const stats = q.getStats();
    assert.equal(stats.merged, 1);
    assert.equal(stats.judged, 0);
  });

  test('FAIL verdict → status: judged', () => {
    const q = new CouncilJudgeQueue();
    const cand = makeCandidate({ slotId: 'codex-0', memberId: 'codex', candidateId: 'cfail' });
    q.enqueue(cand);
    q.assignNextJudge([makeSlot('claude-code', 0)]);
    q.markJudgeComplete('cfail', 'FAIL');
    const stats = q.getStats();
    assert.equal(stats.judged, 1);
    assert.equal(stats.merged, 0);
  });

  test('getStats reflects correct counts', () => {
    const q = new CouncilJudgeQueue();
    q.enqueue(makeCandidate({ slotId: 'codex-0', memberId: 'codex', candidateId: 'c1' }));
    q.enqueue(makeCandidate({ slotId: 'codex-1', memberId: 'codex', candidateId: 'c2' }));
    const stats = q.getStats();
    assert.equal(stats.pending, 2);
    assert.equal(stats.underReview, 0);
  });
});

describe('CouncilJudgeQueue — drainPending', () => {
  test('drains all pending candidates using provided runJudge fn', async () => {
    const q = new CouncilJudgeQueue();
    q.enqueue(makeCandidate({ slotId: 'codex-0', memberId: 'codex', candidateId: 'dc1' }));
    q.enqueue(makeCandidate({ slotId: 'claude-code-0', memberId: 'claude-code', candidateId: 'dc2' }));

    const allSlots: CouncilSlot[] = [
      makeSlot('grok-build', 0),
      makeSlot('claude-code', 0),
      makeSlot('codex', 0),
    ];

    const judged: string[] = [];
    await q.drainPending(allSlots, async (_slot, candidate) => {
      judged.push(candidate.candidateId);
      return { consensus: 'PASS' as const };
    });

    assert.equal(judged.length, 2);
    assert.ok(judged.includes('dc1'));
    assert.ok(judged.includes('dc2'));
    assert.equal(q.hasPending(), false);
  });
});
