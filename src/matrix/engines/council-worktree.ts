// Matrix Kernel — CouncilWorktree
//
// Creates and removes per-member git worktrees so council members can build in
// full isolation without git conflicts. Each member gets its own branch and
// working tree under .danteforge-worktrees/.
//
// Usage: createCouncilWorktrees(memberIds, opts) → CouncilWorktreeHandle[]
//        removeCouncilWorktrees(handles, opts) → void
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import type { AgentLease } from '../types/lease.js';

const execFileAsync = promisify(execFile);

export interface CouncilWorktreeHandle {
  memberId: string;
  worktreePath: string;
  branchName: string;
  /** slotIdx and slotId are set when created via createCouncilWorktreesForSlots(). */
  slotIdx?: number;
  slotId?: string;
}

export interface CouncilWorktreeOpts {
  projectPath: string;
  runId?: string;
  _git?: {
    worktreeAdd(worktreePath: string, branchName: string, cwd: string): Promise<void>;
    worktreeRemove(worktreePath: string, cwd: string): Promise<void>;
    branchDelete(branchName: string, cwd: string): Promise<void>;
    getDiff(worktreePath: string): Promise<string>;
  };
}

function defaultGit() {
  return {
    async worktreeAdd(worktreePath: string, branchName: string, cwd: string): Promise<void> {
      await execFileAsync('git', ['worktree', 'add', worktreePath, '-b', branchName], { cwd, timeout: 30_000 });
    },
    async worktreeRemove(worktreePath: string, cwd: string): Promise<void> {
      try {
        await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], { cwd, timeout: 30_000 });
      } catch (err) {
        // "not a working tree" means the directory exists but git lost track of it
        // (e.g. prior process crashed mid-cleanup). Fall back to direct fs removal.
        const msg = String(err);
        if (msg.includes('not a working tree') || msg.includes('already exists')) {
          await fs.rm(worktreePath, { recursive: true, force: true });
          await execFileAsync('git', ['worktree', 'prune'], { cwd, timeout: 10_000 }).catch(() => { /* ignore */ });
        } else {
          throw err;
        }
      }
    },
    async branchDelete(branchName: string, cwd: string): Promise<void> {
      await execFileAsync('git', ['branch', '-D', branchName], { cwd, timeout: 10_000 });
    },
    async getDiff(worktreePath: string): Promise<string> {
      try {
        // Stage everything first, then capture the cached diff as a patch.
        await execFileAsync('git', ['add', '-A'], { cwd: worktreePath, timeout: 30_000 });
        const { stdout } = await execFileAsync('git', ['diff', '--cached', '--binary'], { cwd: worktreePath, timeout: 30_000 });
        return stdout;
      } catch { return ''; }
    },
  };
}

export async function createCouncilWorktrees(
  memberIds: string[],
  opts: CouncilWorktreeOpts,
): Promise<CouncilWorktreeHandle[]> {
  const runId = opts.runId ?? `c${Date.now()}`;
  const worktreeBase = path.join(opts.projectPath, '.danteforge-worktrees');
  const git = opts._git ?? defaultGit();

  // Prune stale worktree refs left by prior aborted runs before creating new ones.
  await execFileAsync('git', ['worktree', 'prune'], { cwd: opts.projectPath, timeout: 10_000 }).catch(() => { /* ignore */ });

  const settled = await Promise.allSettled(
    memberIds.map(async (memberId): Promise<CouncilWorktreeHandle> => {
      const slug = memberId.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const worktreePath = path.join(worktreeBase, `council-${slug}`);
      const branchName = `council/${runId}/${slug}`;

      async function tryAdd(): Promise<void> {
        await git.worktreeAdd(worktreePath, branchName, opts.projectPath);
      }

      try {
        await tryAdd();
      } catch (firstErr) {
        // Prior aborted run may have left a stale worktree — clean and retry once.
        logger.warn(`[council-worktree] Cleaning stale worktree for ${memberId}: ${String(firstErr)}`);
        await git.worktreeRemove(worktreePath, opts.projectPath).catch(() => { /* ignore */ });
        await git.branchDelete(branchName, opts.projectPath).catch(() => { /* ignore */ });
        await tryAdd();
      }

      logger.info(`[council-worktree] ${memberId} → ${worktreePath} (${branchName})`);
      return { memberId, worktreePath, branchName };
    }),
  );

  const handles: CouncilWorktreeHandle[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      handles.push(r.value);
    } else {
      logger.warn(`[council-worktree] Failed to create worktree: ${String(r.reason)}`);
    }
  }
  return handles;
}

/**
 * Slot-aware variant: creates one worktree per slot, named council-{slotId}.
 * Enables M members × N slots = M*N parallel worktrees.
 */
export async function createCouncilWorktreesForSlots(
  slots: Array<{ memberId: string; slotIdx: number; slotId: string }>,
  opts: CouncilWorktreeOpts,
): Promise<CouncilWorktreeHandle[]> {
  const runId = opts.runId ?? `c${Date.now()}`;
  const worktreeBase = path.join(opts.projectPath, '.danteforge-worktrees');
  const git = opts._git ?? defaultGit();

  // Prune stale worktree refs left by prior aborted runs before creating new ones.
  await execFileAsync('git', ['worktree', 'prune'], { cwd: opts.projectPath, timeout: 10_000 }).catch(() => { /* ignore */ });

  const settled = await Promise.allSettled(
    slots.map(async (slot): Promise<CouncilWorktreeHandle> => {
      const slug = slot.slotId.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      const worktreePath = path.join(worktreeBase, `council-${slug}`);
      const branchName = `council/${runId}/${slug}`;

      async function tryAdd(): Promise<void> {
        await git.worktreeAdd(worktreePath, branchName, opts.projectPath);
      }

      try {
        await tryAdd();
      } catch (firstErr) {
        logger.warn(`[council-worktree] Cleaning stale worktree for ${slot.slotId}: ${String(firstErr)}`);
        await git.worktreeRemove(worktreePath, opts.projectPath).catch(() => { /* ignore */ });
        await git.branchDelete(branchName, opts.projectPath).catch(() => { /* ignore */ });
        await tryAdd();
      }

      logger.info(`[council-worktree] ${slot.slotId} → ${worktreePath} (${branchName})`);
      return { memberId: slot.memberId, worktreePath, branchName, slotIdx: slot.slotIdx, slotId: slot.slotId };
    }),
  );

  const handles: CouncilWorktreeHandle[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      handles.push(r.value);
    } else {
      logger.warn(`[council-worktree] Failed to create slot worktree: ${String(r.reason)}`);
    }
  }
  return handles;
}

export async function removeCouncilWorktrees(
  handles: CouncilWorktreeHandle[],
  opts: CouncilWorktreeOpts,
): Promise<void> {
  const git = opts._git ?? defaultGit();
  await Promise.allSettled(
    handles.map(async (h) => {
      await git.worktreeRemove(h.worktreePath, opts.projectPath).catch((e) =>
        logger.warn(`[council-worktree] Could not remove ${h.memberId}: ${String(e)}`),
      );
      // Leave the branch — it can be inspected post-run; git GC cleans it eventually.
    }),
  );
}

export async function captureWorktreeDiff(
  handle: CouncilWorktreeHandle,
  opts: CouncilWorktreeOpts,
): Promise<string> {
  const git = opts._git ?? defaultGit();
  return git.getDiff(handle.worktreePath);
}

export async function getChangedFiles(worktreePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: worktreePath, timeout: 10_000 });
    return stdout.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => l.slice(l.indexOf(' ')).trim());
  } catch { return []; }
}

/**
 * Shared read-only lease factory — forbids all writes, allows all reads.
 * Single authoritative definition replacing the four local copies that were
 * scattered across council-ask, council-debate, council-merge-court, council-revision.
 */
export function makeReadOnlyLease(worktreePath: string, prefix = 'council'): AgentLease {
  return {
    id: `${prefix}-readonly-lease.${Date.now()}`,
    worktreePath,
    allowedWritePaths: [],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['**'],
  } as unknown as AgentLease;
}
