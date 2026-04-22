// state-lock.ts — Advisory PID lock file for STATE.yaml serialization.
// No external dependencies. Uses fs.open with 'wx' (exclusive create) which is
// atomic on all platforms (POSIX O_EXCL, Windows CREATE_NEW).
import fs from 'fs/promises';
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
    if (!Number.isNaN(pid) && !isProcessAlive(pid)) {
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
