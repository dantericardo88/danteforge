// state-lock.ts — Advisory PID lock file for STATE.yaml serialization.
// No external dependencies. Uses fs.open with 'wx' (exclusive create) which is
// atomic on all platforms (POSIX O_EXCL, Windows CREATE_NEW).
import fs from 'fs/promises';
import path from 'path';
import { DanteError } from './errors.js';
class StateError extends DanteError {
  constructor(message: string) { super(message, 'STATE_ERROR', 'Check STATE.yaml'); this.name = 'StateError'; }
}

export const LOCK_MAX_RETRIES = 10;
export const LOCK_BASE_DELAY_MS = 50;

/**
 * Check whether a process with the given PID is alive.
 * Uses signal 0 — sends no signal but validates the PID exists in the OS.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the lock file if the PID it contains belongs to a dead process.
 * Non-throwing — any error (file missing, bad PID) is silently ignored.
 */
export async function clearStaleLock(lockPath: string): Promise<void> {
  try {
    const content = await fs.readFile(lockPath, 'utf8');
    const pid = parseInt(content.trim(), 10);
    if (Number.isNaN(pid) || !isProcessAlive(pid)) {
      await fs.unlink(lockPath);
    }
  } catch { /* lock may already be released or content unreadable */ }
}

/**
 * Acquire an advisory lock by exclusively creating a PID file at `lockPath`.
 * Returns a release function that deletes the lock file.
 *
 * Retries with exponential backoff (base 50ms, max ~1.6s per attempt).
 * Checks for stale locks (dead PIDs) after the 3rd failed attempt.
 * Throws `StateError` with code 'STATE_LOCK_FAILED' after `LOCK_MAX_RETRIES` attempts.
 */
export async function acquireStateLock(lockPath: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(String(process.pid), 'utf8');
      await handle.close();
      return async () => { await fs.unlink(lockPath).catch(() => {}); };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // After a few retries, check if the holding process is already dead
      if (attempt >= 2) await clearStaleLock(lockPath);
      const delay = LOCK_BASE_DELAY_MS * Math.pow(2, Math.min(attempt, 5));
      await new Promise<void>(r => setTimeout(r, delay));
    }
  }
  throw new StateError(
    `Could not acquire state lock at "${lockPath}" after ${LOCK_MAX_RETRIES} attempts. Another DanteForge process may be running.`,
  );
}

/**
 * Run `fn` while holding the advisory lock at `lockPath`.
 * Lock is always released in the finally block — even if `fn` throws.
 */
export async function withStateLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireStateLock(lockPath);
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** Maximum age (ms) of a lock file before it is considered stale in withSelfHealingLock. */
export const SELF_HEALING_LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Self-healing lock wrapper for a given working directory.
 *
 * Behaviour:
 *  1. Try to acquire `<cwd>/.danteforge/STATE.lock`.
 *  2. If the lock file exists (EEXIST), read its mtime.
 *  3. If mtime is older than SELF_HEALING_LOCK_STALE_MS (5 min):
 *       — delete the stale file and retry acquisition once.
 *  4. If the file is fresh, read the PID from the file and throw a helpful message.
 *
 * Injection seams:
 *  - `_now`: overrides `Date.now()` for deterministic tests.
 *  - `_stat`: overrides `fs.stat()` for deterministic tests.
 *  - `_unlink`: overrides `fs.unlink()` for deterministic tests.
 */
export async function withSelfHealingLock<T>(
  cwd: string,
  fn: () => Promise<T>,
  opts?: {
    _now?: () => number;
    _stat?: (p: string) => Promise<{ mtimeMs: number }>;
    _unlink?: (p: string) => Promise<void>;
  },
): Promise<T> {
  const lockPath = path.join(cwd, '.danteforge', 'STATE.lock');
  const now = opts?._now ?? (() => Date.now());
  const statFn = opts?._stat ?? ((p: string) => fs.stat(p));
  const unlinkFn = opts?._unlink ?? ((p: string) => fs.unlink(p));

  try {
    return await withStateLock(lockPath, fn);
  } catch (err: unknown) {
    // If it's not a lock-conflict error, re-throw immediately.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('Could not acquire state lock')) throw err;

    // Try to determine whether the lock is stale.
    let stalePid: number | null = null;
    let isStale = false;
    try {
      const statResult = await statFn(lockPath);
      isStale = now() - statResult.mtimeMs > SELF_HEALING_LOCK_STALE_MS;
      const content = await fs.readFile(lockPath, 'utf8');
      const parsed = parseInt(content.trim(), 10);
      if (!Number.isNaN(parsed)) stalePid = parsed;
    } catch {
      // Lock disappeared between check and read — just retry.
      isStale = true;
    }

    if (stalePid !== null && isProcessAlive(stalePid)) {
      throw new Error(
        `Another danteforge process may be running. PID: ${stalePid}. Lock: ${lockPath}`,
      );
    }

    if (isStale) {
      // Remove stale lock and retry once.
      try { await unlinkFn(lockPath); } catch { /* already gone */ }
      return await withStateLock(lockPath, fn);
    }

    const pidHint = stalePid !== null ? ` PID: ${stalePid}.` : '';
    throw new Error(
      `Another danteforge process may be running.${pidHint} Lock: ${lockPath}`,
    );
  }
}
