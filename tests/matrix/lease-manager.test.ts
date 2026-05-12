// Phase 5 — Lease Manager tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLease,
  validateChangedFiles,
  detectLeaseConflicts,
  transitionLease,
  isValidTransition,
} from '../../src/matrix/engines/lease-manager.js';
import type { WorkPacket, OwnershipMap, AgentLease } from '../../src/matrix/types/index.js';

function fakePacket(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: 'work.test.001',
    title: 't', objective: 'o',
    dimensionId: 'dim.test',
    paths: {
      ownedPaths: ['src/test/**'],
      readOnlyPaths: [],
      forbiddenPaths: ['src/frozen/**'],
    },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['a'],
    proof: { proofRequired: ['p'], requiredCommands: ['npm test'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'r',
    riskLevel: 'low',
    createdAt: '',
    ...overrides,
  };
}

function fakeOwnership(frozen: string[] = []): OwnershipMap {
  return {
    version: 1, generatedAt: '',
    globalAllowed: [], workstreams: {}, frozenFiles: frozen,
  };
}

describe('createLease', () => {
  it('issues a lease with all required fields', () => {
    const lease = createLease({
      workPacket: fakePacket(),
      provider: 'fake',
      agentRole: 'dimension-engineer',
      ownershipMap: fakeOwnership(),
    });
    assert.ok(lease.id.startsWith('lease.test.001.fake.'));
    assert.equal(lease.provider, 'fake');
    assert.equal(lease.status, 'pending');
    assert.deepEqual(lease.allowedWritePaths, ['src/test/**']);
    assert.deepEqual(lease.forbiddenPaths, ['src/frozen/**']);
    assert.ok(lease.budget.maxTokens > 0);
  });

  it('refuses to issue lease for frozen owned path', () => {
    assert.throws(() =>
      createLease({
        workPacket: fakePacket({ paths: { ownedPaths: ['src/cli/index.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        provider: 'fake',
        agentRole: 'dimension-engineer',
        ownershipMap: fakeOwnership(['src/cli/index.ts']),
      }),
    );
  });

  it('inherits requiredCommands from packet', () => {
    const lease = createLease({
      workPacket: fakePacket({
        proof: { proofRequired: ['p'], requiredCommands: ['npm run typecheck', 'npm test'] },
      }),
      provider: 'fake', agentRole: 'dimension-engineer',
      ownershipMap: fakeOwnership(),
    });
    assert.deepEqual(lease.requiredCommands, ['npm run typecheck', 'npm test']);
  });
});

describe('validateChangedFiles', () => {
  const lease: AgentLease = {
    id: 'lease.test',
    workPacketId: 'w', provider: 'fake', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath: 'p',
    allowedWritePaths: ['src/test/foo.ts', 'src/test/bar.ts'],
    allowedReadPaths: [], forbiddenPaths: ['src/frozen/**'],
    requiredCommands: [], budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
    status: 'active',
  };

  it('passes when all changed files are within allowed paths', () => {
    const r = validateChangedFiles(lease, ['src/test/foo.ts'], fakeOwnership());
    assert.equal(r.valid, true);
    assert.deepEqual(r.violations, []);
  });

  it('rejects changes to forbidden paths', () => {
    const r = validateChangedFiles(lease, ['src/frozen/danger.ts'], fakeOwnership());
    assert.equal(r.valid, false);
    assert.ok(r.violations[0]!.includes('FORBIDDEN'));
  });

  it('rejects changes to files outside allowed write paths', () => {
    const r = validateChangedFiles(lease, ['src/other/leak.ts'], fakeOwnership());
    assert.equal(r.valid, false);
    assert.ok(r.violations[0]!.includes('OUTSIDE'));
  });

  it('rejects changes to globally-frozen paths', () => {
    const r = validateChangedFiles(lease, ['src/test/foo.ts'], fakeOwnership(['src/test/foo.ts']));
    assert.equal(r.valid, false);
    assert.ok(r.violations[0]!.includes('FROZEN'));
  });
});

describe('detectLeaseConflicts', () => {
  function makeLease(id: string, paths: string[]): AgentLease {
    return {
      id, workPacketId: id, provider: 'fake', agentRole: 'dimension-engineer',
      branch: id, worktreePath: id,
      allowedWritePaths: paths,
      allowedReadPaths: [], forbiddenPaths: [],
      requiredCommands: [], budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
      status: 'pending',
    };
  }

  it('returns empty when no overlap', () => {
    const conflicts = detectLeaseConflicts([
      makeLease('a', ['src/a/**']),
      makeLease('b', ['src/b/**']),
    ]);
    assert.deepEqual(conflicts, []);
  });

  it('finds overlap pairs', () => {
    const conflicts = detectLeaseConflicts([
      makeLease('a', ['src/foo.ts']),
      makeLease('b', ['src/foo.ts']),
    ]);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0]!.overlappingPaths, ['src/foo.ts']);
  });
});

describe('transitionLease + isValidTransition', () => {
  it('allows pending → issued', () => {
    assert.equal(isValidTransition('pending', 'issued'), true);
  });

  it('blocks invalid transitions', () => {
    assert.equal(isValidTransition('completed', 'active'), false);
    assert.equal(isValidTransition('revoked', 'pending'), false);
  });

  it('throws on invalid transition', () => {
    const lease: AgentLease = {
      id: 'x', workPacketId: 'w', provider: 'p', agentRole: 'dimension-engineer',
      branch: 'b', worktreePath: '/tmp', allowedWritePaths: [], allowedReadPaths: [],
      forbiddenPaths: [], requiredCommands: [],
      budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
      status: 'completed',
    };
    assert.throws(() => transitionLease(lease, 'active'));
  });

  it('sets startedAt on transition to active', () => {
    const lease: AgentLease = {
      id: 'x', workPacketId: 'w', provider: 'p', agentRole: 'dimension-engineer',
      branch: 'b', worktreePath: '/tmp', allowedWritePaths: [], allowedReadPaths: [],
      forbiddenPaths: [], requiredCommands: [],
      budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
      status: 'issued',
    };
    const next = transitionLease(lease, 'active');
    assert.equal(next.status, 'active');
    assert.ok(next.startedAt);
  });
});
