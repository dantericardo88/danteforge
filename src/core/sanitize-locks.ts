// DanteSanitize — Per-file lock coordination (Sprint 6)
//
// Prevents multiple concurrent sanitize runs from racing on the same file.
// Locks are file-based (atomic O_EXCL create), with TTL-based reclaim
// for crashed processes.
import fs from 'node:fs/promises';
import path from 'node:path';

export interface FileLockOptions {
  cwd: string;
  /** cwd-relative path of the file being locked. */
  filePath: string;
  /** Sub-directory under cwd for lock files. */
  lockDir?: string;          // default '.danteforge/sanitize/claims'
  /** Max wait time before giving up (ms). */
  maxWaitMs?: number;        // default 30_000
  /** TTL after which a stale lock is considered abandoned. */
  ttlMs?: number;            // default 15 * 60_000
  /** Polling interval while waiting for lock release. */
  pollIntervalMs?: number;   // default 200
}

export interface LockHandle {
  release(): Promise<void>;
  path: string;
}

const DEFAULT_LOCK_DIR = '.danteforge/sanitize/claims';

/**
 * Acquire an exclusive lock on a file path. Uses O_EXCL atomic file creation
 * via wx flag. Retries with exponential backoff up to `maxWaitMs`. If an
 * existing lock is older than `ttlMs`, it is forcibly reclaimed.
 */
export async function acquireFileLock(options: FileLockOptions): Promise<LockHandle> {
  const lockDir = options.lockDir ?? DEFAULT_LOCK_DIR;
  const maxWait = options.maxWaitMs ?? 30_000;
  const ttl = options.ttlMs ?? 15 * 60_000;
  const pollMs = options.pollIntervalMs ?? 200;

  const lockName = options.filePath.replace(/[/\\:]/g, '_') + '.lock';
  const lockPath = path.join(options.cwd, lockDir, lockName);

  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const lockBody = JSON.stringify({
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    filePath: options.filePath,
  });

  const start = Date.now();
  while (true) {
    try {
      await fs.writeFile(lockPath, lockBody, { flag: 'wx' });
      return {
        path: lockPath,
        release: async () => {
          await fs.unlink(lockPath).catch(() => {});
        },
      };
    } catch (err: unknown) {
      if (!isExistsError(err)) throw err;

      // Lock already held — check if stale
      const isStale = await isLockStale(lockPath, ttl);
      if (isStale) {
        await fs.unlink(lockPath).catch(() => {});
        continue;  // retry immediately
      }

      if (Date.now() - start > maxWait) {
        throw new LockTimeoutError(
          `Could not acquire lock on ${options.filePath} within ${maxWait}ms (lock: ${lockPath})`,
        );
      }

      await sleep(pollMs);
    }
  }
}

export async function withFileLock<T>(
  options: FileLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const handle = await acquireFileLock(options);
  try {
    return await fn();
  } finally {
    await handle.release();
  }
}

async function isLockStale(lockPath: string, ttlMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    return Date.now() - stat.mtimeMs > ttlMs;
  } catch {
    return true;  // can't stat → assume stale
  }
}

function isExistsError(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'EEXIST';
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class LockTimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'LockTimeoutError';
  }
}

// ── Frozen file detection ────────────────────────────────────────────────────

export interface FrozenFilesConfig {
  cwd: string;
  /** Path to agent-guard.json (default: .danteforge/agent-guard.json). */
  guardPath?: string;
}

export async function loadFrozenFiles(config: FrozenFilesConfig): Promise<string[]> {
  const guardPath = config.guardPath ?? path.join(config.cwd, '.danteforge/agent-guard.json');
  try {
    const raw = await fs.readFile(guardPath, 'utf8');
    const data = JSON.parse(raw) as { frozenFiles?: string[] };
    return data.frozenFiles ?? [];
  } catch {
    return [];
  }
}

export interface PlatformKernelNeededInput {
  cwd: string;
  files: { path: string; loc: number }[];
}

export async function writePlatformKernelNeeded(input: PlatformKernelNeededInput): Promise<string> {
  const filePath = path.join(input.cwd, '.danteforge/sanitize/platform-kernel-needed.json');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = {
    ts: new Date().toISOString(),
    note: 'These files exceed the LOC threshold but are listed as frozen. A platform-kernel workstream sprint is required to split them.',
    files: input.files,
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
