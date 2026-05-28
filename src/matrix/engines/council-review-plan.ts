// Matrix Kernel - CouncilReviewPlan
//
// Pure planning helpers for anonymous cross-member council review. The planner
// is shared by merge court and tests so builder-never-judges is structural, not
// just prompt text.
import type { CouncilMemberId } from './council-scheduler.js';
import { pickJudgeSlots, type CouncilSlot } from './council-slot.js';
import type { CouncilWorktreeHandle } from './council-worktree.js';

const CANDIDATE_LABELS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];

export interface AnonymousReviewAssignment {
  candidateId: string;
  builderMemberId: CouncilMemberId;
  builderSlotId?: string;
  worktreePath: string;
  judgeMemberIds: CouncilMemberId[];
  judgeSlots: CouncilSlot[];
  requiredPassVotes: number;
  isStructurallyValid: boolean;
  violationReason?: string;
}

export interface AnonymousReviewPlan {
  assignments: AnonymousReviewAssignment[];
  anonymizationMap: Record<string, string>;
  requiredPassVotes: number;
}

export interface BuildAnonymousReviewPlanOptions {
  handles: CouncilWorktreeHandle[];
  allMemberIds: CouncilMemberId[];
  allSlots?: CouncilSlot[];
  minJudges: number;
  judgeCapableMembers?: Iterable<CouncilMemberId>;
}

export function assertBuilderNeverJudges(
  builderId: CouncilMemberId,
  judgeIds: CouncilMemberId[],
  context = 'council-review',
): void {
  if (judgeIds.includes(builderId)) {
    throw new Error(`builder-never-judges violation in ${context}: ${builderId} cannot judge its own work`);
  }
}

export function buildAnonymousReviewPlan(opts: BuildAnonymousReviewPlanOptions): AnonymousReviewPlan {
  const capable = new Set(opts.judgeCapableMembers ?? opts.allMemberIds);
  const requiredPassVotes = Math.max(1, opts.minJudges);
  const anonymizationMap: Record<string, string> = {};

  const assignments = opts.handles.map((handle, idx): AnonymousReviewAssignment => {
    const builderMemberId = handle.memberId as CouncilMemberId;
    const label = CANDIDATE_LABELS[idx] ?? String(idx + 1);
    const candidateId = `Candidate-${label}`;
    anonymizationMap[candidateId] = builderMemberId;

    const judgeSlots = opts.allSlots && opts.allSlots.length > 0
      ? pickJudgeSlots(
          opts.allSlots.filter(slot => slot.memberId !== builderMemberId && capable.has(slot.memberId)),
          opts.minJudges,
        )
      : [];
    const judgeMemberIds = opts.allSlots && opts.allSlots.length > 0
      ? [...new Set(judgeSlots.map(slot => slot.memberId))]
      : opts.allMemberIds.filter(id => id !== builderMemberId && capable.has(id));

    assertBuilderNeverJudges(builderMemberId, judgeMemberIds, candidateId);

    const isStructurallyValid = judgeMemberIds.length >= opts.minJudges;
    return {
      candidateId,
      builderMemberId,
      builderSlotId: handle.slotId,
      worktreePath: handle.worktreePath,
      judgeMemberIds,
      judgeSlots,
      requiredPassVotes,
      isStructurallyValid,
      violationReason: isStructurallyValid
        ? undefined
        : `insufficient cross-member judges: ${judgeMemberIds.length}/${opts.minJudges}`,
    };
  });

  return { assignments, anonymizationMap, requiredPassVotes };
}
