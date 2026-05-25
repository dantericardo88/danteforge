// Matrix Kernel — CouncilJudgeQueue
//
// FIFO streaming judge queue for the Hierarchical Multi-Agent Council.
// As each slot finishes building, idle slots from OTHER members pick up
// judging immediately — no waiting for all builders to finish.
//
// Cross-member enforcement: assignNextJudge() only returns a judgeSlot
// whose memberId differs from the candidate's memberId (builder-never-judges).
import type { CouncilMemberId } from './council-scheduler.js';
import type { CouncilSlot } from './council-slot.js';

export interface JudgeCandidate {
  candidateId: string;
  slotId: string;
  memberId: CouncilMemberId;
  dimensionId: string;
  worktreePath: string;
  changedFiles: string[];
  completedAt: string;
  status: 'pending' | 'under-review' | 'judged' | 'merged';
}

export type JudgeFn = (
  judgeSlot: CouncilSlot,
  candidate: JudgeCandidate,
) => Promise<{ consensus: 'PASS' | 'FAIL' | 'SPLIT' }>;

export class CouncilJudgeQueue {
  private readonly queue: JudgeCandidate[] = [];
  private readonly statusMap = new Map<string, JudgeCandidate['status']>();

  enqueue(candidate: JudgeCandidate): void {
    this.queue.push({ ...candidate, status: 'pending' });
    this.statusMap.set(candidate.candidateId, 'pending');
  }

  /**
   * Assigns the next pending candidate to an available idle slot from a different member.
   * Returns null if no eligible (candidate, judgeSlot) pair exists.
   * FIFO: earliest-enqueued pending candidate is considered first.
   */
  assignNextJudge(
    availableSlots: CouncilSlot[],
  ): { candidate: JudgeCandidate; judgeSlot: CouncilSlot } | null {
    for (const candidate of this.queue) {
      if (candidate.status !== 'pending') continue;
      const judgeSlot = availableSlots.find(s => s.memberId !== candidate.memberId);
      if (!judgeSlot) continue;
      candidate.status = 'under-review';
      this.statusMap.set(candidate.candidateId, 'under-review');
      return { candidate, judgeSlot };
    }
    return null;
  }

  markJudgeComplete(candidateId: string, verdict: 'PASS' | 'FAIL' | 'SPLIT'): void {
    const candidate = this.queue.find(c => c.candidateId === candidateId);
    if (!candidate) return;
    candidate.status = verdict === 'PASS' ? 'merged' : 'judged';
    this.statusMap.set(candidateId, candidate.status);
  }

  /**
   * Drain all pending candidates using available slots.
   * Polls until every pending candidate has been judged or no idle cross-member
   * slot can be found (which would indicate a structural deadlock — breaks).
   */
  async drainPending(allSlots: CouncilSlot[], runJudge: JudgeFn): Promise<void> {
    const MAX_IDLE_ITERATIONS = 50;
    let idleCount = 0;

    while (this.hasPending()) {
      const idleSlots = allSlots.filter(s => true); // caller manages slotStatus
      const next = this.assignNextJudge(idleSlots);
      if (!next) {
        idleCount++;
        if (idleCount >= MAX_IDLE_ITERATIONS) break; // structural deadlock
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      idleCount = 0;
      const verdict = await runJudge(next.judgeSlot, next.candidate);
      this.markJudgeComplete(next.candidate.candidateId, verdict.consensus);
    }
  }

  hasPending(): boolean {
    return this.queue.some(c => c.status === 'pending' || c.status === 'under-review');
  }

  getStats(): { pending: number; underReview: number; judged: number; merged: number } {
    let pending = 0, underReview = 0, judged = 0, merged = 0;
    for (const c of this.queue) {
      if (c.status === 'pending') pending++;
      else if (c.status === 'under-review') underReview++;
      else if (c.status === 'judged') judged++;
      else if (c.status === 'merged') merged++;
    }
    return { pending, underReview, judged, merged };
  }

  /** All candidates for inspection/audit. */
  getCandidates(): ReadonlyArray<JudgeCandidate> {
    return this.queue;
  }
}
