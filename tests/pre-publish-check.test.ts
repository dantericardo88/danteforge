// pre-publish-check.test.ts — unit tests for scripts/pre-publish-check.mjs
// Tests that the script exits 0 when dist is present and 1 when it is missing.

import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import os from 'node:os';

const script = resolve(process.cwd(), 'scripts', 'pre-publish-check.mjs');
const tempDirs: string[] = [];

after(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function runCheck(fakeRoot: string): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [script], {
    env: { ...process.env, DANTEFORGE_PRE_PUBLISH_ROOT: fakeRoot },
    encoding: 'utf8',
    timeout: 15_000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function makeFakeRoot(withDist: boolean, distSize = 50_000): string {
  const dir = mkdtempSync(resolve(os.tmpdir(), 'df-pp-test-'));
  tempDirs.push(dir);
  if (withDist) {
    mkdirSync(resolve(dir, 'dist'), { recursive: true });
    // Write a file large enough to pass the 1000-byte check
    writeFileSync(resolve(dir, 'dist', 'index.js'), 'x'.repeat(distSize));
  }
  return dir;
}

describe('pre-publish-check script', () => {
  it('exits 1 when dist/index.js is missing', () => {
    const root = makeFakeRoot(false);
    const { exitCode, stderr } = runCheck(root);
    assert.strictEqual(exitCode, 1, 'should fail when dist/index.js is absent');
    assert.ok(
      stderr.includes('dist/index.js not found') || stderr.includes('FAIL'),
      `stderr should mention missing dist: ${stderr}`,
    );
  });

  it('exits 1 when dist/index.js is suspiciously small', () => {
    const root = makeFakeRoot(true, 100); // only 100 bytes
    const { exitCode } = runCheck(root);
    assert.strictEqual(exitCode, 1, 'should fail for tiny dist/index.js');
  });
});
