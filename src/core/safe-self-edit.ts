// Safe Self-Edit Gate — Protected file guard + audit log for DanteForge self-modifications
import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

// Protected paths that require audit before modification.
// These are the critical DanteForge core files whose mutation could destabilize the system.
const PROTECTED_PATHS = [
  'src/core/state.ts',
  'src/core/gates.ts',
  'src/core/handoff.ts',
  'src/core/workflow-enforcer.ts',
  'src/core/autoforge.ts',
  'src/core/pdse.ts',
  'src/cli/index.ts',
];

const AUDIT_DIR = '.danteforge/audit';
const AUDIT_FILE = path.join(AUDIT_DIR, 'self-edit.log');

export interface SelfEditAuditEntry {
  timestamp: string;
  filePath: string;
  action: 'write' | 'delete' | 'rename';
  reason: string;
  approved: boolean;
  beforeHash?: string;
  afterHash?: string;
}

/**
 * Normalize a file path and check whether it is in the protected list.
 * Accepts both forward-slash and backslash separators.
 */
export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return PROTECTED_PATHS.some(protected_ => {
    const normalizedProtected = protected_.replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized === normalizedProtected || normalized.endsWith('/' + normalizedProtected);
  });
}

/**
 * Compute a SHA-256 hex digest of file content.
 */
export function computeFileHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Append a SelfEditAuditEntry as a JSON line to the audit log.
 * Creates the audit directory if it does not already exist.
 */
export async function auditSelfEdit(entry: SelfEditAuditEntry, cwd?: string): Promise<void> {
  const base = cwd ?? process.cwd();
  const auditDir = path.join(base, AUDIT_DIR);
  const auditFile = path.join(base, AUDIT_FILE);

  await fs.mkdir(auditDir, { recursive: true });
  await fs.appendFile(auditFile, JSON.stringify(entry) + '\n', 'utf8');
  logger.verbose(`Self-edit audit written: ${entry.action} ${entry.filePath} (approved=${entry.approved})`);
}

/**
 * Read and parse all entries from the audit log.
 * Returns an empty array if the log does not yet exist.
 */
export async function loadAuditLog(cwd?: string): Promise<SelfEditAuditEntry[]> {
  const base = cwd ?? process.cwd();
  const auditFile = path.join(base, AUDIT_FILE);

  let raw: string;
  try {
    raw = await fs.readFile(auditFile, 'utf8');
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const entries: SelfEditAuditEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as SelfEditAuditEntry);
    } catch {
      logger.warn(`Skipping malformed audit log entry: ${trimmed.slice(0, 80)}`);
    }
  }
  return entries;
}

/**
 * Request approval for a self-edit operation on a potentially protected file.
 *
 * In v0.8.0 all requests are auto-approved (Pro escalation gate is deferred).
 * An audit entry is always written regardless of whether the file is protected.
 *
 * Returns true when the edit may proceed (always in v0.8.0).
 */
export async function requestSelfEditApproval(
  filePath: string,
  reason: string,
  cwd?: string,
): Promise<boolean> {
  const protected_ = isProtectedPath(filePath);

  if (protected_) {
    logger.warn(`Self-edit requested on protected path: ${filePath}`);
    logger.info(`Reason: ${reason}`);
    logger.info('Auto-approving (Pro escalation gate deferred to v0.8.0+)');
  }

  const entry: SelfEditAuditEntry = {
    timestamp: new Date().toISOString(),
    filePath,
    action: 'write',
    reason,
    approved: true,
  };

  await auditSelfEdit(entry, cwd);

  if (protected_) {
    logger.success(`Self-edit approved and logged for protected file: ${filePath}`);
  }

  return true;
}
