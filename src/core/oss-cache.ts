// Shared OSS clone cache — lives at {projectsRoot}/OSSHarvest, parallel to all sibling projects.
// Keeps clones off the system tmp dir so they survive reboots and are shared across sister projects.
// Override the root with the DANTEFORGE_OSS_CACHE env var for custom placement.
import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIRNAME = 'OSSHarvest';

/**
 * Root of the shared OSS clone cache.
 * Default: sibling of the project root — e.g. if cwd is X:\Projects\DanteForge,
 * the cache root is X:\Projects\OSSHarvest.
 * Override: set DANTEFORGE_OSS_CACHE to any absolute path.
 */
export function getOssCacheRoot(cwd?: string): string {
  if (process.env.DANTEFORGE_OSS_CACHE) return process.env.DANTEFORGE_OSS_CACHE;
  const projectRoot = cwd ?? process.cwd();
  return path.join(path.dirname(projectRoot), CACHE_DIRNAME);
}

/** Absolute path to the cached clone directory for a given repo slug. */
export function getOssCacheRepoDir(slug: string, cwd?: string): string {
  const safeName = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return path.join(getOssCacheRoot(cwd), safeName);
}

/**
 * Returns the cached clone path if a valid git repo is already present there, otherwise null.
 * A hit requires the .git directory to exist (not just the parent folder).
 */
export async function checkCacheHit(slug: string, cwd?: string): Promise<string | null> {
  const repoDir = getOssCacheRepoDir(slug, cwd);
  try {
    await fs.access(path.join(repoDir, '.git'));
    return repoDir;
  } catch {
    return null;
  }
}

/** Ensure the shared cache root directory exists. */
export async function ensureCacheRoot(cwd?: string): Promise<void> {
  await fs.mkdir(getOssCacheRoot(cwd), { recursive: true });
}
