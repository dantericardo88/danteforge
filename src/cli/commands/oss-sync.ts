// oss-sync — matrix-aware OSS workspace restore + update.
// Reads oss_leader / harvest_source from every matrix dimension, cross-references
// the oss-registry, checks disk, re-clones anything missing, and optionally pulls
// updates on stale repos. Run this any time after `danteforge oss-clean` to
// instantly restore the full OSS workspace from matrix state alone — no manual
// URL lookup required.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import {
  loadRegistry,
  saveRegistry,
  type OSSRegistryEntry,
} from '../../core/oss-registry.js';
import { getOssCacheRepoDir, ensureCacheRoot } from '../../core/oss-cache.js';

const execFileAsync = promisify(execFile);
const CLONE_TIMEOUT_MS = 180_000;
const PULL_TIMEOUT_MS = 60_000;
const MAX_STALE_DAYS_DEFAULT = 7;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OssSyncOptions {
  cwd?: string;
  /** Also run git pull on repos already on disk but older than --stale-days */
  update?: boolean;
  /** Consider a repo stale if lastLearnedAt is older than this many days (default 7) */
  staleDays?: number;
  /** Show what would happen without cloning or pulling */
  dryRun?: boolean;
  /** Injection seams for testing */
  _clone?: (url: string, dest: string) => Promise<boolean>;
  _pull?: (dest: string) => Promise<boolean>;
  _checkOnDisk?: (dest: string) => Promise<boolean>;
}

export interface OssSyncResult {
  restored: string[];
  updated: string[];
  fresh: string[];
  failed: string[];
  needsDiscovery: string[]; // oss_leaders with no URL in registry
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function defaultCheckOnDisk(dest: string): Promise<boolean> {
  try {
    await fs.access(path.join(dest, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function defaultClone(url: string, dest: string): Promise<boolean> {
  try {
    await ensureCacheRoot();
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', url, dest], {
      timeout: CLONE_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    logger.warn(`[oss-sync] Clone failed ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function defaultPull(dest: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['pull', '--ff-only'], { cwd: dest, timeout: PULL_TIMEOUT_MS });
    return true;
  } catch (err) {
    logger.warn(`[oss-sync] Pull failed at ${dest}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function isStale(entry: OSSRegistryEntry, staleDays: number): boolean {
  if (!entry.lastLearnedAt) return true;
  const age = Date.now() - new Date(entry.lastLearnedAt).getTime();
  return age > staleDays * 24 * 60 * 60 * 1000;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '').trim();
}

function nameKeys(name: string): string[] {
  const base = normalize(name);
  const keys = new Set<string>([base]);

  if (base.endsWith('dev')) keys.add(base.slice(0, -3));
  if (base.endsWith('agents')) keys.add(base.slice(0, -6));
  if (base.endsWith('agent')) keys.add(base.slice(0, -5));

  const pathParts = name.replace(/\/+$/, '').split('/');
  const slug = pathParts[pathParts.length - 1];
  if (slug && slug !== name) {
    for (const key of nameKeys(slug)) keys.add(key);
  }

  return [...keys].filter(Boolean);
}

function isMatrixPlaceholder(name: string): boolean {
  return ['self', 'none', 'unknown'].includes(normalize(name));
}

// ── Matrix → needed repo names ────────────────────────────────────────────────

async function collectNeededLeaders(cwd: string): Promise<string[]> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return [];

  const seen = new Set<string>();
  const leaders: string[] = [];
  const excluded = new Set(matrix.excludedDimensions ?? []);

  for (const dim of matrix.dimensions) {
    if (excluded.has(dim.id)) continue;

    const leader = dim.oss_leader;
    const source = dim.harvest_source;
    if (leader && !isMatrixPlaceholder(leader) && !seen.has(normalize(leader))) {
      seen.add(normalize(leader));
      leaders.push(leader);
    }
    if (source && !isMatrixPlaceholder(source) && !seen.has(normalize(source))) {
      seen.add(normalize(source));
      leaders.push(source);
    }
  }

  return leaders;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function ossSync(options: OssSyncOptions = {}): Promise<OssSyncResult> {
  const cwd = options.cwd ?? process.cwd();
  const staleDays = options.staleDays ?? MAX_STALE_DAYS_DEFAULT;
  const dryRun = options.dryRun ?? false;
  const doUpdate = options.update ?? false;

  const clone = options._clone ?? defaultClone;
  const pull = options._pull ?? defaultPull;
  const checkOnDisk = options._checkOnDisk ?? defaultCheckOnDisk;

  const result: OssSyncResult = {
    restored: [],
    updated: [],
    fresh: [],
    failed: [],
    needsDiscovery: [],
  };

  logger.info('[oss-sync] Loading competitive matrix and OSS registry...');
  const [neededLeaders, registry] = await Promise.all([
    collectNeededLeaders(cwd),
    loadRegistry(cwd),
  ]);

  if (neededLeaders.length === 0) {
    logger.warn('[oss-sync] No matrix found or no oss_leader fields set. Run `danteforge compete --init` first.');
    return result;
  }

  logger.info(`[oss-sync] Matrix requires ${neededLeaders.length} OSS leader(s): ${neededLeaders.join(', ')}`);
  logger.info(`[oss-sync] Registry tracks ${registry.repos.length} repo(s).`);

  // Match matrix leaders → registry entries by name (case-insensitive)
  const registryByName = new Map<string, OSSRegistryEntry>();
  for (const entry of registry.repos) {
    for (const key of nameKeys(entry.name)) registryByName.set(key, entry);
    for (const key of nameKeys(entry.url)) registryByName.set(key, entry);
  }

  // Process each needed leader
  for (const leader of neededLeaders) {
    const entry = nameKeys(leader).map(key => registryByName.get(key)).find(Boolean);

    if (!entry) {
      // In registry but no URL — needs discovery via `danteforge oss`
      result.needsDiscovery.push(leader);
      logger.warn(`[oss-sync] "${leader}" has no registry entry — run \`danteforge oss\` to discover its URL first.`);
      continue;
    }

    if (entry.status === 'blocked') {
      logger.info(`[oss-sync] "${leader}" is license-blocked (${entry.license}) — skipping.`);
      continue;
    }

    const dest = entry.storagePath || getOssCacheRepoDir(entry.name, cwd);
    const onDisk = await checkOnDisk(dest);

    if (!onDisk) {
      logger.info(`[oss-sync] "${leader}" missing from disk — restoring from ${entry.url}`);
      if (dryRun) {
        logger.info(`[oss-sync] [dry-run] Would clone ${entry.url} → ${dest}`);
        result.restored.push(leader);
        continue;
      }
      const ok = await clone(entry.url, dest);
      if (ok) {
        entry.status = 'active';
        entry.storagePath = dest;
        result.restored.push(leader);
        logger.info(`[oss-sync] ✓ Restored "${leader}"`);
      } else {
        result.failed.push(leader);
      }
      continue;
    }

    // On disk — check if update needed
    if (doUpdate && isStale(entry, staleDays)) {
      logger.info(`[oss-sync] "${leader}" is stale — pulling latest...`);
      if (dryRun) {
        logger.info(`[oss-sync] [dry-run] Would git pull ${dest}`);
        result.updated.push(leader);
        continue;
      }
      const ok = await pull(dest);
      if (ok) {
        entry.lastLearnedAt = new Date().toISOString();
        result.updated.push(leader);
        logger.info(`[oss-sync] ✓ Updated "${leader}"`);
      } else {
        result.failed.push(leader);
      }
      continue;
    }

    result.fresh.push(leader);
    logger.info(`[oss-sync] ✓ "${leader}" already present.`);
  }

  // Persist registry changes unless dry-run
  if (!dryRun && (result.restored.length > 0 || result.updated.length > 0)) {
    await saveRegistry(registry, cwd);
  }

  // Summary
  logger.info('');
  logger.info('[oss-sync] ─────────────────────────────────────────────');
  logger.info(`[oss-sync] Restored:         ${result.restored.length} repo(s) — ${result.restored.join(', ') || 'none'}`);
  logger.info(`[oss-sync] Updated:          ${result.updated.length} repo(s) — ${result.updated.join(', ') || 'none'}`);
  logger.info(`[oss-sync] Already fresh:    ${result.fresh.length} repo(s)`);
  logger.info(`[oss-sync] Failed:           ${result.failed.length} repo(s) — ${result.failed.join(', ') || 'none'}`);
  if (result.needsDiscovery.length > 0) {
    logger.info(`[oss-sync] Needs discovery:  ${result.needsDiscovery.join(', ')}`);
    logger.info('[oss-sync] → Run `danteforge oss` to find URLs for the above, then re-run oss-sync.');
  }
  logger.info('[oss-sync] ─────────────────────────────────────────────');

  if (result.restored.length === 0 && result.failed.length === 0 && result.needsDiscovery.length === 0) {
    logger.info('[oss-sync] OSS workspace is fully in sync with the competitive matrix.');
  }

  return result;
}
