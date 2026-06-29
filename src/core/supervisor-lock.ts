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
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date(now()).toISOString() }, null, 2);

  // Exclusive-create (flag 'wx') makes the WRITE atomic: if two supervisors race, only one create succeeds —
  // closing the read-then-write TOCTOU window. We re-check the holder on EEXIST in case the racer is a live peer.
  for (let attempt = 0; attempt < 3; attempt++) {
    let holder: SupervisorLockInfo | null = null;
    try { holder = JSON.parse(await fs.readFile(lockPath, 'utf8')) as SupervisorLockInfo; } catch { holder = null; }
    if (holder && typeof holder.pid === 'number' && holder.pid !== process.pid && isAlive(holder.pid)) {
      return { acquired: false, heldByPid: holder.pid };
    }
    // No LIVE holder (missing / malformed / dead / ours) → clear it and try to create exclusively.
    await fs.rm(lockPath, { force: true }).catch(() => {});
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, payload, { encoding: 'utf8', flag: 'wx' });
      return { acquired: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue; // a racer created it — re-check the holder
      return { acquired: true }; // other write error → best-effort proceed rather than block the campaign
    }
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
