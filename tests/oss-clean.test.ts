// OSS Clean — unit tests for cache purge behavior.
// Uses real temp directories — no injection seams needed.
// DANTEFORGE_OSS_CACHE is set per-test so each test gets an isolated shared cache dir.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ossClean } from '../src/cli/commands/oss-clean.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-oss-clean-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/**
 * Creates the shared OSS cache dir and the per-project oss-deep dir.
 * The caller is responsible for setting DANTEFORGE_OSS_CACHE = ossCache
 * before calling ossClean so the function resolves the right cache root.
 */
async function createCacheDirs(
  ossCache: string,
  projectDir: string,
): Promise<{ ossCache: string; ossDeep: string }> {
  const ossDeep = path.join(projectDir, '.danteforge', 'oss-deep');

  await fs.mkdir(ossCache, { recursive: true });
  await fs.mkdir(ossDeep, { recursive: true });

  await fs.writeFile(path.join(ossCache, 'sample.txt'), 'cloned repo data', 'utf8');
  await fs.writeFile(path.join(ossDeep, 'patterns.json'), '[]', 'utf8');

  return { ossCache, ossDeep };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('OSS Clean — cache purge', () => {

  it('T1: ossClean removes shared OSS cache and oss-deep directories', async () => {
    const dir = await makeTempDir();
    const cacheDir = await makeTempDir();
    process.env.DANTEFORGE_OSS_CACHE = cacheDir;
    try {
      const { ossCache, ossDeep } = await createCacheDirs(cacheDir, dir);

      await ossClean({ cwd: dir });

      const cacheExists = await fs.access(ossCache).then(() => true).catch(() => false);
      const deepExists = await fs.access(ossDeep).then(() => true).catch(() => false);

      assert.strictEqual(cacheExists, false, 'shared OSS cache must be deleted');
      assert.strictEqual(deepExists, false, 'oss-deep/ must be deleted');
    } finally {
      delete process.env.DANTEFORGE_OSS_CACHE;
    }
  });

  it('T2: ossClean with dryRun=true does NOT delete directories', async () => {
    const dir = await makeTempDir();
    const cacheDir = await makeTempDir();
    process.env.DANTEFORGE_OSS_CACHE = cacheDir;
    try {
      const { ossCache, ossDeep } = await createCacheDirs(cacheDir, dir);

      await ossClean({ cwd: dir, dryRun: true });

      const cacheExists = await fs.access(ossCache).then(() => true).catch(() => false);
      const deepExists = await fs.access(ossDeep).then(() => true).catch(() => false);

      assert.strictEqual(cacheExists, true, 'shared OSS cache must NOT be deleted in dry-run mode');
      assert.strictEqual(deepExists, true, 'oss-deep/ must NOT be deleted in dry-run mode');
    } finally {
      delete process.env.DANTEFORGE_OSS_CACHE;
    }
  });

  it('T3: ossClean is a no-op and does not throw when no cache exists', async () => {
    const dir = await makeTempDir();
    const cacheDir = await makeTempDir();
    process.env.DANTEFORGE_OSS_CACHE = cacheDir;
    // Remove cacheDir so neither target exists
    await fs.rm(cacheDir, { recursive: true, force: true });

    let threw = false;
    try {
      await ossClean({ cwd: dir });
    } catch {
      threw = true;
    } finally {
      delete process.env.DANTEFORGE_OSS_CACHE;
    }

    assert.strictEqual(threw, false, 'ossClean must not throw when no cache directories exist');
  });

  it('T4: ossClean removes shared cache and oss-deep, leaves other .danteforge/ content intact', async () => {
    const dir = await makeTempDir();
    const cacheDir = await makeTempDir();
    const danteforge = path.join(dir, '.danteforge');
    process.env.DANTEFORGE_OSS_CACHE = cacheDir;
    try {
      await createCacheDirs(cacheDir, dir);
      const stateFile = path.join(danteforge, 'STATE.yaml');
      await fs.writeFile(stateFile, 'phase: forge\n', 'utf8');

      await ossClean({ cwd: dir });

      const stateExists = await fs.access(stateFile).then(() => true).catch(() => false);
      const cacheExists = await fs.access(cacheDir).then(() => true).catch(() => false);
      const ossDeepExists = await fs.access(path.join(danteforge, 'oss-deep')).then(() => true).catch(() => false);

      assert.strictEqual(stateExists, true, 'STATE.yaml must survive ossClean');
      assert.strictEqual(cacheExists, false, 'shared OSS cache must be removed');
      assert.strictEqual(ossDeepExists, false, 'oss-deep/ must be removed');
    } finally {
      delete process.env.DANTEFORGE_OSS_CACHE;
    }
  });

});
