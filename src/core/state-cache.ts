// TTL-based in-memory state cache — reduces disk I/O for frequent loadState/saveState calls
import { loadState, saveState, type DanteState } from './state.js';

const DEFAULT_TTL_MS = 5000;

interface CacheEntry {
  state: DanteState;
  loadedAt: number;
}

const cache = new Map<string, CacheEntry>();

function resolveCacheKey(cwd?: string): string {
  return cwd ?? process.cwd();
}

/** Load state with TTL-based caching — avoids re-reading YAML within the TTL window */
export async function cachedLoadState(opts?: { cwd?: string; ttlMs?: number }): Promise<DanteState> {
  const key = resolveCacheKey(opts?.cwd);
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  const entry = cache.get(key);
  if (entry && (now - entry.loadedAt) < ttl) {
    return entry.state;
  }

  const state = await loadState({ cwd: opts?.cwd });
  cache.set(key, { state, loadedAt: now });
  return state;
}

/** Save state and update the cache entry */
export async function cachedSaveState(state: DanteState, opts?: { cwd?: string }): Promise<void> {
  const key = resolveCacheKey(opts?.cwd);
  await saveState(state, { cwd: opts?.cwd });
  cache.set(key, { state, loadedAt: Date.now() });
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
