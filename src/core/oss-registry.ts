// OSS Registry — persistent tracking of downloaded OSS repos and their extracted patterns
// Stored at .danteforge/oss-registry.json — never auto-deleted.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PatternExtraction } from './oss-researcher.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OSSRegistryEntry {
  /** Short repo name, e.g. "express" */
  name: string;
  /** Full GitHub URL */
  url: string;
  /** SPDX license identifier, e.g. "MIT" */
  license: string;
  /** active = scanned OK; blocked = license denied; archived = files removed */
  status: 'active' | 'blocked' | 'archived';
  /** ISO timestamp of initial clone */
  clonedAt: string;
  /** ISO timestamp of last pattern extraction run */
  lastLearnedAt: string;
  /** Number of patterns extracted */
  patternsCount: number;
  /** Relative path from cwd to stored repo, e.g. ".danteforge/oss-repos/express" */
  storagePath: string;
  /** Extracted patterns stored inline for holistic synthesis */
  patterns: PatternExtraction[];
}

export interface OSSRegistry {
  version: '1';
  repos: OSSRegistryEntry[];
  updatedAt: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

const REGISTRY_FILENAME = 'oss-registry.json';
const OSS_REPOS_DIRNAME = 'oss-repos';

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

/** Absolute path to `.danteforge/oss-repos/` */
export function getOssReposDir(cwd?: string): string {
  return path.join(getDanteforgeDir(cwd), OSS_REPOS_DIRNAME);
}

/**
 * Absolute path to `.danteforge/oss-repos/{safeName}`.
 * Normalises the repo name to a safe directory name.
 */
export function getRepoStoragePath(repoName: string, cwd?: string): string {
  const safeName = repoName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return path.join(getOssReposDir(cwd), safeName);
}

// ── Load / Save ───────────────────────────────────────────────────────────────

/** Load registry from disk. Returns an empty registry if the file does not exist. */
export async function loadRegistry(cwd?: string): Promise<OSSRegistry> {
  const registryPath = path.join(getDanteforgeDir(cwd), REGISTRY_FILENAME);
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw) as OSSRegistry;
    // Ensure patterns field exists on every entry (backwards compat)
    for (const repo of parsed.repos ?? []) {
      repo.patterns ??= [];
    }
    return parsed;
  } catch {
    return { version: '1', repos: [], updatedAt: new Date().toISOString() };
  }
}

/** Persist registry to disk. Automatically updates `updatedAt`. */
export async function saveRegistry(registry: OSSRegistry, cwd?: string): Promise<void> {
  const danteforgeDir = getDanteforgeDir(cwd);
  await fs.mkdir(danteforgeDir, { recursive: true });
  const registryPath = path.join(danteforgeDir, REGISTRY_FILENAME);
  registry.updatedAt = new Date().toISOString();
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Filter candidate repos to only those whose URL is not already in the registry.
 * Comparison is case-insensitive and strips trailing slashes.
 */
export function filterNewRepos<T extends { url: string }>(
  candidates: T[],
  registry: OSSRegistry,
): T[] {
  const normalize = (u: string) => u.toLowerCase().replace(/\/+$/, '');
  const knownUrls = new Set(registry.repos.map(r => normalize(r.url)));
  return candidates.filter(c => !knownUrls.has(normalize(c.url)));
}

/**
 * Insert or update a registry entry (matched by URL, case-insensitive).
 * Mutates and returns the registry for chaining.
 */
export function upsertEntry(
  registry: OSSRegistry,
  entry: OSSRegistryEntry,
): OSSRegistry {
  const normalize = (u: string) => u.toLowerCase().replace(/\/+$/, '');
  const idx = registry.repos.findIndex(r => normalize(r.url) === normalize(entry.url));
  if (idx >= 0) {
    registry.repos[idx] = entry;
  } else {
    registry.repos.push(entry);
  }
  return registry;
}
