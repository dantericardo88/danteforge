// Matrix Kernel — Lease Graph types (PRD §9.5)
// "Map who owns what during a Matrix run."

export type LeaseStatus =
  | 'pending'
  | 'issued'
  | 'active'
  | 'completed'
  | 'failed'
  | 'revoked'
  | 'expired';

export type AgentRole =
  | 'dimension-engineer'
  | 'platform-kernel'
  | 'red-team'
  | 'taste-gate-reviewer'
  | 'merge-arbiter'
  | 'verifier'
  | 'observer';

export interface LeaseBudget {
  maxTokens: number;
  maxRuntimeMinutes: number;
  maxIterations: number;
}

export interface AgentLease {
  id: string;
  workPacketId: string;
  provider: string;              // e.g. "codex", "claude-code", "dantecode", "fake"
  agentRole: AgentRole;
  branch: string;                // git branch name
  worktreePath: string;          // absolute path; from worktree.ts

  allowedWritePaths: string[];
  allowedReadPaths: string[];
  forbiddenPaths: string[];

  requiredCommands: string[];    // must exit 0 before merge
  budget: LeaseBudget;
  status: LeaseStatus;

  issuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface LeaseGraph {
  generatedAt: string;
  leases: AgentLease[];
}

// ── Validation ──────────────────────────────────────────────────────────────

const STATUSES: readonly LeaseStatus[] = [
  'pending', 'issued', 'active', 'completed', 'failed', 'revoked', 'expired',
];

export function isLeaseStatus(value: unknown): value is LeaseStatus {
  return typeof value === 'string' && STATUSES.includes(value as LeaseStatus);
}

export function isAgentLease(value: unknown): value is AgentLease {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.workPacketId === 'string'
    && typeof v.provider === 'string'
    && typeof v.branch === 'string'
    && Array.isArray(v.allowedWritePaths)
    && Array.isArray(v.forbiddenPaths)
    && isLeaseStatus(v.status);
}

export function isLeaseGraph(value: unknown): value is LeaseGraph {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.leases) && v.leases.every(isAgentLease);
}

/** PRD §6 #4: no agent may edit without a Lease. */
export function isActiveLease(lease: AgentLease): boolean {
  return lease.status === 'active' || lease.status === 'issued';
}
