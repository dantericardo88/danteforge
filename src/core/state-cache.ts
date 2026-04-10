// TTL-based in-memory state cache with mtime validation — reduces disk I/O
// while detecting external writes (another process, manual edit) before TTL expires.
import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState, type DanteState } from './state.js';

const DEFAULT_TTL_MS = 5000;
const STATE_DIR = '.danteforge';
const STATE_FILE = 'STATE.yaml';

interface CacheEntry {
  state: DanteState;
  loadedAt: number;
  stateFile: string; // absolute path — used for mtime validation
}

const cache = new Map<string, CacheEntry>();

function resolveCacheKey(cwd?: string): string {
  return cwd ?? process.cwd();
}

function resolveStateFilePath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), STATE_DIR, STATE_FILE);
}

/** Load state with TTL-based caching + mtime validation */
export async function cachedLoadState(opts?: { cwd?: string; ttlMs?: number }): Promise<DanteState> {
  const key = resolveCacheKey(opts?.cwd);
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  const entry = cache.get(key);
  if (entry && (now - entry.loadedAt) < ttl) {
    // Validate mtime before trusting cache — another process may have written STATE.yaml
    try {
      const stat = await fs.stat(entry.stateFile);
      if (stat.mtimeMs <= entry.loadedAt) {
        return entry.state; // File unchanged — cache hit is valid
      }
      // File was modified externally — fall through to reload
    } catch {
      // Can't stat (file deleted?) — fall through to reload
    }
  }

  const stateFile = resolveStateFilePath(opts?.cwd);
  const state = await loadState({ cwd: opts?.cwd });
  cache.set(key, { state, loadedAt: Date.now(), stateFile });
  return state;
}

/** Save state and update the cache entry */
export async function cachedSaveState(state: DanteState, opts?: { cwd?: string }): Promise<void> {
  const key = resolveCacheKey(opts?.cwd);
  const stateFile = resolveStateFilePath(opts?.cwd);
  await saveState(state, { cwd: opts?.cwd });
  cache.set(key, { state, loadedAt: Date.now(), stateFile });
}

/** Invalidate cache for a specific cwd, or all entries if no cwd provided */
export function invalidateStateCache(cwd?: string): void {
  if (cwd) {
    cache.delete(cwd);
  } else {
    cache.clear();
  }
}

/** Return the number of cached entries (for testing) */
export function getStateCacheSize(): number {
  return cache.size;
}
