// process-tree.ts — kill a spawned child AND its whole descendant tree, and never leave orphans.
//
// The fleet hit zombie accumulation: the orchestrator spawns harden-crusade, which spawns
// autoresearch, which spawns LLM/git children. When a timeout fired, `child.kill()` killed only the
// DIRECT child — the grandchildren (autoresearch + its workers, one seen at 3.7 GB) kept running and
// survived across sessions, compounding contention. On Windows, killing a process never kills its
// tree. This module kills the whole tree, and registers exit/interrupt cleanup so an unattended run
// (or a Ctrl-C) can't leave a forest of orphans behind.

import { spawn } from 'node:child_process';

const active = new Set<number>();
let handlersRegistered = false;

/** Kill `pid` and all of its descendants. Best-effort, never throws. */
export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      // taskkill /T kills the entire tree; /F forces it. Detached + ignored stdio so it can't hang us.
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, detached: true }).unref();
    } else {
      // POSIX: children are spawned in their own process group (detached), so -pid kills the group.
      try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  } catch { /* best-effort */ }
}

function cleanupAll(): void {
  for (const pid of active) killTree(pid);
  active.clear();
}

function registerHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  // Natural exit + interrupts: tree-kill anything still running so no orphan survives the run.
  process.once('exit', cleanupAll);
  process.once('SIGINT', () => { cleanupAll(); process.exit(130); });
  process.once('SIGTERM', () => { cleanupAll(); process.exit(143); });
}

/** Whether children should be spawned detached (POSIX process-group leaders) for tree-kill. */
export const SPAWN_DETACHED = process.platform !== 'win32';

/** Record a live child PID so it is tree-killed on timeout/interrupt/exit. Registers handlers lazily. */
export function trackChild(pid: number | undefined): void {
  if (pid === undefined) return;
  active.add(pid);
  registerHandlers();
}

/** A child finished cleanly — stop tracking it. */
export function untrackChild(pid: number | undefined): void {
  if (pid !== undefined) active.delete(pid);
}
