import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import os from 'node:os';
import {
  ClaudeCodeAdapter,
} from '../../src/matrix/adapters/claude-code-adapter.js';
import {
  CodexAdapter,
} from '../../src/matrix/adapters/codex-adapter.js';
import type { AgentLease } from '../../src/matrix/types/lease.js';
import type { WorkPacket } from '../../src/matrix/types/work-graph.js';

function makeWorkPacket(): WorkPacket {
  return {
    id: 'wp-integration',
    title: 'Integration Test',
    objective: 'prove adapter detection + preparation on real hardware',
    dimensionId: 'multi_agent_orchestration',
    paths: {},
    dependsOn: [],
    mayConflictWith: [],
    acceptanceCriteria: ['adapter resolves binary path'],
    proof: { proofRequired: [] },
    tasteGateRequired: false,
    redTeamRequired: false,
    rollbackPlan: 'n/a',
    riskLevel: 'low',
    createdAt: new Date().toISOString(),
  } as unknown as WorkPacket;
}

function makeLease(worktreePath: string): AgentLease {
  return {
    id: 'integration-lease',
    workPacketId: 'wp-integration',
    provider: 'claude',
    branch: 'integration-test',
    worktreePath,
    allowedWritePaths: ['**'],
    allowedReadPaths: ['**'],
    forbiddenPaths: [],
    requiredCommands: [],
  } as unknown as AgentLease;
}

// ── ClaudeCodeAdapter ─────────────────────────────────────────────────────────

describe('ClaudeCodeAdapter — integration (real hardware, no subprocess)', () => {
  it('isAvailable() returns a boolean without throwing', async () => {
    const adapter = new ClaudeCodeAdapter({ workPacket: makeWorkPacket() });
    const available = await adapter.isAvailable();
    // No assertion on the value — binary may or may not be installed on this machine.
    // The test proves the detection path (which/where + exec) runs without throwing.
    assert.equal(typeof available, 'boolean');
  });

  it('prepareRun() returns prepared:true regardless of binary presence', async () => {
    const adapter = new ClaudeCodeAdapter({ workPacket: makeWorkPacket() });
    const lease = makeLease(os.tmpdir());
    const prepared = await adapter.prepareRun({ lease, cwd: os.tmpdir() });
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.lease, lease);
  });

  it('prepareRun() cwd is preserved in prepared run', async () => {
    const adapter = new ClaudeCodeAdapter({ workPacket: makeWorkPacket() });
    const lease = makeLease(os.tmpdir());
    const cwd = os.tmpdir();
    const prepared = await adapter.prepareRun({ lease, cwd });
    assert.equal(prepared.cwd, cwd);
  });

  it('isAvailable() result is stable across two consecutive calls', async () => {
    const adapter = new ClaudeCodeAdapter({ workPacket: makeWorkPacket() });
    const first = await adapter.isAvailable();
    const second = await adapter.isAvailable();
    assert.equal(first, second);
  });
});

// ── CodexAdapter ──────────────────────────────────────────────────────────────

describe('CodexAdapter — integration (real hardware, no subprocess)', () => {
  it('isAvailable() returns a boolean without throwing', async () => {
    const adapter = new CodexAdapter({ workPacket: makeWorkPacket() });
    const available = await adapter.isAvailable();
    assert.equal(typeof available, 'boolean');
  });

  it('prepareRun() returns prepared:true regardless of binary presence', async () => {
    const adapter = new CodexAdapter({ workPacket: makeWorkPacket() });
    const lease = makeLease(os.tmpdir());
    const prepared = await adapter.prepareRun({ lease, cwd: os.tmpdir() });
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.lease, lease);
  });

  it('isAvailable() result is stable across two consecutive calls', async () => {
    const adapter = new CodexAdapter({ workPacket: makeWorkPacket() });
    const first = await adapter.isAvailable();
    const second = await adapter.isAvailable();
    assert.equal(first, second);
  });
});
