import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  saveCheckpoint,
  loadCheckpoint,
  recordMilestone,
  clearCheckpoint,
  listCheckpoints,
  completedMilestoneIds,
  type WorkPacketCheckpoint,
} from '../src/matrix/engines/checkpointer.js';

let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-chk-'));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('saveCheckpoint / loadCheckpoint', () => {
  it('round-trips a checkpoint', async () => {
    const cp: WorkPacketCheckpoint = {
      packetId: 'pkt-001',
      dimensionId: 'autonomy',
      agentProvider: 'claude',
      startedAt: '2026-05-21T00:00:00Z',
      updatedAt: '2026-05-21T00:00:00Z',
      completedMilestones: [],
      progressSummary: 'started',
    };
    await saveCheckpoint(cp, tmpDir);
    const loaded = await loadCheckpoint('pkt-001', tmpDir);
    assert.ok(loaded);
    assert.equal(loaded.packetId, 'pkt-001');
    assert.equal(loaded.dimensionId, 'autonomy');
  });

  it('returns undefined for a missing checkpoint', async () => {
    const result = await loadCheckpoint('pkt-nonexistent', tmpDir);
    assert.equal(result, undefined);
  });
});

describe('recordMilestone', () => {
  it('appends a milestone and persists it', async () => {
    const cp = await recordMilestone('pkt-002', 'testing', { id: 'm1', label: 'Set up scaffold', artifacts: ['src/eval.ts'] }, { cwd: tmpDir });
    assert.equal(cp.completedMilestones.length, 1);
    assert.equal(cp.completedMilestones[0].id, 'm1');
    assert.ok(cp.completedMilestones[0].completedAt);
  });

  it('accumulates milestones on subsequent calls', async () => {
    await recordMilestone('pkt-003', 'multi_agent_orchestration', { id: 'a', label: 'Step A', artifacts: [] }, { cwd: tmpDir });
    const cp = await recordMilestone('pkt-003', 'multi_agent_orchestration', { id: 'b', label: 'Step B', artifacts: [] }, { cwd: tmpDir });
    assert.equal(cp.completedMilestones.length, 2);
  });
});

describe('clearCheckpoint', () => {
  it('removes the checkpoint file', async () => {
    await saveCheckpoint({ packetId: 'pkt-del', dimensionId: 'x', agentProvider: 'y', startedAt: '', updatedAt: '', completedMilestones: [], progressSummary: '' }, tmpDir);
    await clearCheckpoint('pkt-del', tmpDir);
    const result = await loadCheckpoint('pkt-del', tmpDir);
    assert.equal(result, undefined);
  });

  it('does not throw when checkpoint does not exist', async () => {
    await assert.doesNotReject(() => clearCheckpoint('pkt-ghost', tmpDir));
  });
});

describe('listCheckpoints', () => {
  it('returns all saved checkpoints', async () => {
    const sub = await fs.mkdtemp(path.join(os.tmpdir(), 'df-lst-'));
    try {
      await saveCheckpoint({ packetId: 'x1', dimensionId: 'd', agentProvider: 'a', startedAt: '', updatedAt: '2026-01-01', completedMilestones: [], progressSummary: '' }, sub);
      await saveCheckpoint({ packetId: 'x2', dimensionId: 'd', agentProvider: 'a', startedAt: '', updatedAt: '2026-01-02', completedMilestones: [], progressSummary: '' }, sub);
      const list = await listCheckpoints(sub);
      assert.equal(list.length, 2);
    } finally {
      await fs.rm(sub, { recursive: true, force: true });
    }
  });

  it('returns empty array when no checkpoints exist', async () => {
    const sub = await fs.mkdtemp(path.join(os.tmpdir(), 'df-empty-'));
    try {
      const list = await listCheckpoints(sub);
      assert.deepEqual(list, []);
    } finally {
      await fs.rm(sub, { recursive: true, force: true });
    }
  });
});

describe('completedMilestoneIds', () => {
  it('returns set of milestone IDs', async () => {
    const cp = await recordMilestone('pkt-ids', 'ux_polish', { id: 'spinner', label: 'Add spinner', artifacts: [] }, { cwd: tmpDir });
    const ids = completedMilestoneIds(cp);
    assert.ok(ids.has('spinner'));
  });

  it('returns empty set for undefined checkpoint', () => {
    const ids = completedMilestoneIds(undefined);
    assert.equal(ids.size, 0);
  });
});
