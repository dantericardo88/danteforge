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
  // Security-critical additions (2026-04-08)
  'src/core/llm.ts',
  'src/core/prompt-builder.ts',
  'src/core/mcp-server.ts',
  'src/core/input-validation.ts',
  'src/core/circuit-breaker.ts',
];

const AUDIT_DIR = '.danteforge/audit';
const AUDIT_FILE = path.join(AUDIT_DIR, 'self-edit.log');

export type SelfEditPolicy = 'deny' | 'confirm' | 'allow-with-audit';

export interface SelfEditAuditEntry {
  timestamp: string;
  filePath: string;
  action: 'write' | 'delete' | 'rename';
  reason: string;
  approved: boolean;
  policy: SelfEditPolicy;
  beforeHash?: string;
  afterHash?: string;
}

export interface SelfEditApprovalOptions {
  cwd?: string;
  policy?: SelfEditPolicy;
  /** Test injection: override TTY detection */
  _isTTY?: boolean;
  /** Test injection: provide readline for confirm mode */
  _readLine?: () => Promise<string>;
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
  logger.verbose(`Self-edit audit written: ${entry.action} ${entry.filePath} (approved=${entry.approved}, policy=${entry.policy})`);
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
 * Policy modes:
 *   deny (default) — protected paths are blocked; non-protected always approved
 *   allow-with-audit — protected paths approved with warning log (explicit opt-in)
 *   confirm — interactive y/N prompt in TTY; degrades to deny in non-TTY contexts
 *
 * Accepts either a legacy string cwd argument or a SelfEditApprovalOptions object
 * for backward compatibility with existing callers.
 */
export async function requestSelfEditApproval(
  filePath: string,
  reason: string,
  cwdOrOptions?: string | SelfEditApprovalOptions,
): Promise<boolean> {
  const opts: SelfEditApprovalOptions =
    typeof cwdOrOptions === 'string' ? { cwd: cwdOrOptions } : (cwdOrOptions ?? {});
  const cwd = opts.cwd;
  const policy: SelfEditPolicy = opts.policy ?? 'deny';
  const protected_ = isProtectedPath(filePath);

  let approved: boolean;

  if (!protected_) {
    approved = true;
  } else {
    switch (policy) {
      case 'deny':
        approved = false;
        logger.error(`Self-edit DENIED: ${filePath} is a protected path (policy=deny)`);
        logger.error(`Reason given: ${reason}`);
        logger.error('To allow: pass policy "confirm" or "allow-with-audit" to requestSelfEditApproval');
        break;

      case 'allow-with-audit':
        approved = true;
        logger.warn(`Self-edit APPROVED with audit: ${filePath} (policy=allow-with-audit)`);
        logger.info(`Reason: ${reason}`);
        break;

      case 'confirm': {
        const isTTY = opts._isTTY ?? (process.stdin.isTTY === true);
        if (!isTTY) {
          approved = false;
          logger.error(`Self-edit DENIED: ${filePath} — confirm mode requires interactive TTY, none available`);
          logger.error('Run interactively or use policy "allow-with-audit" to approve non-interactively');
        } else {
          logger.warn(`Self-edit requested on protected path: ${filePath}`);
          logger.warn(`Reason: ${reason}`);
          process.stdout.write('Allow this protected edit? [y/N] ');
          const readLine = opts._readLine ?? (() =>
            new Promise<string>(resolve => {
              let buf = '';
              process.stdin.setEncoding('utf8');
              process.stdin.once('data', (chunk: string) => {
                buf += chunk;
                resolve(buf.trim());
              });
            })
          );
          const answer = await readLine();
          approved = answer.toLowerCase() === 'y';
          if (!approved) {
            logger.error('Self-edit denied by user.');
          } else {
            logger.success('Self-edit approved by user.');
          }
        }
        break;
      }

      default:
        approved = false;
    }
  }

  const entry: SelfEditAuditEntry = {
    timestamp: new Date().toISOString(),
    filePath,
    action: 'write',
    reason,
    approved,
    policy,
  };

  await auditSelfEdit(entry, cwd);
  return approved;
}

/**
 * Detective control: run after a forge wave completes to detect whether any
 * protected paths were mutated. Writes an audit entry for each violation.
 *
 * This is NOT a preventive gate — it cannot undo changes already made by the
 * LLM. It provides audit evidence and, under 'deny' policy, fails the forge
 * wave so the user is informed before the changes propagate further.
 */
export async function auditPostForgeProtectedMutations(
  changedFiles: string[],
  policy: SelfEditPolicy,
  opts?: { cwd?: string },
): Promise<{ violations: string[] }> {
  const protectedTouched = changedFiles.filter(f => isProtectedPath(f));
  const violations: string[] = [];

  for (const filePath of protectedTouched) {
    const approved = policy === 'allow-with-audit';
    const entry: SelfEditAuditEntry = {
      timestamp: new Date().toISOString(),
      filePath,
      action: 'write',
      reason: 'post-forge git diff detected mutation',
      approved,
      policy,
    };
    await auditSelfEdit(entry, opts?.cwd);

    if (approved) {
      logger.warn(`[Forge] Self-edit APPROVED with audit: ${filePath} (policy=allow-with-audit)`);
    } else {
      violations.push(filePath);
      logger.error(`[Forge] Self-edit DENIED: ${filePath} was mutated but policy=${policy} forbids it.`);
      logger.error('  Run `danteforge policy set allow-with-audit` to permit and audit self-modifications.');
    }
  }

  return { violations };
}
