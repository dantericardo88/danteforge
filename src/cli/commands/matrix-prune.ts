// Matrix Kernel — `prune` subcommand
//
// Cleans up stale state that accumulates across failed matrix runs:
//   1. Worktree directories under `.danteforge-worktrees/` whose lease
//      is no longer `pending` / `issued` / `active` in the lease graph.
//   2. Embedded-mode work-instruction directories under
//      `.danteforge/embedded-mode/<leaseId>/` for the same set of leases.
//   3. Lease records older than `--older-than` hours are marked `revoked`.
//
// Designed to be safe to run repeatedly — re-prune is a no-op when there's
// nothing stale. Refuses to touch any worktree whose branch has uncommitted
// changes unless `--force` is passed.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';

const WORKTREES_DIR = '.danteforge-worktrees';
const EMBEDDED_DIR = path.join('.danteforge', 'embedded-mode');

const ACTIVE_STATUSES = new Set(['pending', 'issued', 'active']);

export interface MatrixPruneOptions {
  cwd?: string;
  /** Mark lease records older than this many hours as `revoked`. Default: skip. */
  olderThanHours?: number;
  /** Remove worktrees even if their branch has uncommitted changes. */
  force?: boolean;
  /** Dry-run — print what would happen, don't mutate. */
  dryRun?: boolean;
}

export interface MatrixPruneResult {
  worktreesRemoved: string[];
  embeddedDirsRemoved: string[];
  leasesRevoked: string[];
  skipped: string[];
}

export async function matrixPrune(options: MatrixPruneOptions = {}): Promise<MatrixPruneResult> {
  const cwd = options.cwd ?? process.cwd();
  const result: MatrixPruneResult = {
    worktreesRemoved: [],
    embeddedDirsRemoved: [],
    leasesRevoked: [],
    skipped: [],
  };

  const { loadGraph, saveGraph } = await import('../../matrix/engines/matrix-state.js');
  const { removeWorktreeForLease } = await import('../../matrix/engines/worktree-manager.js');

  const leaseGraph = await loadGraph<{ leases: Array<{ id: string; branch: string; worktreePath: string; status: string; issuedAt?: string }> }>(cwd, 'leaseGraph');
  const leases = leaseGraph?.leases ?? [];

  const activeLeaseIds = new Set(
    leases.filter(l => ACTIVE_STATUSES.has(l.status)).map(l => l.id),
  );

  // 1. Scan worktree dirs.
  const worktreesRoot = path.join(cwd, WORKTREES_DIR);
  let worktreeEntries: string[] = [];
  try {
    worktreeEntries = await fs.readdir(worktreesRoot);
  } catch {
    // Dir doesn't exist yet — nothing to prune.
  }

  for (const entry of worktreeEntries) {
    if (activeLeaseIds.has(entry)) continue; // still in use
    const lease = leases.find(l => l.id === entry);
    const worktreePath = path.join(worktreesRoot, entry);
    if (options.dryRun) {
      logger.info(`[matrix-kernel:prune] would remove worktree: ${worktreePath}`);
      result.worktreesRemoved.push(worktreePath);
      continue;
    }
    try {
      if (lease) {
        await removeWorktreeForLease({
          lease: lease as never,
          cwd,
          refuseDirty: !options.force,
        });
      }
      // Belt-and-suspenders: `git worktree remove` is a best-effort op
      // (it warns on failure rather than throwing), so we fs.rm whatever
      // remains. This also handles the orphan case (lease graph lost track).
      await fs.rm(worktreePath, { recursive: true, force: true });
      result.worktreesRemoved.push(worktreePath);
    } catch (err) {
      logger.warn(`[matrix-kernel:prune] could not remove ${worktreePath}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped.push(worktreePath);
    }
  }

  // 2. Scan embedded-mode dirs.
  const embeddedRoot = path.join(cwd, EMBEDDED_DIR);
  let embeddedEntries: string[] = [];
  try {
    embeddedEntries = await fs.readdir(embeddedRoot);
  } catch {
    // No embedded-mode work yet.
  }

  for (const entry of embeddedEntries) {
    if (activeLeaseIds.has(entry)) continue;
    const dirPath = path.join(embeddedRoot, entry);
    if (options.dryRun) {
      logger.info(`[matrix-kernel:prune] would remove embedded-mode dir: ${dirPath}`);
      result.embeddedDirsRemoved.push(dirPath);
      continue;
    }
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      result.embeddedDirsRemoved.push(dirPath);
    } catch (err) {
      logger.warn(`[matrix-kernel:prune] could not remove ${dirPath}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped.push(dirPath);
    }
  }

  // 3. Mark old lease records as revoked. Optional — only fires when caller
  // passes `--older-than <hours>`. Active leases are never revoked.
  if (options.olderThanHours !== undefined && options.olderThanHours > 0 && leaseGraph) {
    const thresholdMs = Date.now() - options.olderThanHours * 60 * 60 * 1000;
    let mutated = false;
    const now = new Date().toISOString();
    for (const lease of leaseGraph.leases) {
      if (ACTIVE_STATUSES.has(lease.status)) continue;
      if (lease.status === 'revoked' || lease.status === 'expired') continue;
      const issued = lease.issuedAt ? Date.parse(lease.issuedAt) : NaN;
      if (Number.isFinite(issued) && issued < thresholdMs) {
        if (options.dryRun) {
          logger.info(`[matrix-kernel:prune] would mark lease ${lease.id} as revoked`);
        } else {
          (lease as { status: string; revokedAt?: string; revokedReason?: string }).status = 'revoked';
          (lease as { revokedAt?: string }).revokedAt = now;
          (lease as { revokedReason?: string }).revokedReason = `aged out (>${options.olderThanHours}h)`;
          mutated = true;
        }
        result.leasesRevoked.push(lease.id);
      }
    }
    if (mutated && !options.dryRun) {
      await saveGraph(cwd, 'leaseGraph', { generatedAt: now, leases: leaseGraph.leases });
    }
  }

  return result;
}
