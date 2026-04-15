// OSS Clean — purge cached OSS clones and deep-extraction outputs.
// Removes .danteforge/oss-repos/ and .danteforge/oss-deep/ directories.
// Use --dry-run to preview what would be deleted before committing.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OssCleanOptions {
  cwd?: string;
  /** Preview what would be deleted without actually deleting (default false) */
  dryRun?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes}B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)}KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)}MB`;
}

async function getDirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) {
        const fullPath = path.join((entry as { parentPath?: string }).parentPath ?? dir, entry.name);
        const stat = await fs.stat(fullPath).catch(() => null);
        if (stat) total += stat.size;
      }
    }
  } catch { /* unreadable — skip */ }
  return total;
}

// ── Main entry ─────────────────────────────────────────────────────────────────

/**
 * Purge OSS cache directories from .danteforge/.
 * Removes oss-repos/ (cloned repos) and oss-deep/ (extraction outputs).
 * The next `oss-deep` run will re-clone and re-extract from scratch.
 */
export async function ossClean(opts: OssCleanOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const danteforgeDir = path.join(cwd, '.danteforge');
  const cacheNames = ['oss-repos', 'oss-deep'];
  let anyFound = false;

  for (const name of cacheNames) {
    const target = path.join(danteforgeDir, name);
    try {
      await fs.access(target);
      anyFound = true;
      const size = await getDirSize(target);
      if (opts.dryRun) {
        logger.info(`[oss-clean] Would remove: ${target} (${formatBytes(size)})`);
      } else {
        await fs.rm(target, { recursive: true, force: true });
        logger.info(`[oss-clean] Removed: ${target} (${formatBytes(size)})`);
      }
    } catch { /* directory does not exist — skip silently */ }
  }

  if (!anyFound) {
    logger.info('[oss-clean] No OSS cache found — nothing to remove.');
  } else if (opts.dryRun) {
    logger.info('[oss-clean] Dry run complete. Re-run without --dry-run to delete.');
  } else {
    logger.info('[oss-clean] Cache cleared. Next oss-deep run will re-clone from scratch.');
  }
}
