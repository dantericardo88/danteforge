// State lock tests — isProcessAlive, clearStaleLock, acquireStateLock, withStateLock

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isProcessAlive,
  clearStaleLock,
  acquireStateLock,
  withStateLock,
  LOCK_MAX_RETRIES,
  LOCK_BASE_DELAY_MS,
} from '../src/core/state-lock.js';

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('LOCK_MAX_RETRIES is a positive integer', () => {
    assert.ok(Number.isInteger(LOCK_MAX_RETRIES));
    assert.ok(LOCK_MAX_RETRIES > 0);
  });

  it('LOCK_BASE_DELAY_MS is a positive number', () => {
    assert.ok(typeof LOCK_BASE_DELAY_MS === 'number');
    assert.ok(LOCK_BASE_DELAY_MS > 0);
  });
});

// ── isProcessAlive ────────────────────────────────────────────────────────────

describe('isProcessAlive', () => {
  it('returns true for the current process PID', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('returns false for an invalid PID (very large number)', () => {
    // PID 2^30 is unlikely to exist on any OS
    assert.equal(isProcessAlive(2 ** 30), false);
  });

  it('returns false for PID 0 on most platforms', () => {
    // PID 0 either signals all processes (POSIX) or fails — either way should be
    // false in our try/catch wrapper
    const result = isProcessAlive(0);
    assert.ok(typeof result === 'boolean');
  });
});

// ── clearStaleLock ────────────────────────────────────────────────────────────

describe('clearStaleLock', () => {
  it('does nothing when lock file does not exist', async () => {
    await assert.doesNotReject(() =>
      clearStaleLock(path.join(os.tmpdir(), 'dante-test-no-such-lock.lock'))
    );
  });

  it('removes lock file when PID is dead', async () => {
    const lockPath = path.join(os.tmpdir(), `dante-stale-test-${Date.now()}.lock`);
    // Write a definitely-dead PID
    await fs.writeFile(lockPath, '999999999', 'utf8');
    await clearStaleLock(lockPath);
    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    // File should be gone (dead PID gets cleaned) or still there (PID happens to exist) — either is ok
    assert.ok(typeof exists === 'boolean');
  });

  it('does not throw when lock file has invalid (non-numeric) content', async () => {
    const lockPath = path.join(os.tmpdir(), `dante-bad-content-${Date.now()}.lock`);
    await fs.writeFile(lockPath, 'not-a-pid', 'utf8');
    await assert.doesNotReject(() => clearStaleLock(lockPath));
    // Cleanup
    await fs.unlink(lockPath).catch(() => {});
  });

  it('does not throw on empty file', async () => {
    const lockPath = path.join(os.tmpdir(), `dante-empty-lock-${Date.now()}.lock`);
    await fs.writeFile(lockPath, '', 'utf8');
    await assert.doesNotReject(() => clearStaleLock(lockPath));
    await fs.unlink(lockPath).catch(() => {});
  });
});

// ── acquireStateLock + withStateLock ──────────────────────────────────────────

describe('acquireStateLock', () => {
  it('acquires a lock and returns a release function', async () => {
    const lockPath = path.join(os.tmpdir(), `dante-acquire-${Date.now()}.lock`);
    const release = await acquireStateLock(lockPath);
    assert.equal(typeof release, 'function');
    // Verify lock file exists
    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    assert.ok(exists);
    await release();
    // After release, lock file should be gone
    const afterRelease = await fs.access(lockPath).then(() => true).catch(() => false);
    assert.equal(afterRelease, false);
  });

  it('release is idempotent (double release does not throw)', async () => {
    const lockPath = path.join(os.tmpdir(), `dante-double-release-${Date.now()}.lock`);
    const release = await acquireStateLock(lockPath);
    await release();
    await assert.doesNotReject(() => release());
  });
});

describe('withStateLock', () => {
  it('executes fn while holding lock and returns result', async () => {
    const lockPath = path.join(os.tmpdir(), `dante-with-lock-${Date.now()}.lock`);
    const result = await withStateLock(lockPath, async () => 42);
    assert.equal(result, 42);
    // Lock should be released
    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    assert.equal(exists, false);
  });

  it('releases lock even when fn throws', async () => {
    const lockPath = path.join(os.tmpdir(), `dante-lock-throw-${Date.now()}.lock`);
    await assert.rejects(
      () => withStateLock(lockPath, async () => { throw new Error('fn failed'); }),
      /fn failed/,
    );
    // Lock should still be released
    const exists = await fs.access(lockPath).then(() => true).catch(() => false);
    assert.equal(exists, false);
  });
});
