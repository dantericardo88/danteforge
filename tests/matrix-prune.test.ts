// Tests for src/cli/commands/matrix-prune.ts
//
// Uses real tmpdir fixtures rather than mocking — the function is mostly
// fs and graph-shape glue, and a real fs test catches both better.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { matrixPrune } from '../src/cli/commands/matrix-prune.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function makeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-prune-'));
  tmpDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge-worktrees'), { recursive: true });
  await fs.mkdir(path.join(dir, '.danteforge', 'matrix'), { recursive: true });
  await fs.mkdir(path.join(dir, '.danteforge', 'embedded-mode'), { recursive: true });
  return dir;
}

async function writeLeaseGraph(cwd: string, leases: Array<{ id: string; branch: string; worktreePath: string; status: string; issuedAt?: string }>): Promise<void> {
  await fs.writeFile(
    path.join(cwd, '.danteforge', 'matrix', 'matrix.lease-graph.json'),
    JSON.stringify({ generatedAt: '2026-01-01T00:00:00Z', leases }, null, 2),
    'utf8',
  );
}

describe('matrixPrune', () => {
  it('removes orphan worktree dirs not in lease graph (no leases at all)', async () => {
    const cwd = await makeFixture();
    await fs.mkdir(path.join(cwd, '.danteforge-worktrees', 'lease.orphan.A'), { recursive: true });
    await fs.mkdir(path.join(cwd, '.danteforge-worktrees', 'lease.orphan.B'), { recursive: true });

    const result = await matrixPrune({ cwd });

    assert.equal(result.worktreesRemoved.length, 2);
    assert.equal(result.skipped.length, 0);
    const remaining = await fs.readdir(path.join(cwd, '.danteforge-worktrees'));
    assert.equal(remaining.length, 0);
  });

  it('keeps worktrees for active leases', async () => {
    const cwd = await makeFixture();
    await fs.mkdir(path.join(cwd, '.danteforge-worktrees', 'lease.active'), { recursive: true });
    await fs.mkdir(path.join(cwd, '.danteforge-worktrees', 'lease.completed'), { recursive: true });
    await writeLeaseGraph(cwd, [
      { id: 'lease.active', branch: 'matrix/active', worktreePath: 'x', status: 'active' },
      { id: 'lease.completed', branch: 'matrix/completed', worktreePath: 'y', status: 'completed' },
    ]);

    const result = await matrixPrune({ cwd });

    assert.equal(result.worktreesRemoved.length, 1, 'completed lease pruned, active kept');
    const remaining = await fs.readdir(path.join(cwd, '.danteforge-worktrees'));
    assert.deepEqual(remaining, ['lease.active']);
  });

  it('removes embedded-mode dirs for non-active leases', async () => {
    const cwd = await makeFixture();
    await fs.mkdir(path.join(cwd, '.danteforge', 'embedded-mode', 'lease.done'), { recursive: true });
    await fs.mkdir(path.join(cwd, '.danteforge', 'embedded-mode', 'lease.pending'), { recursive: true });
    await writeLeaseGraph(cwd, [
      { id: 'lease.done', branch: 'b', worktreePath: 'x', status: 'failed' },
      { id: 'lease.pending', branch: 'b', worktreePath: 'y', status: 'pending' },
    ]);

    const result = await matrixPrune({ cwd });

    assert.equal(result.embeddedDirsRemoved.length, 1);
    const remaining = await fs.readdir(path.join(cwd, '.danteforge', 'embedded-mode'));
    assert.deepEqual(remaining, ['lease.pending']);
  });

  it('--older-than marks aged lease records as revoked', async () => {
    const cwd = await makeFixture();
    const oldIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
    const recentIso = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
    await writeLeaseGraph(cwd, [
      { id: 'lease.old', branch: 'b', worktreePath: 'x', status: 'failed', issuedAt: oldIso },
      { id: 'lease.recent', branch: 'b', worktreePath: 'y', status: 'failed', issuedAt: recentIso },
    ]);

    const result = await matrixPrune({ cwd, olderThanHours: 24 });

    assert.deepEqual(result.leasesRevoked, ['lease.old']);
    const raw = await fs.readFile(path.join(cwd, '.danteforge', 'matrix', 'matrix.lease-graph.json'), 'utf8');
    const parsed = JSON.parse(raw) as { leases: Array<{ id: string; status: string; revokedReason?: string }> };
    const old = parsed.leases.find(l => l.id === 'lease.old');
    assert.equal(old?.status, 'revoked');
    assert.ok(old?.revokedReason?.includes('aged out'));
  });

  it('--dry-run reports without mutating', async () => {
    const cwd = await makeFixture();
    await fs.mkdir(path.join(cwd, '.danteforge-worktrees', 'lease.dry'), { recursive: true });

    const result = await matrixPrune({ cwd, dryRun: true });

    assert.equal(result.worktreesRemoved.length, 1);
    const remaining = await fs.readdir(path.join(cwd, '.danteforge-worktrees'));
    assert.deepEqual(remaining, ['lease.dry'], 'dry-run did not actually delete');
  });
});
