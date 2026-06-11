// autoresearch-worktree — run an autoresearch session in an ISOLATED git worktree so the agent (which
// has a shell) can never touch the user's real checkout. This is the durable fix the council named:
// it makes the whole collateral class structurally impossible — no pre-existing untracked file can be
// deleted, no `git add -A` can sweep the user's tree, no `git reset --hard` can discard their
// uncommitted work — because the experiments run on a fresh checkout off HEAD, not the user's tree.
//
// node_modules is the one gap: a fresh worktree is a clean tree checkout with no node_modules, so a
// measurement command that needs deps would fail. We junction-symlink the user's node_modules in
// (read-only deps — safe to share; 'junction' is Windows-friendly and ignored on POSIX).

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { createAgentWorktree, removeAgentWorktree } from '../../utils/worktree.js';

export interface IsolatedSession {
  worktreePath: string;
  branch: string;
  agentName: string;
}

export interface WorktreeDeps {
  createWorktree: (agentName: string, opts: { cwd: string; branch: string }) => Promise<string>;
  removeWorktree: (agentName: string, opts: { cwd: string; branch: string }) => Promise<void>;
  exists: (p: string) => Promise<boolean>;
  symlink: (target: string, linkPath: string) => Promise<void>;
  mkdir: (p: string) => Promise<void>;
  copyFile: (src: string, dst: string) => Promise<void>;
}

export function defaultWorktreeDeps(): WorktreeDeps {
  return {
    createWorktree: (agentName, opts) => createAgentWorktree(agentName, opts),
    removeWorktree: (agentName, opts) => removeAgentWorktree(agentName, opts),
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
    symlink: (target, linkPath) => fs.symlink(target, linkPath, 'junction'),
    mkdir: async (p) => { await fs.mkdir(p, { recursive: true }); },
    copyFile: (src, dst) => fs.copyFile(src, dst),
  };
}

/** Create the isolated worktree off HEAD and link node_modules in. Returns null on failure. */
export async function setupWorktree(
  userCwd: string, agentName: string, branch: string, deps: WorktreeDeps,
): Promise<IsolatedSession | null> {
  let worktreePath: string;
  try {
    worktreePath = await deps.createWorktree(agentName, { cwd: userCwd, branch });
  } catch (err) {
    logger.error(`Isolated worktree creation failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  // Link node_modules so the measurement command resolves deps inside the fresh checkout.
  const src = path.join(userCwd, 'node_modules');
  const dst = path.join(worktreePath, 'node_modules');
  try {
    if (await deps.exists(src) && !(await deps.exists(dst))) await deps.symlink(src, dst);
  } catch (err) {
    logger.warn(`Could not link node_modules into the worktree (the measurement may fail if it needs deps): ${err instanceof Error ? err.message : String(err)}`);
  }
  return { worktreePath, branch, agentName };
}

const ARTIFACT_FILES = ['results.tsv', 'AUTORESEARCH_REPORT.md'];

/** Copy the run's artifacts out to the user's tree, then remove the worktree (kept commits persist on the branch). */
export async function teardownWorktree(session: IsolatedSession, userCwd: string, deps: WorktreeDeps): Promise<void> {
  const srcDir = path.join(session.worktreePath, '.danteforge', 'autoresearch');
  const dstDir = path.join(userCwd, '.danteforge', 'autoresearch');
  try {
    await deps.mkdir(dstDir);
    for (const f of ARTIFACT_FILES) {
      try { await deps.copyFile(path.join(srcDir, f), path.join(dstDir, f)); } catch { /* artifact may not exist */ }
    }
  } catch { /* best-effort */ }
  // UNLINK THE node_modules JUNCTION FIRST (live DanteForge run finding): the worktree's
  // node_modules is a junction into the USER'S real node_modules. Windows directory removal —
  // including `git worktree remove --force` — can FOLLOW the junction and empty the user's real
  // dependency tree (observed live: 0 entries left, tsc gone, npm ci required). fs.unlink on a
  // junction removes only the link itself, never the target; do it before any tree removal.
  try {
    const link = path.join(session.worktreePath, 'node_modules');
    await fs.unlink(link);
  } catch { /* no junction was created, or already gone — fine */ }
  // removeAgentWorktree force-removes the worktree and deletes the branch ONLY if it has no unmerged
  // commits — so a branch carrying kept experiments survives for the user to review/merge.
  await deps.removeWorktree(session.agentName, { cwd: userCwd, branch: session.branch });
}
