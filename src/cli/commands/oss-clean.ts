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
  _access?: (p: string) => Promise<void>;
  _rm?: (p: string, opts: { recursive: boolean; force: boolean }) => Promise<void>;
  _getDirSize?: (dir: string) => Promise<number>;
  _stdout?: (line: string) => void;
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
  const accessFn = opts._access ?? ((p) => fs.access(p));
  const rmFn = opts._rm ?? ((p, o) => fs.rm(p, o));
  const getSizeFn = opts._getDirSize ?? getDirSize;
  const emit = opts._stdout ?? ((l) => logger.info(l));

  const cwd = opts.cwd ?? process.cwd();
  const danteforgeDir = path.join(cwd, '.danteforge');
  const cacheNames = ['oss-repos', 'oss-deep'];
  let anyFound = false;

  for (const name of cacheNames) {
    const target = path.join(danteforgeDir, name);
    try {
      await accessFn(target);
      anyFound = true;
      const size = await getSizeFn(target);
      if (opts.dryRun) {
        emit(`[oss-clean] Would remove: ${target} (${formatBytes(size)})`);
      } else {
        await rmFn(target, { recursive: true, force: true });
        emit(`[oss-clean] Removed: ${target} (${formatBytes(size)})`);
      }
    } catch { /* directory does not exist — skip silently */ }
  }

  if (!anyFound) {
    emit('[oss-clean] No OSS cache found — nothing to remove.');
  } else if (opts.dryRun) {
    emit('[oss-clean] Dry run complete. Re-run without --dry-run to delete.');
  } else {
    emit('[oss-clean] Cache cleared. Next oss-deep run will re-clone from scratch.');
  }
}
