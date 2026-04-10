// LLM Cache — Caches LLM responses to avoid redundant API calls
// Uses SHA-256 prompt hashing. Stored in .danteforge/cache/

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';

const CACHE_SUBDIR = path.join('.danteforge', 'cache');

function resolveCacheDir(cwd?: string): string {
  return path.join(cwd ?? '.', CACHE_SUBDIR);
}
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  promptHash: string;
  response: string;
  provider: string;
  timestamp: string;
  ttlMs: number;
}

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

/**
 * Get a cached response for a prompt, if one exists and hasn't expired.
 */
export async function getCachedResponse(prompt: string, cwd?: string): Promise<string | null> {
  try {
    const cacheDir = resolveCacheDir(cwd);
    const hash = hashPrompt(prompt);
    const filePath = path.join(cacheDir, `${hash}.json`);
    const content = await fs.readFile(filePath, 'utf8');
    const entry: CacheEntry = JSON.parse(content);

    const age = Date.now() - new Date(entry.timestamp).getTime();
    if (age > entry.ttlMs) {
      // Expired — clean up
      await fs.unlink(filePath).catch(() => {});
      return null;
    }

    logger.info('LLM cache hit — using cached response');
    return entry.response;
  } catch {
    return null;
  }
}

/**
 * Cache an LLM response for future reuse.
 */
export async function cacheResponse(
  prompt: string,
  response: string,
  provider: string = 'unknown',
  cwd?: string,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  try {
    const cacheDir = resolveCacheDir(cwd);
    await fs.mkdir(cacheDir, { recursive: true });
    const hash = hashPrompt(prompt);
    const entry: CacheEntry = {
      promptHash: hash,
      response,
      provider,
      timestamp: new Date().toISOString(),
      ttlMs,
    };
    await fs.writeFile(path.join(cacheDir, `${hash}.json`), JSON.stringify(entry));
  } catch {
    // Cache write failure is non-critical
  }
}

/**
 * Clear the entire LLM cache.
 */
export async function clearCache(cwd?: string): Promise<void> {
  try {
    const cacheDir = resolveCacheDir(cwd);
    const files = await fs.readdir(cacheDir);
    for (const file of files) {
      await fs.unlink(path.join(cacheDir, file)).catch(() => {});
    }
    logger.info('LLM cache cleared');
  } catch {
    // No cache to clear
  }
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(cwd?: string): Promise<{ entries: number; sizeBytes: number }> {
  try {
    const cacheDir = resolveCacheDir(cwd);
    const files = await fs.readdir(cacheDir);
    let totalSize = 0;
    for (const file of files) {
      const stat = await fs.stat(path.join(cacheDir, file));
      totalSize += stat.size;
    }
    return { entries: files.length, sizeBytes: totalSize };
  } catch {
    return { entries: 0, sizeBytes: 0 };
  }
}
