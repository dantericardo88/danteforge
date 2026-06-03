// ascend-frontier-parallel.ts — fan out the frontier push across council members.
//
// Each live member OWNS a different dimension and pushes it to the frontier concurrently, in an
// isolated worktree. The frontier-review-court gates each dim with builder-never-judges (the member
// who built dim X cannot judge X — the other members do). Builds run in parallel; promotion is
// SERIAL (one candidate at a time) so matrix/score writes never race. A round-level reciprocity
// detector flags mutual-pass pairs (A passes B's dim AND B passes A's) for mandatory human audit —
// the structural defense against members rubber-stamping each other.
//
// The scheduling and reciprocity logic are pure + tested here; the heavy per-dim push (worktree +
// build + session-record + validate + frontier-review + promote) is injected.

import type { CouncilMemberId } from '../matrix/engines/council-scheduler.js';
import { isCeilingActive } from './ceiling-receipt.js';
import { isDimDone, type DimState } from './ascend-frontier-engine.js';
import { enqueueAudit, type AuditEscrowEntry } from './audit-escrow.js';

export interface RoundAssignment { memberId: CouncilMemberId; dimId: string; }

export interface PushOutcome {
  dimId: string;
  builderId: CouncilMemberId;
  verdict: 'VALIDATED' | 'REJECTED';
  /** Judge members (non-builder) who returned PASS — used for reciprocity detection. */
  passedByJudges: CouncilMemberId[];
}

export interface ReciprocalPair { memberA: CouncilMemberId; memberB: CouncilMemberId; dimA: string; dimB: string; }

/**
 * Assign the weakest incomplete dims to members, one per member, skipping a dim whose declared
 * touched-files collide with an already-assigned dim this round (deferred to a later round). Pure.
 */
export function assignRound(
  dims: DimState[],
  members: CouncilMemberId[],
  opts: { nowIso: string; touchedFiles?: (dimId: string) => string[] },
): RoundAssignment[] {
  const active = (d: DimState): boolean => d.ceiling != null && isCeilingActive(d.ceiling, opts.nowIso);
  const incomplete = dims
    .filter(d => !isDimDone(d, opts.nowIso) && !active(d) && d.effectiveScore >= 7.0)
    .sort((a, b) => a.effectiveScore - b.effectiveScore);

  const assignments: RoundAssignment[] = [];
  const assigned = new Set<string>();
  const claimedFiles = new Set<string>();
  for (const member of members) {
    for (const d of incomplete) {
      if (assigned.has(d.id)) continue;
      const files = opts.touchedFiles?.(d.id) ?? [];
      if (files.some(f => claimedFiles.has(f))) continue; // file collision → defer this dim
      assignments.push({ memberId: member, dimId: d.id });
      assigned.add(d.id);
      for (const f of files) claimedFiles.add(f);
      break;
    }
  }
  return assignments;
}

/**
 * Find mutual-pass pairs in a round: A built dimA and judged dimB PASS, while B built dimB and
 * judged dimA PASS. Each such pair is a potential rubber-stamp → mandatory human audit. Pure.
 */
export function detectReciprocity(outcomes: PushOutcome[]): ReciprocalPair[] {
  const pairs: ReciprocalPair[] = [];
  const seen = new Set<string>();
  for (const oa of outcomes) {
    for (const ob of outcomes) {
      if (oa.builderId === ob.builderId) continue;
      const A = oa.builderId, B = ob.builderId;
      const key = [A, B].sort().join('|');
      if (seen.has(key)) continue;
      // A judged B's dim (ob) PASS AND B judged A's dim (oa) PASS.
      if (ob.passedByJudges.includes(A) && oa.passedByJudges.includes(B)) {
        pairs.push({ memberA: A, memberB: B, dimA: oa.dimId, dimB: ob.dimId });
        seen.add(key);
      }
    }
  }
  return pairs;
}

export interface ParallelRoundResult {
  assignments: RoundAssignment[];
  outcomes: PushOutcome[];
  reciprocalPairs: ReciprocalPair[];
  validated: string[];
}

/**
 * Run one parallel round with the council's concurrency contract: a CONCURRENT build-all (each
 * member builds its dim in an isolated worktree, merged to main — `buildAll` owns that), then a
 * SERIAL promote per dim (session-record + validate + frontier-review write to matrix.json, so they
 * must not race). Then detect reciprocity and enqueue mandatory audits for reciprocal pairs.
 */
export async function runParallelRound(
  cwd: string,
  assignments: RoundAssignment[],
  opts: {
    /** Concurrent, worktree-isolated build of the round's dims, merged to main. */
    buildAll: (cwd: string, assignments: RoundAssignment[]) => Promise<void>;
    /** Serial promote of ONE dim: capture evidence + run the court. Writes matrix — never concurrent. */
    promoteOne: (cwd: string, a: RoundAssignment) => Promise<PushOutcome>;
    _enqueueAudit?: (cwd: string, entry: AuditEscrowEntry) => Promise<void>;
    nowIso: string;
  },
): Promise<ParallelRoundResult> {
  await opts.buildAll(cwd, assignments); // parallel build in worktrees → merged to main
  const outcomes: PushOutcome[] = [];
  for (const a of assignments) {
    // SERIAL: each promote writes matrix.json/receipts; running them concurrently would race.
    try { outcomes.push(await opts.promoteOne(cwd, a)); }
    catch { outcomes.push({ dimId: a.dimId, builderId: a.memberId, verdict: 'REJECTED', passedByJudges: [] }); }
  }

  const reciprocalPairs = detectReciprocity(outcomes);
  const enqueue = opts._enqueueAudit ?? enqueueAudit;
  for (const p of reciprocalPairs) {
    for (const [dimId, builder, other] of [[p.dimA, p.memberA, p.memberB], [p.dimB, p.memberB, p.memberA]] as const) {
      await enqueue(cwd, {
        dimId, kind: 'reciprocal-pair', replayCommand: `frontier-review ${dimId} --builder ${builder}`,
        artifacts: [], frontierSpecHash: '', receipts: [],
        councilVote: { pass: 1, fail: 0, summary: `reciprocal pass with ${other} — needs human review` },
        dissent: [`${builder} and ${other} cross-passed each other's dims this round`],
        enqueuedAt: opts.nowIso, status: 'pending',
      });
    }
  }

  return {
    assignments, outcomes, reciprocalPairs,
    validated: outcomes.filter(o => o.verdict === 'VALIDATED').map(o => o.dimId),
  };
}
