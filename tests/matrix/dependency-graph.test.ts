// Phase 4 — Dependency Graph builder tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDependencyGraph } from '../../src/matrix/engines/dependency-graph.js';
import type { WorkGraph, WorkPacket } from '../../src/matrix/types/index.js';

function makePacket(overrides: Partial<WorkPacket>): WorkPacket {
  return {
    id: 'work.x',
    title: 'x', objective: 'x',
    dimensionId: 'dim.x',
    paths: { ownedPaths: [], readOnlyPaths: [], forbiddenPaths: [] },
    dependsOn: [],
    mayConflictWith: [],
    acceptanceCriteria: ['a'],
    proof: { proofRequired: ['p'] },
    tasteGateRequired: false,
    redTeamRequired: false,
    rollbackPlan: 'r',
    riskLevel: 'low',
    createdAt: '',
    ...overrides,
  };
}

describe('buildDependencyGraph', () => {
  it('returns READY status for a single packet with no edges', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [makePacket({ id: 'a' })],
    };
    const graph = buildDependencyGraph({ workGraph });
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0]!.status, 'READY');
  });

  it('emits hard edges for explicit dependsOn', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [
        makePacket({ id: 'a' }),
        makePacket({ id: 'b', dependsOn: ['a'] }),
      ],
    };
    const graph = buildDependencyGraph({ workGraph });
    const hardEdges = graph.edges.filter(e => e.strength === 'hard');
    assert.ok(hardEdges.some(e => e.fromPacketId === 'a' && e.toPacketId === 'b'));
    const bNode = graph.nodes.find(n => n.workPacketId === 'b')!;
    assert.equal(bNode.status, 'BLOCKED_BY_DEPENDENCY');
    assert.deepEqual(bNode.blockedBy, ['a']);
  });

  it('infers hard edges from shared write paths', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [
        makePacket({ id: 'a', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        makePacket({ id: 'b', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
    };
    const graph = buildDependencyGraph({ workGraph });
    const sharedEdge = graph.edges.find(e =>
      e.strength === 'hard' && e.reason.includes('shared write paths'),
    );
    assert.ok(sharedEdge, 'expected shared-write hard edge');
  });

  it('marks packets with shared write paths as CONFLICTING', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [
        makePacket({ id: 'a', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        makePacket({ id: 'b', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
    };
    const graph = buildDependencyGraph({ workGraph });
    const aNode = graph.nodes.find(n => n.workPacketId === 'a')!;
    assert.ok(aNode.cannotRunWith.includes('b'));
    assert.equal(aNode.status, 'CONFLICTING');
  });

  it('marks independent packets at same level as parallel-safe', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [
        makePacket({ id: 'a', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        makePacket({ id: 'b', paths: { ownedPaths: ['src/bar.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
    };
    const graph = buildDependencyGraph({ workGraph });
    const aNode = graph.nodes.find(n => n.workPacketId === 'a')!;
    assert.ok(aNode.canRunInParallelWith.includes('b'));
    assert.equal(aNode.status, 'READY');
  });

  it('infers soft edges for read-write overlap', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [
        makePacket({ id: 'a', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        makePacket({ id: 'b', paths: { ownedPaths: ['src/bar.ts'], readOnlyPaths: ['src/foo.ts'], forbiddenPaths: [] } }),
      ],
    };
    const graph = buildDependencyGraph({ workGraph });
    const soft = graph.edges.find(e => e.strength === 'soft');
    assert.ok(soft, 'expected soft edge for read-write overlap');
  });

  it('detects dependency cycles as NEEDS_HUMAN_DECISION', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [
        makePacket({ id: 'a', dependsOn: ['b'] }),
        makePacket({ id: 'b', dependsOn: ['a'] }),
      ],
    };
    const graph = buildDependencyGraph({ workGraph });
    for (const node of graph.nodes) {
      assert.equal(node.status, 'NEEDS_HUMAN_DECISION', `${node.workPacketId} should be flagged`);
    }
  });
});
