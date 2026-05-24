// OSS Clean — purge cached OSS clones and deep-extraction outputs.
// Removes the shared OSSHarvest/ cache and the per-project .danteforge/oss-deep/ directory.
// Use --dry-run to preview what would be deleted before committing.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { getOssCacheRoot } from '../../core/oss-cache.js';

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
 * Purge OSS cache directories.
 * Removes the shared OSSHarvest/ clone cache (sibling of the project root) and
 * the per-project .danteforge/oss-deep/ extraction outputs.
 * The next oss/oss-deep run will re-clone and re-extract from scratch.
 *
 * Note: OSSHarvest/ is shared across all sibling projects — cleaning it affects them all.
 */
export async function ossClean(opts: OssCleanOptions = {}): Promise<void> {
  const accessFn = opts._access ?? ((p) => fs.access(p));
  const rmFn = opts._rm ?? ((p, o) => fs.rm(p, o));
  const getSizeFn = opts._getDirSize ?? getDirSize;
  const emit = opts._stdout ?? ((l) => logger.info(l));

  const cwd = opts.cwd ?? process.cwd();

  const targets = [
    { path: getOssCacheRoot(cwd), label: 'shared OSS clone cache (OSSHarvest/)' },
    { path: path.join(cwd, '.danteforge', 'oss-deep'), label: 'deep extraction outputs (oss-deep/)' },
  ];

  let anyFound = false;

  for (const target of targets) {
    try {
      await accessFn(target.path);
      anyFound = true;
      const size = await getSizeFn(target.path);
      if (opts.dryRun) {
        emit(`[oss-clean] Would remove: ${target.path} — ${target.label} (${formatBytes(size)})`);
      } else {
        await rmFn(target.path, { recursive: true, force: true });
        emit(`[oss-clean] Removed: ${target.path} — ${target.label} (${formatBytes(size)})`);
      }
    } catch { /* directory does not exist — skip silently */ }
  }

  if (!anyFound) {
    emit('[oss-clean] No OSS cache found — nothing to remove.');
  } else if (opts.dryRun) {
    emit('[oss-clean] Dry run complete. Re-run without --dry-run to delete.');
  } else {
    emit('[oss-clean] Cache cleared. Next oss/oss-deep run will re-clone from scratch.');
  }
}
