// OSS Clean — unit tests for cache purge behavior.
// Uses real temp directories — no injection seams needed.

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

async function createCacheDirs(baseDir: string): Promise<{ ossRepos: string; ossDeep: string }> {
  const danteforge = path.join(baseDir, '.danteforge');
  const ossRepos = path.join(danteforge, 'oss-repos');
  const ossDeep = path.join(danteforge, 'oss-deep');

  await fs.mkdir(ossRepos, { recursive: true });
  await fs.mkdir(ossDeep, { recursive: true });

  // Write some sample files into the cache dirs
  await fs.writeFile(path.join(ossRepos, 'sample.txt'), 'cloned repo data', 'utf8');
  await fs.writeFile(path.join(ossDeep, 'patterns.json'), '[]', 'utf8');

  return { ossRepos, ossDeep };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('OSS Clean — cache purge', () => {

  it('T1: ossClean removes oss-repos and oss-deep directories', async () => {
    const dir = await makeTempDir();
    const { ossRepos, ossDeep } = await createCacheDirs(dir);

    await ossClean({ cwd: dir });

    const reposExists = await fs.access(ossRepos).then(() => true).catch(() => false);
    const deepExists = await fs.access(ossDeep).then(() => true).catch(() => false);

    assert.strictEqual(reposExists, false, 'oss-repos/ must be deleted');
    assert.strictEqual(deepExists, false, 'oss-deep/ must be deleted');
  });

  it('T2: ossClean with dryRun=true does NOT delete directories', async () => {
    const dir = await makeTempDir();
    const { ossRepos, ossDeep } = await createCacheDirs(dir);

    await ossClean({ cwd: dir, dryRun: true });

    const reposExists = await fs.access(ossRepos).then(() => true).catch(() => false);
    const deepExists = await fs.access(ossDeep).then(() => true).catch(() => false);

    assert.strictEqual(reposExists, true, 'oss-repos/ must NOT be deleted in dry-run mode');
    assert.strictEqual(deepExists, true, 'oss-deep/ must NOT be deleted in dry-run mode');
  });

  it('T3: ossClean is a no-op and does not throw when no cache exists', async () => {
    const dir = await makeTempDir();
    // No .danteforge/ directory — completely empty base dir

    let threw = false;
    try {
      await ossClean({ cwd: dir });
    } catch {
      threw = true;
    }

    assert.strictEqual(threw, false, 'ossClean must not throw when no cache directories exist');
  });

  it('T4: ossClean only removes oss-repos and oss-deep, leaves other .danteforge/ content intact', async () => {
    const dir = await makeTempDir();
    const danteforge = path.join(dir, '.danteforge');

    // Create the cache dirs AND a STATE.yaml that must survive
    await createCacheDirs(dir);
    const stateFile = path.join(danteforge, 'STATE.yaml');
    await fs.writeFile(stateFile, 'phase: forge\n', 'utf8');

    await ossClean({ cwd: dir });

    const stateExists = await fs.access(stateFile).then(() => true).catch(() => false);
    const ossReposExists = await fs.access(path.join(danteforge, 'oss-repos')).then(() => true).catch(() => false);
    const ossDeepExists = await fs.access(path.join(danteforge, 'oss-deep')).then(() => true).catch(() => false);

    assert.strictEqual(stateExists, true, 'STATE.yaml must survive ossClean');
    assert.strictEqual(ossReposExists, false, 'oss-repos/ must be removed');
    assert.strictEqual(ossDeepExists, false, 'oss-deep/ must be removed');
  });

});
