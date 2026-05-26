// Cross-platform process termination.
//
// On Windows, SIGTERM is silently ignored by most CLI tools (Node, Grok, Codex,
// claude) — the process continues running and blocks the worktree slot indefinitely.
// This module uses `taskkill /F /T /PID` on Windows and SIGTERM on POSIX.
import { execSync } from 'node:child_process';

export interface KillableProcess {
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
}

/**
 * Terminate a child process cross-platform.
 * Prefers taskkill on Windows (/F = force, /T = kill children too).
 * Falls back to SIGTERM on POSIX or when PID is unavailable.
 */
export function killProcess(child: KillableProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore', timeout: 5_000 });
      return;
    } catch { /* fall through to SIGTERM */ }
  }
  try { child.kill('SIGTERM'); } catch { /* best-effort */ }
}

/**
 * Terminate a process by PID cross-platform.
 * Used when only a PID is available (e.g. generic-shell-adapter's stopRun).
 */
export function killPid(pid: number): void {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 5_000 });
      return;
    } catch { /* fall through */ }
  }
  try { process.kill(pid, 'SIGTERM'); } catch { /* best-effort */ }
}
