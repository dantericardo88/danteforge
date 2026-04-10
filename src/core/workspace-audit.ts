// Workspace audit logging — append-only audit trail for enterprise readiness
// JSON Lines format (.danteforge/workspace-audit.jsonl) for easy ingestion by SIEM tools

import fs from 'fs/promises';
import path from 'path';
import { getWorkspaceDir, type WorkspaceOps } from './workspace.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkspaceAuditAction =
  | 'access_granted'
  | 'access_denied'
  | 'token_issued'
  | 'token_revoked'
  | 'token_verify_failed'
  | 'member_added'
  | 'member_removed'
  | 'workspace_created'
  | 'config_changed';

export type WorkspaceAuditResult = 'success' | 'denied' | 'error';

export interface WorkspaceAuditEntry {
  timestamp: string;       // ISO 8601
  workspaceId: string;
  userId: string;
  role?: string;           // role at time of action (if known)
  action: WorkspaceAuditAction;
  result: WorkspaceAuditResult;
  detail?: string;         // human-readable context (e.g. "required editor, had reviewer")
}

export interface WorkspaceAuditOps {
  _writeFile?: (p: string, content: string) => Promise<void>;
  _readFile?: (p: string) => Promise<string>;
  _mkdir?: (p: string, opts?: { recursive: boolean }) => Promise<void>;
  _now?: () => string;     // ISO timestamp override
  _homedir?: () => string; // forwarded to getWorkspaceDir
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUDIT_FILENAME = 'workspace-audit.jsonl';
const MAX_AUDIT_FILE_SIZE_BYTES = 10_485_760; // 10 MB — rotate beyond this

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAuditFilePath(workspaceId: string, ops?: WorkspaceAuditOps): string {
  const wsDir = getWorkspaceDir(workspaceId, ops as WorkspaceOps);
  return path.join(wsDir, AUDIT_FILENAME);
}

function nowISO(ops?: WorkspaceAuditOps): string {
  return ops?._now?.() ?? new Date().toISOString();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append a single audit entry to the workspace audit log (JSON Lines format).
 * Best-effort: never throws — silently drops on I/O failure to avoid blocking gates.
 */
export async function recordWorkspaceAudit(
  entry: Omit<WorkspaceAuditEntry, 'timestamp'>,
  ops?: WorkspaceAuditOps,
): Promise<void> {
  try {
    const auditPath = getAuditFilePath(entry.workspaceId, ops);
    const dir = path.dirname(auditPath);

    if (ops?._mkdir) {
      await ops._mkdir(dir, { recursive: true });
    } else {
      await fs.mkdir(dir, { recursive: true });
    }

    const fullEntry: WorkspaceAuditEntry = {
      timestamp: nowISO(ops),
      ...entry,
    };
    const line = JSON.stringify(fullEntry) + '\n';

    if (ops?._writeFile) {
      // For testing: caller controls writes entirely
      await ops._writeFile(auditPath, line);
    } else {
      await fs.appendFile(auditPath, line, { encoding: 'utf-8' });
    }
  } catch {
    // Best-effort — audit must never block the operation it's observing
  }
}

/**
 * Read all audit entries for a workspace. Returns newest-last order.
 * Skips malformed lines silently.
 */
export async function readWorkspaceAuditLog(
  workspaceId: string,
  ops?: WorkspaceAuditOps,
): Promise<WorkspaceAuditEntry[]> {
  const auditPath = getAuditFilePath(workspaceId, ops);
  let raw: string;
  try {
    raw = ops?._readFile
      ? await ops._readFile(auditPath)
      : await fs.readFile(auditPath, 'utf-8');
  } catch {
    return [];
  }

  const entries: WorkspaceAuditEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as WorkspaceAuditEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

/**
 * Query audit entries matching a filter. Simple in-memory filter for now.
 */
export function filterAuditEntries(
  entries: WorkspaceAuditEntry[],
  filter: {
    userId?: string;
    action?: WorkspaceAuditAction;
    result?: WorkspaceAuditResult;
    since?: string; // ISO timestamp — entries at or after this time
  },
): WorkspaceAuditEntry[] {
  return entries.filter((e) => {
    if (filter.userId && e.userId !== filter.userId) return false;
    if (filter.action && e.action !== filter.action) return false;
    if (filter.result && e.result !== filter.result) return false;
    if (filter.since && e.timestamp < filter.since) return false;
    return true;
  });
}

export { MAX_AUDIT_FILE_SIZE_BYTES, AUDIT_FILENAME, getAuditFilePath };
