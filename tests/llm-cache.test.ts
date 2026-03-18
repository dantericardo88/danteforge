import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  getCachedResponse,
  cacheResponse,
  getCacheStats,
  clearCache,
} from '../src/core/llm-cache.js';

describe('LLM cache', () => {
  let originalCwd: string;
  let tmpDir: string;

  before(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cache-test-'));
    process.chdir(tmpDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('getCachedResponse returns null for unknown prompts', async () => {
    const result = await getCachedResponse('this-prompt-was-never-cached');
    assert.strictEqual(result, null);
  });

  it('cacheResponse + getCachedResponse roundtrip works', async () => {
    const prompt = `test-roundtrip-${Date.now()}`;
    const response = 'This is a cached LLM response';

    await cacheResponse(prompt, response, 'test-provider');
    const cached = await getCachedResponse(prompt);
    assert.strictEqual(cached, response);
  });

  it('getCacheStats returns { entries: 0, sizeBytes: 0 } initially', async () => {
    // Use a fresh temp dir with no cache
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cache-stats-'));
    const savedCwd = process.cwd();
    process.chdir(freshDir);

    try {
      const stats = await getCacheStats();
      assert.strictEqual(stats.entries, 0);
      assert.strictEqual(stats.sizeBytes, 0);
    } finally {
      process.chdir(savedCwd);
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('getCacheStats reflects cached entries', async () => {
    const prompt = `stats-test-${Date.now()}`;
    await cacheResponse(prompt, 'response for stats test', 'test');

    const stats = await getCacheStats();
    assert.ok(stats.entries >= 1);
    assert.ok(stats.sizeBytes > 0);
  });

  it('clearCache does not throw on empty cache', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cache-clear-'));
    const savedCwd = process.cwd();
    process.chdir(freshDir);

    try {
      await clearCache(); // Should not throw
    } finally {
      process.chdir(savedCwd);
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('clearCache removes cached entries', async () => {
    const prompt = `clear-test-${Date.now()}`;
    await cacheResponse(prompt, 'will be cleared', 'test');

    await clearCache();

    const result = await getCachedResponse(prompt);
    assert.strictEqual(result, null);
  });
});
