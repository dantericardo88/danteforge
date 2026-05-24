import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ClaudeCodeAdapter,
  type ClaudeChildLike,
} from '../src/matrix/adapters/claude-code-adapter.js';
import type { AgentRunInput } from '../src/matrix/adapters/adapter-interface.js';
import type { AgentLease } from '../src/matrix/types/lease.js';
import type { WorkPacket } from '../src/matrix/types/work-graph.js';

function makeLease(overrides: Partial<Record<string, unknown>> = {}): AgentLease {
  return {
    id: 'test-lease',
    workPacketId: 'wp1',
    provider: 'claude',
    branch: 'test-branch',
    worktreePath: '/tmp/test-worktree',
    allowedWritePaths: ['src/**'],
    allowedReadPaths: ['**'],
    forbiddenPaths: [],
    requiredCommands: [],
    ...overrides,
  } as unknown as AgentLease;
}

function makeWorkPacket(): WorkPacket {
  return {
    id: 'wp1',
    title: 'Test',
    objective: 'test objective',
    dimensionId: 'test_dim',
    paths: {},
    dependsOn: [],
    mayConflictWith: [],
    acceptanceCriteria: ['tests pass'],
    proof: { proofRequired: [] },
    tasteGateRequired: false,
    redTeamRequired: false,
    rollbackPlan: 'revert',
    riskLevel: 'low',
    createdAt: new Date().toISOString(),
  } as unknown as WorkPacket;
}

function makeFakeChild(exitCode: number): ClaudeChildLike {
  return {
    stdout: null,
    stderr: null,
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === 'close') setImmediate(() => cb(exitCode));
    },
    kill() { return true; },
  } as unknown as ClaudeChildLike;
}

describe('ClaudeCodeAdapter', () => {
  it('T1: isAvailable() returns false via injection seam', async () => {
    const adapter = new ClaudeCodeAdapter({
      workPacket: makeWorkPacket(),
      _isAvailable: async () => false,
    });
    assert.equal(await adapter.isAvailable(), false);
  });

  it('T2: prepareRun() returns input with prepared:true', async () => {
    const adapter = new ClaudeCodeAdapter({ workPacket: makeWorkPacket() });
    const lease = makeLease();
    const input: AgentRunInput = { lease, cwd: '/tmp/test' };
    const prepared = await adapter.prepareRun(input);
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.lease, lease);
  });

  it('T3: exit 0 + allowed file change → status completed, filesChanged populated', async () => {
    const lease = makeLease({ allowedWritePaths: ['src/**'], forbiddenPaths: [] });
    const adapter = new ClaudeCodeAdapter({
      workPacket: makeWorkPacket(),
      _isAvailable: async () => true,
      _spawn: () => makeFakeChild(0),
      _gitDiff: async () => ['src/foo.ts'],
      _revertFile: async () => {},
    });
    const input: AgentRunInput = { lease, cwd: '/tmp/test' };
    const prepared = await adapter.prepareRun(input);
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/foo.ts']);
  });

  it('T4: exit 1 → status failed, errorReason contains exit code', async () => {
    const lease = makeLease();
    const adapter = new ClaudeCodeAdapter({
      workPacket: makeWorkPacket(),
      _isAvailable: async () => true,
      _spawn: () => makeFakeChild(1),
      _gitDiff: async () => [],
      _revertFile: async () => {},
    });
    const input: AgentRunInput = { lease, cwd: '/tmp/test' };
    const prepared = await adapter.prepareRun(input);
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason?.includes('1'),
      `expected errorReason to contain '1', got: ${result.errorReason}`);
  });

  it('T5: forbidden file → _revertFile called, status failed, errorReason is edit_outside_lease', async () => {
    const lease = makeLease({
      allowedWritePaths: ['src/**'],
      forbiddenPaths: ['src/secret.ts'],
    });
    let revertCalled = false;
    const adapter = new ClaudeCodeAdapter({
      workPacket: makeWorkPacket(),
      _isAvailable: async () => true,
      _spawn: () => makeFakeChild(0),
      _gitDiff: async () => ['src/secret.ts'],
      _revertFile: async (_cwd, file) => {
        if (file === 'src/secret.ts') revertCalled = true;
      },
    });
    const input: AgentRunInput = { lease, cwd: '/tmp/test' };
    const prepared = await adapter.prepareRun(input);
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);
    assert.ok(revertCalled, '_revertFile must be called for the forbidden file');
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason?.includes('edit_outside_lease'),
      `expected 'edit_outside_lease' in errorReason, got: ${result.errorReason}`);
  });
});
