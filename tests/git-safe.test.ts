import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runGit, clearStaleIndexLock, MUTATING_GIT } from '../src/core/git-safe.js';

const execFileAsync = promisify(execFile);
const ROOT = path.join('X:\\tmp', `git-safe-${process.pid}`);
const LOCK = path.join(ROOT, '.git', 'index.lock');

before(async () => {
  await fs.mkdir(ROOT, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: ROOT });
  await execFileAsync('git', ['config', 'user.email', 'test@test.com'], { cwd: ROOT });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: ROOT });
  await fs.writeFile(path.join(ROOT, 'a.txt'), 'hello');
});
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

describe('git-safe — serialized mutations + stale index.lock recovery (the --parallel deadlock fix)', () => {
  test('clearStaleIndexLock removes a leftover index.lock', async () => {
    await fs.writeFile(LOCK, 'stale');
    assert.ok(await clearStaleIndexLock(ROOT));
    await assert.rejects(fs.stat(LOCK), 'the stale lock is gone');
  });

  test('a mutating git op clears a STALE index.lock and succeeds (no 30-min deadlock)', async () => {
    // Simulate a worker tree-killed mid-checkout: a stale index.lock nothing cleared.
    await fs.writeFile(LOCK, 'stale-from-killed-worker');
    // Without the fix this throws "Unable to create '.git/index.lock': File exists". With it, runGit
    // clears the stale lock while holding the mutex, then the add succeeds.
    await runGit(['add', '-A'], ROOT);
    await runGit(['commit', '-q', '-m', 'first'], ROOT);
    const head = await runGit(['rev-parse', 'HEAD'], ROOT);
    assert.match(head, /^[0-9a-f]{40}$/, 'the commit landed despite the stale lock');
    await assert.rejects(fs.stat(LOCK), 'no lingering index.lock');
  });

  test('concurrent mutating ops serialize without corrupting the index (no race)', async () => {
    await fs.writeFile(path.join(ROOT, 'b.txt'), 'b');
    await fs.writeFile(path.join(ROOT, 'c.txt'), 'c');
    // Fire two mutating ops at once — the cross-process O_EXCL mutex serializes them.
    await Promise.all([
      runGit(['add', 'b.txt'], ROOT),
      runGit(['add', 'c.txt'], ROOT),
    ]);
    await runGit(['commit', '-q', '-m', 'both'], ROOT);
    const tracked = await runGit(['ls-files'], ROOT);
    assert.ok(tracked.includes('b.txt') && tracked.includes('c.txt'), 'both concurrent adds landed');
  });

  test('read-only verbs skip the lock (fast path)', () => {
    assert.ok(!MUTATING_GIT.has('status'));
    assert.ok(!MUTATING_GIT.has('rev-parse'));
    assert.ok(MUTATING_GIT.has('checkout'));
    assert.ok(MUTATING_GIT.has('commit'));
  });
});
