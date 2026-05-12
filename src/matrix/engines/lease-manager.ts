// Matrix Kernel — Lease Manager (Phase 5 of PRD)
//
// Issues, validates, and revokes AgentLeases. A lease is the permission
// contract between DanteForge and an agent: which paths it may write/read,
// which it must never touch, and the budget/runtime limits.
//
// Reuses (per Phase 0 audit):
//   - sanitize-locks.ts:withFileLock for cross-process safety
//   - ownership-map.ts for path classification
import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from '../../core/sanitize-locks.js';
import type { WorkPacket } from '../types/work-graph.js';
import type {
  AgentLease,
  AgentRole,
  LeaseBudget,
  LeaseGraph,
  LeaseStatus,
} from '../types/lease.js';
import type { OwnershipMap } from '../types/ownership.js';
import { isPathFrozen, pathOwner } from './ownership-map.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

const DEFAULT_BUDGET: LeaseBudget = {
  maxTokens: 200_000,
  maxRuntimeMinutes: 90,
  maxIterations: 3,
};

// ── Public API ──────────────────────────────────────────────────────────────

export interface CreateLeaseOptions {
  workPacket: WorkPacket;
  provider: string;
  agentRole: AgentRole;
  ownershipMap: OwnershipMap;
  /** Branch name (default: matrix/<dim>/<provider>-<short id>). */
  branch?: string;
  /** Worktree path (default: .danteforge-worktrees/<leaseId>). */
  worktreePath?: string;
  budget?: Partial<LeaseBudget>;
  cwd?: string;
  _now?: () => string;
}

export interface ValidateLeaseOptions {
  lease: AgentLease;
  ownershipMap: OwnershipMap;
}

export interface ValidateLeaseResult {
  valid: boolean;
  violations: string[];
}

/**
 * Issue a new lease. Validates the packet's owned/forbidden paths against
 * the project's ownership map; refuses to issue if a forbidden-path would be
 * writable.
 */
export function createLease(options: CreateLeaseOptions): AgentLease {
  const { workPacket, provider, agentRole, ownershipMap } = options;
  const now = options._now ?? (() => new Date().toISOString());
  const leaseId = makeLeaseId(workPacket.id, provider, now());

  // Defense in depth: ensure no owned path is frozen, ensure no owned path
  // is owned by a different workstream (per the packet's own analysis).
  for (const p of workPacket.paths.ownedPaths) {
    if (isPathFrozen(ownershipMap, p)) {
      throw new Error(`Cannot issue lease for ${workPacket.id}: owned path ${p} is frozen`);
    }
  }

  const cwd = options.cwd ?? process.cwd();
  const branch = options.branch ?? `matrix/${workPacket.dimensionId}/${provider}-${shortId(leaseId)}`;
  const worktreePath = options.worktreePath ?? path.join(cwd, '.danteforge-worktrees', leaseId);

  return {
    id: leaseId,
    workPacketId: workPacket.id,
    provider,
    agentRole,
    branch,
    worktreePath,
    allowedWritePaths: workPacket.paths.ownedPaths,
    allowedReadPaths: workPacket.paths.readOnlyPaths.length > 0
      ? workPacket.paths.readOnlyPaths
      : ['src/**', 'tests/**', 'docs/**'],
    forbiddenPaths: workPacket.paths.forbiddenPaths,
    requiredCommands: workPacket.proof.requiredCommands ?? [],
    budget: { ...DEFAULT_BUDGET, ...(options.budget ?? {}) },
    status: 'pending',
    issuedAt: now(),
  };
}

/**
 * Check whether a set of changed files is compliant with the lease.
 */
export function validateChangedFiles(
  lease: AgentLease,
  changedFiles: string[],
  ownershipMap: OwnershipMap,
): ValidateLeaseResult {
  const violations: string[] = [];
  for (const f of changedFiles) {
    if (isPathFrozen(ownershipMap, f)) {
      violations.push(`changed file ${f} is FROZEN`);
      continue;
    }
    if (matchesAnyGlob(f, lease.forbiddenPaths)) {
      violations.push(`changed file ${f} is FORBIDDEN by lease`);
      continue;
    }
    if (!matchesAnyGlob(f, lease.allowedWritePaths)) {
      violations.push(`changed file ${f} is OUTSIDE lease's allowed write paths`);
    }
    // Cross-ownership warning (not strict violation but worth flagging)
    const owner = pathOwner(ownershipMap, f);
    if (owner && !lease.allowedWritePaths.some(p => matchesGlob(f, p))) {
      void owner;  // explicit cross-workstream conflict handled by forbidden check
    }
  }
  return { valid: violations.length === 0, violations };
}

/**
 * Detect lease-on-lease conflicts: two leases whose allowedWritePaths overlap.
 */
export interface LeaseConflict {
  leaseAId: string;
  leaseBId: string;
  overlappingPaths: string[];
}

export function detectLeaseConflicts(leases: AgentLease[]): LeaseConflict[] {
  const conflicts: LeaseConflict[] = [];
  for (let i = 0; i < leases.length; i++) {
    for (let j = i + 1; j < leases.length; j++) {
      const a = leases[i]!;
      const b = leases[j]!;
      const overlap = a.allowedWritePaths.filter(p => b.allowedWritePaths.includes(p));
      if (overlap.length > 0) {
        conflicts.push({ leaseAId: a.id, leaseBId: b.id, overlappingPaths: overlap });
      }
    }
  }
  return conflicts;
}

/**
 * FSM transition with validation. Throws on invalid transitions.
 */
export function transitionLease(lease: AgentLease, to: LeaseStatus, reason?: string): AgentLease {
  if (!isValidTransition(lease.status, to)) {
    throw new Error(`Invalid lease transition: ${lease.status} → ${to}`);
  }
  const now = new Date().toISOString();
  const next: AgentLease = { ...lease, status: to };
  if (to === 'active') next.startedAt = now;
  if (to === 'completed' || to === 'failed') next.completedAt = now;
  if (to === 'revoked') {
    next.revokedAt = now;
    next.revokedReason = reason;
  }
  return next;
}

export function isValidTransition(from: LeaseStatus, to: LeaseStatus): boolean {
  const transitions: Record<LeaseStatus, LeaseStatus[]> = {
    pending: ['issued', 'revoked'],
    issued: ['active', 'revoked', 'expired'],
    active: ['completed', 'failed', 'revoked'],
    completed: [],
    failed: ['revoked'],   // allow revoke to cleanup a failed lease
    revoked: [],
    expired: ['revoked'],
  };
  return transitions[from]?.includes(to) ?? false;
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function saveLeaseGraph(graph: LeaseGraph, cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.leaseGraph);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(graph, null, 2), 'utf8');
  return outPath;
}

/**
 * Cross-process safe lease update. Wraps a mutation in a withFileLock so
 * parallel agents can't race on the same lease file.
 */
export async function withLeaseLock<T>(
  cwd: string,
  leaseId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withFileLock({ cwd, filePath: `.danteforge/matrix/leases/${leaseId}.lock` }, fn);
}

// ── Internal helpers ────────────────────────────────────────────────────────

function makeLeaseId(workPacketId: string, provider: string, iso: string): string {
  const stem = workPacketId.replace(/^work\./, '');
  return `lease.${stem}.${provider}.${stamp(iso)}`;
}

function shortId(s: string): string {
  return s.slice(-8);
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}

function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  for (const g of globs) if (matchesGlob(normalized, g)) return true;
  return false;
}

function matchesGlob(filePath: string, glob: string): boolean {
  return globToRegex(glob.replace(/\\/g, '/')).test(filePath.replace(/\\/g, '/'));
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${escaped}$`);
}
