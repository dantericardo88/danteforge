// git-safe.ts — serialize mutating git operations across concurrent workers + recover stale locks.
//
// The fleet bug (DanteCode, pinned to the exact argv): `harden-crusade --parallel 4` runs 4
// autoresearch workers that each `git checkout` against the SAME shared `.git/index`. Concurrent
// index writes race on `.git/index.lock`; when a worker is killed mid-checkout (e.g. by the new
// tree-kill), it leaves a stale `index.lock` that nothing clears — so every later git op fails
// ("Unable to create '.git/index.lock': File exists") and the whole 30-min cycle deadlocks.
//
// Fix: a cross-process O_EXCL mutex (withFileLock) serializes mutating git verbs, and while a worker
// holds that mutex it clears any leftover index.lock — which is necessarily stale, because the mutex
// guarantees no other serialized git op is running. Read-only verbs skip the lock for throughput.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { withFileLock } from './sanitize-locks.js';

const execFileAsync = promisify(execFile);

/** Git verbs that take `.git/index.lock` (mutate the index / working tree). */
export const MUTATING_GIT = new Set([
  'checkout', 'switch', 'commit', 'add', 'reset', 'merge', 'rebase',
  'cherry-pick', 'stash', 'restore', 'clean', 'apply', 'rm', 'mv', 'branch',
]);

/** Remove a leftover `.git/index.lock`. Safe to call only while holding the git mutex — then any
 *  lock present is from a crashed/killed worker, not a live serialized op. Best-effort. */
export async function clearStaleIndexLock(cwd: string): Promise<boolean> {
  try {
    await fs.rm(path.join(cwd, '.git', 'index.lock'), { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `git <args>` in `cwd`. Mutating verbs are serialized cross-process and clear a stale index.lock
 * first; read-only verbs run directly. Returns trimmed stdout (throws on non-zero, like execFile).
 */
export async function runGit(args: string[], cwd: string): Promise<string> {
  const verb = args[0] ?? '';
  if (!MUTATING_GIT.has(verb)) {
    const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000, env: process.env });
    return stdout.trim();
  }
  return withFileLock(
    { cwd, filePath: 'git-index', lockDir: '.danteforge/git-locks', maxWaitMs: 120_000, ttlMs: 60_000 },
    async () => {
      await clearStaleIndexLock(cwd);
      const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000, env: process.env });
      return stdout.trim();
    },
  );
}
