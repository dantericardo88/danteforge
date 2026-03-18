// LLM Cache — Caches LLM responses to avoid redundant API calls
// Uses SHA-256 prompt hashing. Stored in .danteforge/cache/

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';

const CACHE_DIR = path.join('.danteforge', 'cache');
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
export async function getCachedResponse(prompt: string): Promise<string | null> {
  try {
    const hash = hashPrompt(prompt);
    const filePath = path.join(CACHE_DIR, `${hash}.json`);
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
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const hash = hashPrompt(prompt);
    const entry: CacheEntry = {
      promptHash: hash,
      response,
      provider,
      timestamp: new Date().toISOString(),
      ttlMs,
    };
    await fs.writeFile(path.join(CACHE_DIR, `${hash}.json`), JSON.stringify(entry));
  } catch {
    // Cache write failure is non-critical
  }
}

/**
 * Clear the entire LLM cache.
 */
export async function clearCache(): Promise<void> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    for (const file of files) {
      await fs.unlink(path.join(CACHE_DIR, file)).catch(() => {});
    }
    logger.info('LLM cache cleared');
  } catch {
    // No cache to clear
  }
}

/**
 * Get cache statistics.
 */
export async function getCacheStats(): Promise<{ entries: number; sizeBytes: number }> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    let totalSize = 0;
    for (const file of files) {
      const stat = await fs.stat(path.join(CACHE_DIR, file));
      totalSize += stat.size;
    }
    return { entries: files.length, sizeBytes: totalSize };
  } catch {
    return { entries: 0, sizeBytes: 0 };
  }
}
