// OSS Registry — persistent tracking of downloaded OSS repos and their extracted patterns
// Stored at .danteforge/oss-registry.json — never auto-deleted.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PatternExtraction } from './oss-researcher.js';
import { getOssCacheRoot, getOssCacheRepoDir } from './oss-cache.js';

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
  /** Absolute path to the stored repo in the shared OSS cache (e.g. X:\Projects\OSSHarvest\express) */
  storagePath: string;
  /** Extracted patterns stored inline for holistic synthesis */
  patterns: PatternExtraction[];
}

export interface OSSRegistry {
  version: string;
  repos: OSSRegistryEntry[];
  updatedAt: string;
  entries?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

const REGISTRY_FILENAME = 'oss-registry.json';

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

/** Absolute path to the shared OSS clone cache root (e.g. X:\Projects\OSSHarvest). */
export function getOssReposDir(cwd?: string): string {
  return getOssCacheRoot(cwd);
}

/**
 * Absolute path to the shared cache directory for a given repo name.
 * Normalises the repo name to a safe directory name.
 */
export function getRepoStoragePath(repoName: string, cwd?: string): string {
  return getOssCacheRepoDir(repoName, cwd);
}

// ── Load / Save ───────────────────────────────────────────────────────────────

/** Load registry from disk. Returns an empty registry if the file does not exist. */
export async function loadRegistry(cwd?: string): Promise<OSSRegistry> {
  const registryPath = path.join(getDanteforgeDir(cwd), REGISTRY_FILENAME);
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw) as OSSRegistry;
    parsed.repos ??= legacyEntriesToRepos(parsed.entries, cwd);
    // Ensure patterns field exists on every entry (backwards compat)
    for (const repo of parsed.repos ?? []) {
      repo.patterns ??= [];
    }
    return parsed;
  } catch {
    return { version: '1', repos: [], updatedAt: new Date().toISOString() };
  }
}

function legacyEntriesToRepos(entries: unknown, cwd?: string): OSSRegistryEntry[] {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return [];
  }

  return Object.entries(entries as Record<string, Record<string, unknown>>)
    .filter(([, entry]) => typeof entry?.url === 'string')
    .map(([key, entry]) => {
      const name = typeof entry.name === 'string' ? entry.name : key;
      const harvestedAt = typeof entry.harvestedAt === 'string'
        ? entry.harvestedAt
        : new Date().toISOString();
      const licenseGate = typeof entry.licenseGate === 'string' ? entry.licenseGate : '';
      return {
        name,
        url: entry.url as string,
        license: typeof entry.license === 'string' ? entry.license : 'unknown',
        status: licenseGate === 'blocked' ? 'blocked' : 'active',
        clonedAt: harvestedAt,
        lastLearnedAt: harvestedAt,
        patternsCount: typeof entry.patternCount === 'number' ? entry.patternCount : 0,
        storagePath: typeof entry.storagePath === 'string'
          ? entry.storagePath
          : getOssCacheRepoDir(name, cwd),
        patterns: [],
      };
    });
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
