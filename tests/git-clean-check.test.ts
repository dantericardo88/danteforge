// Tests for src/utils/git-clean-check.ts
//
// Uses the injection seam (`_git`) to avoid spawning real subprocess and to
// stay deterministic across environments. The real path-spawn is covered by
// the matrix-kernel integration tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCleanWorkTree } from '../src/utils/git-clean-check.js';

describe('isCleanWorkTree', () => {
  it('reports clean when porcelain output is empty', async () => {
    const result = await isCleanWorkTree('/fake/cwd', async () => '');
    assert.equal(result.clean, true);
    assert.deepEqual(result.modified, []);
    assert.deepEqual(result.untracked, []);
    assert.equal(result.error, null);
  });

  it('classifies modified vs untracked', async () => {
    const porcelain = ' M src/foo.ts\nM  src/bar.ts\n?? src/new.ts\n A src/staged.ts\n';
    const result = await isCleanWorkTree('/fake/cwd', async () => porcelain);
    assert.equal(result.clean, false);
    assert.deepEqual(result.modified, ['src/foo.ts', 'src/bar.ts', 'src/staged.ts']);
    assert.deepEqual(result.untracked, ['src/new.ts']);
  });

  it('does not throw when git fails; reports clean+error', async () => {
    const result = await isCleanWorkTree('/fake/cwd', async () => {
      throw new Error('not a git repository');
    });
    assert.equal(result.clean, true);
    assert.equal(result.modified.length, 0);
    assert.ok(result.error && result.error.includes('not a git'));
  });

  it('ignores CRLF line endings', async () => {
    const result = await isCleanWorkTree('/fake/cwd', async () => 'M  foo.ts\r\n?? bar.ts\r\n');
    assert.equal(result.clean, false);
    assert.deepEqual(result.modified, ['foo.ts']);
    assert.deepEqual(result.untracked, ['bar.ts']);
  });

  it('skips blank lines', async () => {
    const result = await isCleanWorkTree('/fake/cwd', async () => '\n\n');
    assert.equal(result.clean, true);
  });
});
