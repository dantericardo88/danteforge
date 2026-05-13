// Matrix Kernel — Worktree Manager (Phase 8 of PRD)
//
// Wraps src/utils/worktree.ts to provide lease-aware worktree lifecycle.
// Each lease gets its own worktree under .danteforge-worktrees/{leaseId}.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createAgentWorktree,
  removeAgentWorktree,
  listWorktrees,
  type WorktreeGitFn,
  type WorktreeFsOps,
  type CreateAgentWorktreeOptions,
} from '../../utils/worktree.js';
import type { AgentLease } from '../types/lease.js';

export interface WorktreeHandle {
  leaseId: string;
  worktreePath: string;
  branch: string;
  createdAt: string;
}

export interface CreateWorktreeOptions {
  lease: AgentLease;
  cwd?: string;
  _git?: WorktreeGitFn;
  _fs?: WorktreeFsOps;
}

/**
 * Create a real git worktree for a lease. The actual path and branch are
 * driven by the lease (not by `agentName`-style normalization) so that
 * downstream consumers (verify-court, merge-court, embedded-complete) see
 * the same path/branch the lease records.
 *
 * If `lease.worktreePath` already exists as an empty directory (a stale
 * placeholder from a prior failed run), it's removed before `git worktree
 * add` so the latter doesn't refuse with "destination already exists".
 */
export async function createWorktreeForLease(
  options: CreateWorktreeOptions,
): Promise<WorktreeHandle> {
  const { lease } = options;
  const agentName = lease.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const cwd = options.cwd ?? process.cwd();

  // git worktree add refuses to write into an existing non-empty dir.
  // Empty placeholder dirs are a common artifact from the old flow; clear them.
  try {
    const stat = await fs.stat(lease.worktreePath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(lease.worktreePath);
      if (entries.length === 0) {
        await fs.rmdir(lease.worktreePath);
      }
    }
  } catch {
    // Path doesn't exist — fine, git will create it.
  }

  const opts: CreateAgentWorktreeOptions = {
    cwd,
    _git: options._git,
    _fs: options._fs,
    branch: lease.branch,
    worktreePath: lease.worktreePath,
  };
  const worktreePath = await createAgentWorktree(agentName, opts);
  return {
    leaseId: lease.id,
    worktreePath,
    branch: lease.branch,
    createdAt: new Date().toISOString(),
  };
}

export interface RemoveWorktreeOptions {
  lease: AgentLease;
  cwd?: string;
  /** Refuse to remove if true and the worktree has uncommitted changes. */
  refuseDirty?: boolean;
  _git?: WorktreeGitFn;
  _fs?: WorktreeFsOps;
}

export async function removeWorktreeForLease(
  options: RemoveWorktreeOptions,
): Promise<void> {
  const agentName = options.lease.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const cwd = options.cwd ?? process.cwd();
  await removeAgentWorktree(agentName, {
    cwd,
    _git: options._git,
    _fs: options._fs,
    branch: options.lease.branch,
    worktreePath: options.lease.worktreePath,
  });
}

export interface ListMatrixWorktreesOptions {
  cwd?: string;
  _git?: WorktreeGitFn;
}

export async function listMatrixWorktrees(
  options: ListMatrixWorktreesOptions = {},
): Promise<{ path: string; branch: string }[]> {
  const cwd = options.cwd ?? process.cwd();
  return listWorktrees({ cwd, _git: options._git });
}

/**
 * Discover all files inside a worktree (relative to the worktree root).
 * Used by Verification Court to compute the diff against the base branch.
 */
export async function listFilesInWorktree(worktreePath: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(worktreePath, '', results);
  return results;
}

async function walkDir(root: string, rel: string, out: string[]): Promise<void> {
  const fullDir = path.join(root, rel);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(fullDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const relPath = path.posix.join(rel.replace(/\\/g, '/'), entry.name);
    if (entry.isDirectory()) {
      await walkDir(root, relPath, out);
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
}
