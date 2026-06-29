// supervisor-lock.ts — singleton guard for the auto-reengage Supervisor. The keepalive (Task Scheduler /
// launchd / systemd) re-launches `danteforge supervise`, and an operator can run it in the foreground too —
// nothing stopped TWO supervisors from running the same campaign concurrently, clobbering supervisor-state.json
// and double-launching inner engines against the same git tree (a council finding). This is a PID-liveness
// lock: it records the holder's process id, and a second supervisor takes over ONLY if the recorded process is
// genuinely dead. PID-liveness (not a TTL) is used deliberately so a long (40-min) engine run never looks
// "stale" and gets stolen mid-flight.

import fs from 'node:fs/promises';
import path from 'node:path';

export const SUPERVISOR_LOCK_FILE = '.danteforge/supervisor.lock';

export interface SupervisorLockInfo {
  pid: number;
  startedAt: string;
}

export interface AcquireLockDeps {
  /** Is this pid a live process? Injected for tests. Default: process.kill(pid, 0) probe. */
  _isAlive?: (pid: number) => boolean;
  _now?: () => number;
}

/** Default liveness probe: signal 0 tests existence without killing. EPERM means it exists but is owned by
 *  another user — still alive. ESRCH means no such process — dead. */
function defaultIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Try to become the singleton supervisor. Returns acquired=true (and writes our lock) unless a DIFFERENT, still
 * LIVE supervisor holds it. A stale lock (dead pid, missing, or malformed) is taken over. Best-effort writes.
 */
export async function acquireSupervisorLock(
  cwd: string, deps: AcquireLockDeps = {},
): Promise<{ acquired: boolean; heldByPid?: number }> {
  const isAlive = deps._isAlive ?? defaultIsAlive;
  const now = deps._now ?? (() => Date.now());
  const lockPath = path.join(cwd, SUPERVISOR_LOCK_FILE);

  try {
    const info = JSON.parse(await fs.readFile(lockPath, 'utf8')) as SupervisorLockInfo;
    if (typeof info.pid === 'number' && info.pid !== process.pid && isAlive(info.pid)) {
      return { acquired: false, heldByPid: info.pid };
    }
  } catch {
    // no lock / malformed → we may take it
  }

  try {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date(now()).toISOString() }, null, 2), 'utf8');
  } catch {
    // best-effort — if we can't write the lock, proceed rather than block the campaign
  }
  return { acquired: true };
}

/** Release the lock if we own it (pid match). Best-effort; never throws. */
export async function releaseSupervisorLock(cwd: string): Promise<void> {
  const lockPath = path.join(cwd, SUPERVISOR_LOCK_FILE);
  try {
    const info = JSON.parse(await fs.readFile(lockPath, 'utf8')) as SupervisorLockInfo;
    if (info.pid === process.pid) await fs.rm(lockPath, { force: true });
  } catch {
    // nothing to release
  }
}
