// Safe Self-Edit Gate — Protected file guard + audit log for DanteForge self-modifications
// Includes rollback-on-failure support: callers can wrap an edit operation with
// `withRollback` to guarantee the original file content is restored if the operation
// fails or if the post-edit validation step does not pass.
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
  // Project config files — changes here break the build / all tests
  'package.json',
  'tsconfig.json',
  'tsconfig.tsbuildinfo',
  '.gitignore',
  'README.md',
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

// ── Checkpoint / restore-point support ────────────────────────────────────────

/**
 * A restore point created before applying edits. Can be used to roll back
 * an arbitrary sequence of changes applied after `withCheckpoint` was called.
 */
export interface Checkpoint {
  /** ISO timestamp when the checkpoint was taken. */
  createdAt: string;
  /** Map of absolute file path → original content at checkpoint time. */
  snapshots: Map<string, string>;
}

export interface WithCheckpointOptions {
  /** File paths (absolute) to snapshot before the operation. */
  filePaths: string[];
  /** Inject for testing — override fs.readFile */
  _readFile?: (p: string) => Promise<string>;
  /** Inject for testing — override fs.writeFile */
  _writeFile?: (p: string, content: string) => Promise<void>;
}

export interface WithCheckpointResult<T> {
  result: T | null;
  rolledBack: boolean;
  rollbackReason?: string;
  checkpoint: Checkpoint;
}

/**
 * Creates a restore point for the listed files, runs `editFn`, and automatically
 * rolls back ALL snapshotted files if `editFn` throws.
 *
 * Unlike `withRollback` (which handles a single file), `withCheckpoint` handles
 * an arbitrary set of files atomically — useful when a forge wave may touch
 * multiple files and you want a single rollback to undo all changes.
 *
 * Flow:
 *   1. Snapshot each listed file (skip files that don't exist yet).
 *   2. Run `editFn(checkpoint)`.
 *   3. On success → return result.
 *   4. On throw → restore all snapshotted files, return rolledBack=true.
 */
export async function withCheckpoint<T>(
  opts: WithCheckpointOptions,
  editFn: (checkpoint: Checkpoint) => Promise<T>,
  cwd?: string,
): Promise<WithCheckpointResult<T>> {
  const readFileFn = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFileFn = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  const checkpoint: Checkpoint = {
    createdAt: new Date().toISOString(),
    snapshots: new Map(),
  };

  // Step 1: snapshot all listed files
  for (const filePath of opts.filePaths) {
    try {
      const content = await readFileFn(filePath);
      checkpoint.snapshots.set(filePath, content);
    } catch {
      // File may not exist yet — skip; there is nothing to restore for it
    }
  }

  // Step 2: run the edit operation
  try {
    const result = await editFn(checkpoint);
    return { result, rolledBack: false, checkpoint };
  } catch (err) {
    const rollbackReason = `edit-threw: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn(`[safe-self-edit] withCheckpoint: edit failed — rolling back ${checkpoint.snapshots.size} file(s). Reason: ${rollbackReason}`);

    // Step 3: restore all snapshotted files
    for (const [filePath, originalContent] of checkpoint.snapshots) {
      try {
        await writeFileFn(filePath, originalContent);
        logger.verbose(`[safe-self-edit] Restored: ${filePath}`);
      } catch (restoreErr) {
        logger.error(`[safe-self-edit] ROLLBACK FAILED for ${filePath}: ${String(restoreErr)}`);
      }
    }

    // Audit the rollback (best-effort)
    for (const filePath of checkpoint.snapshots.keys()) {
      await auditSelfEdit({
        timestamp: new Date().toISOString(),
        filePath,
        action: 'write',
        reason: `checkpoint rollback: ${rollbackReason}`,
        approved: false,
        policy: 'deny',
      }, cwd).catch(() => {});
    }

    return { result: null, rolledBack: true, rollbackReason, checkpoint };
  }
}

// ── Rollback-on-failure support ────────────────────────────────────────────────

export interface RollbackContext {
  filePath: string;
  originalContent: string;
}

export interface WithRollbackOptions {
  /** Inject for testing */
  _readFile?: (p: string) => Promise<string>;
  /** Inject for testing */
  _writeFile?: (p: string, content: string) => Promise<void>;
  /** Optional post-edit validation. If it returns false, rollback is triggered. */
  validate?: (filePath: string) => Promise<boolean>;
}

export interface WithRollbackResult<T> {
  result: T | null;
  rolledBack: boolean;
  rollbackReason?: string;
  beforeHash: string;
  afterHash: string | null;
}

/**
 * Wrap a file edit operation with automatic rollback on failure.
 *
 * Flow:
 *   1. Snapshot the original file content (compute SHA-256).
 *   2. Run the edit operation (callback).
 *   3. If `validate` is provided, call it. If it returns false → rollback.
 *   4. If the edit operation throws → rollback.
 *   5. Write an audit log entry recording the before/after hashes.
 *
 * The function NEVER throws — errors are captured in the result so callers
 * can decide how to surface them.
 */
export async function withRollback<T>(
  filePath: string,
  reason: string,
  editFn: (filePath: string, originalContent: string) => Promise<T>,
  opts: WithRollbackOptions = {},
  cwd?: string,
): Promise<WithRollbackResult<T>> {
  const readFileFn = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFileFn = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  // Step 1: snapshot original
  let originalContent: string;
  try {
    originalContent = await readFileFn(filePath);
  } catch (err) {
    logger.warn(`[safe-self-edit] withRollback: cannot read ${filePath} — ${String(err)}`);
    return { result: null, rolledBack: false, rollbackReason: 'file-read-error', beforeHash: '', afterHash: null };
  }

  const beforeHash = computeFileHash(originalContent);

  // Step 2: run edit operation
  let editResult: T;
  try {
    editResult = await editFn(filePath, originalContent);
  } catch (err) {
    const rollbackReason = `edit-threw: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn(`[safe-self-edit] Edit failed on ${filePath} — rolling back. Reason: ${rollbackReason}`);
    try {
      await writeFileFn(filePath, originalContent);
    } catch (restoreErr) {
      logger.error(`[safe-self-edit] ROLLBACK FAILED for ${filePath}: ${String(restoreErr)}`);
    }
    await auditSelfEdit({ timestamp: new Date().toISOString(), filePath, action: 'write', reason, approved: false, policy: 'deny', beforeHash, afterHash: undefined }, cwd).catch(() => {});
    return { result: null, rolledBack: true, rollbackReason, beforeHash, afterHash: null };
  }

  // Step 3: read post-edit content and hash
  let afterContent: string;
  try {
    afterContent = await readFileFn(filePath);
  } catch {
    afterContent = originalContent; // treat as no-op
  }
  const afterHash = computeFileHash(afterContent);

  // Step 4: optional validation
  if (opts.validate) {
    let valid = false;
    try {
      valid = await opts.validate(filePath);
    } catch (vErr) {
      valid = false;
      logger.warn(`[safe-self-edit] Validation threw for ${filePath}: ${String(vErr)}`);
    }

    if (!valid) {
      const rollbackReason = 'validation-failed';
      logger.warn(`[safe-self-edit] Validation failed for ${filePath} — rolling back`);
      try {
        await writeFileFn(filePath, originalContent);
      } catch (restoreErr) {
        logger.error(`[safe-self-edit] ROLLBACK FAILED for ${filePath}: ${String(restoreErr)}`);
      }
      await auditSelfEdit({ timestamp: new Date().toISOString(), filePath, action: 'write', reason, approved: false, policy: 'deny', beforeHash, afterHash }, cwd).catch(() => {});
      return { result: null, rolledBack: true, rollbackReason, beforeHash, afterHash };
    }
  }

  // Step 5: audit successful edit
  await auditSelfEdit({ timestamp: new Date().toISOString(), filePath, action: 'write', reason, approved: true, policy: 'allow-with-audit', beforeHash, afterHash }, cwd).catch(() => {});
  return { result: editResult, rolledBack: false, beforeHash, afterHash };
}
