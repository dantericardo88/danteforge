// Tests for DanteSanitize per-file locks (Sprint 6)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  acquireFileLock,
  withFileLock,
  loadFrozenFiles,
  writePlatformKernelNeeded,
  LockTimeoutError,
} from '../src/core/sanitize-locks.js';

const tmpDirs: string[] = [];
async function makeTmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-locks-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

// ── acquireFileLock ──────────────────────────────────────────────────────────

describe('acquireFileLock', () => {
  it('acquires a lock atomically and releases on demand', async () => {
    const cwd = await makeTmp();
    const handle = await acquireFileLock({ cwd, filePath: 'src/foo.ts' });
    assert.ok(handle.path.includes('src_foo.ts.lock'));

    const stat = await fs.stat(handle.path);
    assert.ok(stat.isFile());

    await handle.release();
    await assert.rejects(() => fs.stat(handle.path));
  });

  it('blocks a second lock attempt on the same file', async () => {
    const cwd = await makeTmp();
    const h1 = await acquireFileLock({ cwd, filePath: 'src/foo.ts' });
    await assert.rejects(
      () => acquireFileLock({ cwd, filePath: 'src/foo.ts', maxWaitMs: 200, pollIntervalMs: 50 }),
      LockTimeoutError,
    );
    await h1.release();
  });

  it('allows different files to lock concurrently', async () => {
    const cwd = await makeTmp();
    const [h1, h2] = await Promise.all([
      acquireFileLock({ cwd, filePath: 'src/a.ts' }),
      acquireFileLock({ cwd, filePath: 'src/b.ts' }),
    ]);
    assert.ok(h1.path !== h2.path);
    await h1.release();
    await h2.release();
  });

  it('reclaims a stale lock past TTL', async () => {
    const cwd = await makeTmp();
    const lockDir = path.join(cwd, '.danteforge/sanitize/claims');
    await fs.mkdir(lockDir, { recursive: true });
    const stalePath = path.join(lockDir, 'src_foo.ts.lock');
    await fs.writeFile(stalePath, JSON.stringify({ pid: 99999, acquiredAt: '2020-01-01' }));
    // Pretend it's old by stat-mtime via utimes
    const oldDate = new Date(Date.now() - 60 * 60_000);
    await fs.utimes(stalePath, oldDate, oldDate);

    const handle = await acquireFileLock({
      cwd,
      filePath: 'src/foo.ts',
      ttlMs: 1000,  // 1 second TTL — stale lock is 1 hour old
      maxWaitMs: 500,
    });
    assert.ok(handle.path === stalePath);
    await handle.release();
  });
});

// ── withFileLock ─────────────────────────────────────────────────────────────

describe('withFileLock', () => {
  it('runs the body with the lock held and releases on success', async () => {
    const cwd = await makeTmp();
    const result = await withFileLock(
      { cwd, filePath: 'src/foo.ts' },
      async () => 'work-done',
    );
    assert.equal(result, 'work-done');
  });

  it('releases the lock even when the body throws', async () => {
    const cwd = await makeTmp();
    await assert.rejects(() =>
      withFileLock({ cwd, filePath: 'src/foo.ts' }, async () => {
        throw new Error('boom');
      }),
    );
    // Now another acquire should work
    const h = await acquireFileLock({ cwd, filePath: 'src/foo.ts', maxWaitMs: 500 });
    await h.release();
  });
});

// ── loadFrozenFiles ──────────────────────────────────────────────────────────

describe('loadFrozenFiles', () => {
  it('returns empty array when no agent-guard.json exists', async () => {
    const cwd = await makeTmp();
    const frozen = await loadFrozenFiles({ cwd });
    assert.deepEqual(frozen, []);
  });

  it('reads frozenFiles from agent-guard.json', async () => {
    const cwd = await makeTmp();
    const guardPath = path.join(cwd, '.danteforge', 'agent-guard.json');
    await fs.mkdir(path.dirname(guardPath), { recursive: true });
    await fs.writeFile(guardPath, JSON.stringify({
      frozenFiles: ['src/cli/index.ts', 'src/core/autoforge-loop.ts'],
    }));
    const frozen = await loadFrozenFiles({ cwd });
    assert.deepEqual(frozen, ['src/cli/index.ts', 'src/core/autoforge-loop.ts']);
  });

  it('returns empty when agent-guard.json is malformed', async () => {
    const cwd = await makeTmp();
    const guardPath = path.join(cwd, '.danteforge', 'agent-guard.json');
    await fs.mkdir(path.dirname(guardPath), { recursive: true });
    await fs.writeFile(guardPath, 'not valid json');
    const frozen = await loadFrozenFiles({ cwd });
    assert.deepEqual(frozen, []);
  });
});

// ── writePlatformKernelNeeded ────────────────────────────────────────────────

describe('writePlatformKernelNeeded', () => {
  it('writes a JSON file with the frozen violations', async () => {
    const cwd = await makeTmp();
    const filePath = await writePlatformKernelNeeded({
      cwd,
      files: [{ path: 'src/cli/index.ts', loc: 800 }],
    });
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    assert.equal(data.files.length, 1);
    assert.equal(data.files[0].path, 'src/cli/index.ts');
    assert.equal(data.files[0].loc, 800);
    assert.ok(data.note.includes('platform-kernel'));
  });
});
