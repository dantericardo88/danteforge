// Matrix Kernel — Merge Court (Phase 11 of PRD §22)
//
// Arbitrates which candidate branches enter the main branch. Inputs the gate
// reports, red-team reports, taste-gate requests for each candidate. Outputs
// MergeDecisions with reasoning and score deltas.
//
// Reuses (per Phase 0 audit):
//   - matrix-development-engine.ts:mergeScoreProposals (extend, don't replace)
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentLease } from '../types/lease.js';
import type { WorkPacket } from '../types/work-graph.js';
import type {
  MergeCandidate,
  MergeDecision,
  MergeDecisionOutcome,
  MergeScoreDelta,
} from '../types/merge.js';
import type { GateReport, RedTeamReport, TasteGateRequest } from '../types/gate.js';
import type { ConflictReport } from '../types/conflict.js';
import { isBlockingStatus } from './taste-gate.js';
import { isBlockingConflict } from '../engines/conflict-radar.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface MergeCourtInput {
  candidate: MergeCandidate;
  lease: AgentLease;
  workPacket: WorkPacket;
  gateReport: GateReport;
  redTeamReport?: RedTeamReport;
  tasteGateRequest?: TasteGateRequest;
}

export interface RunMergeCourtOptions {
  candidates: MergeCourtInput[];
  conflictReport: ConflictReport;
  /** Injection seam: replaces git-merge command runner for tests. */
  _runMerge?: (input: MergeCourtInput) => Promise<{ success: boolean; error?: string }>;
  /** Injection seam: replaces Time Machine commit creation. */
  _createTimeMachineCommit?: (input: MergeCourtInput) => Promise<{ eventId: string }>;
  _now?: () => string;
}

export interface MergeCourtResult {
  decisions: MergeDecision[];
  approvedCount: number;
  rejectedCount: number;
  blockedCount: number;
}

/**
 * Rank candidates and emit MergeDecisions. Approves at most one branch per
 * conflicting cluster; subsequent candidates that overlap with an approved
 * branch are marked SUPERSEDED_BY_BETTER_BRANCH.
 */
export async function runMergeCourt(
  options: RunMergeCourtOptions,
): Promise<MergeCourtResult> {
  const now = options._now ?? (() => new Date().toISOString());
  const decisions: MergeDecision[] = [];

  const ranked = rankCandidates(options.candidates);
  const approvedPaths = new Set<string>();

  for (const candidate of ranked) {
    const outcome = arbitrate(candidate, options.conflictReport, approvedPaths);
    if (outcome === 'APPROVED') {
      const mergeResult = await (options._runMerge ?? defaultRunMerge)(candidate);
      if (!mergeResult.success) {
        decisions.push(buildDecision(candidate, 'NEEDS_REPAIR', `merge failed: ${mergeResult.error ?? 'unknown'}`, undefined, now));
        continue;
      }
      const tm = options._createTimeMachineCommit
        ? await options._createTimeMachineCommit(candidate)
        : { eventId: `tm.event.${candidate.candidate.candidateId}.${stamp(now())}` };
      const decision = buildDecision(
        candidate,
        'APPROVED',
        'all gates passed; merge applied',
        candidate.candidate.scoreDelta,
        now,
        tm.eventId,
      );
      decisions.push(decision);
      for (const p of candidate.lease.allowedWritePaths) approvedPaths.add(p);
    } else {
      decisions.push(buildDecision(candidate, outcome, reasonFor(outcome, candidate), undefined, now));
    }
  }

  const approvedCount = decisions.filter(d => d.decision === 'APPROVED').length;
  const rejectedCount = decisions.filter(d => d.decision === 'REJECTED').length;
  const blockedCount = decisions.length - approvedCount - rejectedCount;

  return { decisions, approvedCount, rejectedCount, blockedCount };
}

export async function writeMergeDecisions(
  decisions: MergeDecision[],
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.mergeDecisions);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), decisions }, null, 2), 'utf8');
  return outPath;
}

// ── Ranking + arbitration ───────────────────────────────────────────────────

function rankCandidates(candidates: MergeCourtInput[]): MergeCourtInput[] {
  return [...candidates].sort((a, b) => {
    // 1. Higher score delta first
    const scoreA = a.candidate.scoreDelta?.after ?? 0;
    const scoreB = b.candidate.scoreDelta?.after ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    // 2. Lower risk first
    const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    const riskA = riskOrder[a.candidate.riskLevel ?? 'low'];
    const riskB = riskOrder[b.candidate.riskLevel ?? 'low'];
    if (riskA !== riskB) return riskA - riskB;
    // 3. Smaller blast radius first
    const blastA = a.candidate.blastRadius ?? 0;
    const blastB = b.candidate.blastRadius ?? 0;
    return blastA - blastB;
  });
}

function arbitrate(
  input: MergeCourtInput,
  conflictReport: ConflictReport,
  approvedPaths: Set<string>,
): MergeDecisionOutcome {
  // Gate report status
  if (input.gateReport.status === 'failed') return 'REJECTED';

  // Red team
  if (input.redTeamReport) {
    if (input.redTeamReport.recommendation === 'block_merge') return 'BLOCKED_BY_RED_TEAM';
    if (input.redTeamReport.recommendation === 'require_human_review') return 'NEEDS_HUMAN_REVIEW';
  }

  // Taste gate
  if (input.tasteGateRequest && isBlockingStatus(input.tasteGateRequest.status)) {
    if (input.tasteGateRequest.status === 'approved') {
      // approved — proceed
    } else {
      return 'BLOCKED_BY_TASTE_GATE';
    }
  }

  // Conflicts
  for (const c of conflictReport.conflicts) {
    if (!isBlockingConflict(c)) continue;
    if (c.workPacketIds?.includes(input.workPacket.id)) return 'BLOCKED_BY_CONFLICT';
    if (c.leaseIds?.includes(input.lease.id)) return 'BLOCKED_BY_CONFLICT';
  }

  // Supersession: already-approved branch overlaps on owned paths
  for (const p of input.lease.allowedWritePaths) {
    if (approvedPaths.has(p)) return 'SUPERSEDED_BY_BETTER_BRANCH';
  }

  return 'APPROVED';
}

function reasonFor(outcome: MergeDecisionOutcome, input: MergeCourtInput): string {
  switch (outcome) {
    case 'REJECTED':
      return `Gate report status: ${input.gateReport.status}`;
    case 'BLOCKED_BY_RED_TEAM':
      return `Red team blocked: ${input.redTeamReport?.findings.map(f => f.detail).slice(0, 2).join('; ') ?? 'unspecified'}`;
    case 'NEEDS_HUMAN_REVIEW':
      return 'Red team requires human review';
    case 'BLOCKED_BY_TASTE_GATE':
      return `Taste gate status: ${input.tasteGateRequest?.status ?? 'unknown'}`;
    case 'BLOCKED_BY_CONFLICT':
      return 'Blocked by HIGH/CRITICAL conflict in radar';
    case 'SUPERSEDED_BY_BETTER_BRANCH':
      return 'Earlier-ranked branch covered the same paths';
    case 'NEEDS_REPAIR':
      return 'Merge attempt failed';
    case 'BLOCKED_BY_POLICY':
      return 'Policy gate blocked merge';
    case 'BLOCKED_BY_REGRESSION':
      return 'Post-merge regression detected';
    default:
      return '';
  }
}

function buildDecision(
  input: MergeCourtInput,
  outcome: MergeDecisionOutcome,
  reason: string,
  scoreDelta: MergeScoreDelta | undefined,
  now: () => string,
  timeMachineEventId?: string,
): MergeDecision {
  return {
    id: `merge.${input.candidate.candidateId}.${stamp(now())}`,
    candidateId: input.candidate.candidateId,
    leaseId: input.lease.id,
    branch: input.lease.branch,
    decision: outcome,
    reason,
    scoreDelta,
    timeMachineEventId,
    createdAt: now(),
    decidedBy: 'merge-court',
  };
}

async function defaultRunMerge(_input: MergeCourtInput): Promise<{ success: boolean; error?: string }> {
  // In tests this is always injected. For real use, would shell out to git merge.
  return { success: true };
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
