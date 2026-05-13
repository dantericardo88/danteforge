// Matrix Kernel — Merge Court types (PRD §22)

export type MergeDecisionOutcome =
  | 'APPROVED'
  | 'REJECTED'
  | 'NEEDS_REPAIR'
  | 'NEEDS_HUMAN_REVIEW'
  | 'SUPERSEDED_BY_BETTER_BRANCH'
  | 'BLOCKED_BY_CONFLICT'
  | 'BLOCKED_BY_REGRESSION'
  | 'BLOCKED_BY_POLICY'
  | 'BLOCKED_BY_TASTE_GATE'
  | 'BLOCKED_BY_RED_TEAM';

export interface MergeScoreDelta {
  dimensionId: string;
  before: number;
  after: number;
}

export interface MergeCandidate {
  candidateId: string;
  leaseId: string;
  workPacketId: string;
  branch: string;
  gateReportId: string;
  redTeamReportId?: string;
  tasteGateRequestId?: string;
  /** Computed rank inputs (lower = higher priority). */
  rank?: number;
  blastRadius?: number;          // number of files touched
  testConfidence?: number;       // 0–1
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  scoreDelta?: MergeScoreDelta;
  /**
   * Files actually changed by the agent run that produced this candidate.
   * Sourced from the corresponding `AgentRunResult.filesChanged`. Merge-court
   * rejects candidates with an empty (or missing) list — a packet that asked
   * for work should not be approved when no work was done.
   *
   * To opt out (e.g. audit-only packets that legitimately produce no diff),
   * set `allowEmptyDiff: true` on the candidate.
   */
  filesChanged?: string[];
  /** Opt-out flag for the no-diff rejection — reserved for audit-only flows. */
  allowEmptyDiff?: boolean;
}

export interface MergeDecision {
  id: string;
  candidateId: string;
  leaseId: string;
  branch: string;
  decision: MergeDecisionOutcome;
  reason: string;
  scoreDelta?: MergeScoreDelta;
  /** ID of the Time Machine event recording this decision. */
  timeMachineEventId?: string;
  /** Path of the post-merge verification report, if run. */
  postMergeVerificationPath?: string;
  /** If rolled back, the rollback point reference. */
  rollbackTo?: string;
  createdAt: string;
  decidedBy?: string;            // "merge-court" | "human:<user>" | "merge-arbiter:<agent>"
}

// ── Validation ──────────────────────────────────────────────────────────────

const OUTCOMES: readonly MergeDecisionOutcome[] = [
  'APPROVED', 'REJECTED', 'NEEDS_REPAIR', 'NEEDS_HUMAN_REVIEW',
  'SUPERSEDED_BY_BETTER_BRANCH', 'BLOCKED_BY_CONFLICT', 'BLOCKED_BY_REGRESSION',
  'BLOCKED_BY_POLICY', 'BLOCKED_BY_TASTE_GATE', 'BLOCKED_BY_RED_TEAM',
];

export function isMergeOutcome(v: unknown): v is MergeDecisionOutcome {
  return typeof v === 'string' && OUTCOMES.includes(v as MergeDecisionOutcome);
}

export function isMergeCandidate(value: unknown): value is MergeCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.candidateId === 'string'
    && typeof v.leaseId === 'string'
    && typeof v.workPacketId === 'string'
    && typeof v.branch === 'string'
    && typeof v.gateReportId === 'string';
}

export function isMergeDecision(value: unknown): value is MergeDecision {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.candidateId === 'string'
    && typeof v.branch === 'string'
    && isMergeOutcome(v.decision)
    && typeof v.reason === 'string';
}

export function isApproved(decision: MergeDecision): boolean {
  return decision.decision === 'APPROVED';
}
