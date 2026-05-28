import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlots,
  buildSlotsForMembers,
  pickJudgeSlots,
  type CouncilSlot,
} from '../src/matrix/engines/council-slot.js';
import { makeReadOnlyLease } from '../src/matrix/engines/council-worktree.js';
import {
  groupBySlot,
  groupByMember,
  type ScheduledDimension,
} from '../src/matrix/engines/council-scheduler.js';
import { FileClaims } from '../src/matrix/engines/council-file-claims.js';
import {
  buildAnonymousReviewPlan,
  assertBuilderNeverJudges,
} from '../src/matrix/engines/council-review-plan.js';

// ── buildSlots ────────────────────────────────────────────────────────────────

describe('buildSlots', () => {
  test('3 members × 4 slots → 12 entries', () => {
    const slots = buildSlots(['claude-code', 'codex', 'grok-build'], 4);
    assert.equal(slots.length, 12);
  });

  test('slotIds are unique', () => {
    const slots = buildSlots(['claude-code', 'codex', 'grok-build'], 4);
    const ids = new Set(slots.map(s => s.slotId));
    assert.equal(ids.size, 12);
  });

  test('slotId format is memberId-slotIdx', () => {
    const slots = buildSlots(['codex'], 3);
    assert.deepEqual(slots.map(s => s.slotId), ['codex-0', 'codex-1', 'codex-2']);
  });

  test('slotsPerMember:1 → same as member count', () => {
    const slots = buildSlots(['codex', 'grok-build'], 1);
    assert.equal(slots.length, 2);
    assert.equal(slots[0]!.slotId, 'codex-0');
    assert.equal(slots[1]!.slotId, 'grok-build-0');
  });

  test('each slot has correct memberId and slotIdx', () => {
    const slots = buildSlots(['claude-code', 'codex'], 2);
    const ccSlots = slots.filter(s => s.memberId === 'claude-code');
    assert.equal(ccSlots.length, 2);
    assert.deepEqual(ccSlots.map(s => s.slotIdx), [0, 1]);
  });
});

describe('buildSlotsForMembers', () => {
  test('applies per-member slot overrides while preserving default slots', () => {
    const slots = buildSlotsForMembers(
      ['claude-code', 'codex', 'grok-build'],
      2,
      { codex: 4, 'grok-build': 1 },
    );

    assert.equal(slots.filter(s => s.memberId === 'claude-code').length, 2);
    assert.equal(slots.filter(s => s.memberId === 'codex').length, 4);
    assert.equal(slots.filter(s => s.memberId === 'grok-build').length, 1);
    assert.equal(slots.length, 7);
  });

  test('ignores invalid per-member slot overrides', () => {
    const slots = buildSlotsForMembers(['codex'], 2, { codex: 0 });
    assert.deepEqual(slots.map(s => s.slotId), ['codex-0', 'codex-1']);
  });
});

describe('anonymous peer review candidate labels', () => {
  test('assigns unique anonymous candidates per slot, not just per member', () => {
    const handles = [
      { memberId: 'codex', slotId: 'codex-0', worktreePath: '/fake/codex-0', branchName: 'codex-0' },
      { memberId: 'codex', slotId: 'codex-1', worktreePath: '/fake/codex-1', branchName: 'codex-1' },
      { memberId: 'grok-build', slotId: 'grok-build-0', worktreePath: '/fake/grok-build-0', branchName: 'grok-build-0' },
    ];

    const plan = buildAnonymousReviewPlan({
      handles,
      allMemberIds: ['codex', 'claude-code', 'grok-build'],
      minJudges: 1,
    });

    const candidateIds = plan.assignments.map(a => a.candidateId);
    assert.equal(new Set(candidateIds).size, 3);
    const codex0 = plan.assignments.find(a => a.builderSlotId === 'codex-0')!.candidateId;
    const codex1 = plan.assignments.find(a => a.builderSlotId === 'codex-1')!.candidateId;
    assert.notEqual(codex0, codex1);
  });
});

// ── groupBySlot ───────────────────────────────────────────────────────────────

describe('groupBySlot', () => {
  function makeDim(id: string, memberId: 'codex' | 'claude-code' | 'grok-build', slotIdx = 0): ScheduledDimension {
    const slotId = `${memberId}-${slotIdx}`;
    return {
      dimensionId: id,
      label: id,
      currentScore: 5,
      gapToFrontier: 2,
      assignedTo: memberId,
      assignedSlot: { memberId, slotIdx, slotId },
    };
  }

  test('groups dims by slotId correctly', () => {
    const dims: ScheduledDimension[] = [
      makeDim('testing', 'codex', 0),
      makeDim('security', 'codex', 1),
      makeDim('autonomy', 'claude-code', 0),
    ];
    const groups = groupBySlot(dims);
    assert.equal(groups.size, 3);
    assert.equal(groups.get('codex-0')?.length, 1);
    assert.equal(groups.get('codex-1')?.length, 1);
    assert.equal(groups.get('claude-code-0')?.length, 1);
  });

  test('fallback to memberId-0 when no assignedSlot', () => {
    const dims: ScheduledDimension[] = [{
      dimensionId: 'testing', label: 'testing',
      currentScore: 5, gapToFrontier: 2, assignedTo: 'codex',
    }];
    const groups = groupBySlot(dims);
    assert.ok(groups.has('codex-0'));
  });
});

// ── pickJudgeSlots ────────────────────────────────────────────────────────────

describe('pickJudgeSlots', () => {
  const allSlots: CouncilSlot[] = [
    { memberId: 'codex', slotIdx: 0, slotId: 'codex-0' },
    { memberId: 'codex', slotIdx: 1, slotId: 'codex-1' },
    { memberId: 'grok-build', slotIdx: 0, slotId: 'grok-build-0' },
    { memberId: 'grok-build', slotIdx: 1, slotId: 'grok-build-1' },
  ];

  test('picks n slots with cross-member diversity', () => {
    const picked = pickJudgeSlots(allSlots, 2);
    assert.equal(picked.length, 2);
    const members = new Set(picked.map(s => s.memberId));
    assert.equal(members.size, 2); // one from each member
  });

  test('picks fewer than n if not enough slots available', () => {
    const slots: CouncilSlot[] = [{ memberId: 'codex', slotIdx: 0, slotId: 'codex-0' }];
    const picked = pickJudgeSlots(slots, 3);
    assert.equal(picked.length, 1);
  });

  test('returns empty array for empty input', () => {
    assert.equal(pickJudgeSlots([], 2).length, 0);
  });
});

// ── FileClaims slot-aware conflict rule ───────────────────────────────────────

describe('FileClaims — slot-aware conflict rule', () => {
  test('same member different slots (slot mode) → conflict (independent branches can diverge)', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/foo.ts'], 'codex-0');
    const result = claims.claim('codex', ['src/foo.ts'], 'codex-1');
    // In slot mode, same member + different slot = conflict (independent worktrees)
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]!.claimedBy, 'codex');
    assert.equal(result.accepted.length, 0);
  });

  test('same member same slot re-claim → no conflict (idempotent)', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/foo.ts'], 'codex-0');
    const result = claims.claim('codex', ['src/foo.ts'], 'codex-0');
    // Same slot re-claiming the same file is idempotent
    assert.equal(result.conflicts.length, 0);
    assert.equal(result.accepted.length, 1);
  });

  test('different member different slot → conflict detected', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/bar.ts'], 'codex-0');
    const result = claims.claim('grok-build', ['src/bar.ts'], 'grok-build-0');
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0]!.claimedBy, 'codex');
  });

  test('hasConflict with no slotId → backward compat, member-only check (same member = false)', () => {
    const claims = new FileClaims();
    claims.claim('claude-code', ['src/engine.ts'], 'claude-code-0');
    // No slotId provided: non-slot mode uses member-only conflict check
    assert.equal(claims.hasConflict('claude-code', ['src/engine.ts']), false);
  });

  test('hasConflict returns true for cross-member (with slotId)', () => {
    const claims = new FileClaims();
    claims.claim('claude-code', ['src/engine.ts'], 'claude-code-0');
    assert.equal(claims.hasConflict('codex', ['src/engine.ts'], 'codex-0'), true);
  });

  test('hasConflict returns true for same-member different slot (slot mode)', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/engine.ts'], 'codex-0');
    assert.equal(claims.hasConflict('codex', ['src/engine.ts'], 'codex-1'), true);
  });

  test('clear resets all claims', () => {
    const claims = new FileClaims();
    claims.claim('codex', ['src/x.ts']);
    claims.clear();
    assert.equal(claims.size, 0);
  });
});

// ── groupByMember still works (backward compat) ───────────────────────────────

// ── makeReadOnlyLease shared factory ─────────────────────────────────────────

describe('makeReadOnlyLease — shared factory (consolidation fix)', () => {
  test('forbids all writes, allows all reads', () => {
    const lease = makeReadOnlyLease('/some/worktree');
    assert.deepEqual((lease as unknown as Record<string, unknown>)['allowedWritePaths'], []);
    assert.deepEqual((lease as unknown as Record<string, unknown>)['allowedReadPaths'], ['**']);
    assert.deepEqual((lease as unknown as Record<string, unknown>)['forbiddenPaths'], ['**']);
  });

  test('uses custom prefix in lease id', () => {
    const lease = makeReadOnlyLease('/some/worktree', 'merge-court');
    const id = (lease as unknown as Record<string, unknown>)['id'] as string;
    assert.ok(id.startsWith('merge-court-readonly-lease.'), `expected prefix in id, got ${id}`);
  });

  test('default prefix is "council"', () => {
    const lease = makeReadOnlyLease('/some/worktree');
    const id = (lease as unknown as Record<string, unknown>)['id'] as string;
    assert.ok(id.startsWith('council-readonly-lease.'), `expected "council" prefix, got ${id}`);
  });
});

describe('groupByMember — backward compat', () => {
  test('groups by assignedTo memberId', () => {
    const dims: ScheduledDimension[] = [
      { dimensionId: 'a', label: 'a', currentScore: 5, gapToFrontier: 2, assignedTo: 'codex' },
      { dimensionId: 'b', label: 'b', currentScore: 5, gapToFrontier: 2, assignedTo: 'claude-code' },
      { dimensionId: 'c', label: 'c', currentScore: 5, gapToFrontier: 2, assignedTo: 'codex' },
    ];
    const groups = groupByMember(dims);
    assert.equal(groups.get('codex')?.length, 2);
    assert.equal(groups.get('claude-code')?.length, 1);
  });
});

describe('buildAnonymousReviewPlan', () => {
  test('assigns anonymous cross-member judges for every parallel worktree candidate', () => {
    const slots = buildSlots(['codex', 'grok-build', 'claude-code'], 2);
    const handles = slots.map(slot => ({
      memberId: slot.memberId,
      slotId: slot.slotId,
      slotIdx: slot.slotIdx,
      worktreePath: `/tmp/${slot.slotId}`,
      branchName: `council/run/${slot.slotId}`,
    }));

    const plan = buildAnonymousReviewPlan({
      handles,
      allMemberIds: ['codex', 'grok-build', 'claude-code'],
      allSlots: slots,
      minJudges: 2,
    });

    assert.equal(plan.assignments.length, handles.length);
    assert.equal(plan.requiredPassVotes, 2);
    assert.equal(plan.anonymizationMap['Candidate-Alpha'], 'codex');

    for (const assignment of plan.assignments) {
      assert.match(assignment.candidateId, /^Candidate-/);
      assert.equal(assignment.judgeMemberIds.includes(assignment.builderMemberId), false);
      assert.equal(new Set(assignment.judgeMemberIds).size, 2);
      assert.equal(assignment.judgeSlots.some(slot => slot.memberId === assignment.builderMemberId), false);
      assert.equal(assignment.isStructurallyValid, true);
    }
  });

  test('fails closed when a builder is present in its own judge list', () => {
    assert.throws(
      () => assertBuilderNeverJudges('codex', ['grok-build', 'codex'], 'unit-test'),
      /builder-never-judges violation/,
    );
  });
});
