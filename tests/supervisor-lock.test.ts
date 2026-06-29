import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireSupervisorLock, releaseSupervisorLock, SUPERVISOR_LOCK_FILE } from '../src/core/supervisor-lock.js';

const ROOT = path.join(os.tmpdir(), `supervisor-lock-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

async function freshDir(name: string): Promise<string> {
  const d = path.join(ROOT, name);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('supervisor-lock — PID-liveness singleton', () => {
  test('acquires when no lock exists', async () => {
    const cwd = await freshDir('none');
    const r = await acquireSupervisorLock(cwd, { _isAlive: () => true });
    assert.equal(r.acquired, true);
    const raw = await fs.readFile(path.join(cwd, SUPERVISOR_LOCK_FILE), 'utf8');
    assert.match(raw, /"pid"/);
  });

  test('REFUSES when a different, LIVE process holds the lock', async () => {
    const cwd = await freshDir('live');
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, SUPERVISOR_LOCK_FILE), JSON.stringify({ pid: 999999, startedAt: 'x' }), 'utf8');
    const r = await acquireSupervisorLock(cwd, { _isAlive: (pid) => pid === 999999 });
    assert.equal(r.acquired, false);
    assert.equal(r.heldByPid, 999999);
  });

  test('TAKES OVER a stale lock held by a DEAD process', async () => {
    const cwd = await freshDir('dead');
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, SUPERVISOR_LOCK_FILE), JSON.stringify({ pid: 999998, startedAt: 'x' }), 'utf8');
    const r = await acquireSupervisorLock(cwd, { _isAlive: () => false });
    assert.equal(r.acquired, true);
  });

  test('takes over a malformed lock file', async () => {
    const cwd = await freshDir('malformed');
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, SUPERVISOR_LOCK_FILE), 'not json', 'utf8');
    const r = await acquireSupervisorLock(cwd, { _isAlive: () => true });
    assert.equal(r.acquired, true);
  });

  test('release removes our own lock', async () => {
    const cwd = await freshDir('release');
    await acquireSupervisorLock(cwd, { _isAlive: () => true });
    await releaseSupervisorLock(cwd);
    await assert.rejects(fs.readFile(path.join(cwd, SUPERVISOR_LOCK_FILE), 'utf8'));
  });
});
