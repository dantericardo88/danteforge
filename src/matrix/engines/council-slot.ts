// Matrix Kernel — CouncilSlot
//
// A CouncilSlot is a uniquely addressable build/judge agent within the
// Hierarchical Multi-Agent Council. Each member can host N slots, enabling
// M members × N slots = M*N parallel worktrees with full isolation.
//
// Slot IDs are stable within a council run: `${memberId}-${slotIdx}`.
import type { CouncilMemberId } from './council-scheduler.js';

export interface CouncilSlot {
  memberId: CouncilMemberId;
  slotIdx: number;
  slotId: string;
}

/** Build the slot array for N slots per member. */
export function buildSlots(memberIds: CouncilMemberId[], slotsPerMember: number): CouncilSlot[] {
  return memberIds.flatMap(memberId =>
    Array.from({ length: slotsPerMember }, (_, slotIdx) => ({
      memberId,
      slotIdx,
      slotId: `${memberId}-${slotIdx}`,
    })),
  );
}

/** Pick N judge slots with cross-member diversity (round-robin by memberId). */
export function pickJudgeSlots(slots: CouncilSlot[], n: number): CouncilSlot[] {
  const byMember = new Map<CouncilMemberId, CouncilSlot[]>();
  for (const s of slots) {
    const arr = byMember.get(s.memberId) ?? [];
    arr.push(s);
    byMember.set(s.memberId, arr);
  }
  const members = [...byMember.keys()];
  const picked: CouncilSlot[] = [];
  let i = 0;
  while (picked.length < n && picked.length < slots.length) {
    const memberId = members[i % members.length]!;
    const available = byMember.get(memberId) ?? [];
    if (available.length > 0) {
      picked.push(available.shift()!);
    }
    i++;
    if (i > members.length * n) break; // safety
  }
  return picked;
}
