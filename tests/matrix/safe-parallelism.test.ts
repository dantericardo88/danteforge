// Phase 7 — Safe Parallelism + Simulation tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSafeParallelism, selectWaveMembers } from '../../src/matrix/engines/safe-parallelism.js';
import { simulate } from '../../src/matrix/engines/simulation.js';
import type {
  WorkGraph, WorkPacket, DependencyGraph, ConflictReport,
  ProjectGraph, DimensionGraph,
} from '../../src/matrix/types/index.js';

function packet(id: string, overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id, title: id, objective: id,
    dimensionId: `dim.${id}`,
    paths: { ownedPaths: [`src/${id}.ts`], readOnlyPaths: [], forbiddenPaths: [] },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['a'],
    proof: { proofRequired: ['p'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'r', riskLevel: 'low', createdAt: '',
    estimatedLoc: 100, estimatedMinutes: 20,
    ...overrides,
  };
}

function emptyConflicts(): ConflictReport {
  return { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } };
}

function emptyProject(): ProjectGraph {
  return {
    project: {
      projectId: 'x', rootPath: '/tmp', detectedAt: '',
      buildCommands: [], verifyCommands: [],
      protectedPaths: [], ownershipPath: '', evidenceDir: '',
    },
    nodes: [], generatedAt: '',
  };
}

function emptyDimensions(): DimensionGraph {
  return { generatedAt: '', nodes: [], competitors: [] };
}

// ── Safe Parallelism ─────────────────────────────────────────────────────────

describe('calculateSafeParallelism', () => {
  it('caps safeAgentsNow at requestedAgents when fewer packets exist', () => {
    const workGraph: WorkGraph = { generatedAt: '', packets: [packet('a'), packet('b')] };
    const depGraph: DependencyGraph = {
      generatedAt: '',
      edges: [],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: ['b'], cannotRunWith: [], mergeAfter: [] },
        { workPacketId: 'b', status: 'READY', blockedBy: [], canRunInParallelWith: ['a'], cannotRunWith: [], mergeAfter: [] },
      ],
    };
    const r = calculateSafeParallelism({
      workGraph, dependencyGraph: depGraph, conflictReport: emptyConflicts(), requestedAgents: 50,
    });
    assert.equal(r.requestedAgents, 50);
    assert.equal(r.safeAgentsNow, 2);
    assert.equal(r.recommendedWaveSize, 2);
  });

  it('subtracts conflict-blocked packets from runnable count', () => {
    const workGraph: WorkGraph = { generatedAt: '', packets: [packet('a'), packet('b')] };
    const depGraph: DependencyGraph = {
      generatedAt: '',
      edges: [],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] },
        { workPacketId: 'b', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] },
      ],
    };
    const conflictReport: ConflictReport = {
      generatedAt: '',
      conflicts: [{
        conflictId: 'c1', level: 'CRITICAL', type: 'protected_path_violation',
        detectedAt: '', description: 'frozen', recommendedAction: 'block_immediately',
        workPacketIds: ['a'],
      }],
      summary: { low: 0, medium: 0, high: 0, critical: 1 },
    };
    const r = calculateSafeParallelism({
      workGraph, dependencyGraph: depGraph, conflictReport, requestedAgents: 10,
    });
    assert.equal(r.safeAgentsNow, 1, 'only b should be runnable');
    assert.equal(r.highConflictPackets, 1);
  });

  it('multi-packet conflicts do NOT block all participants (sequencing constraint only)', () => {
    // Regression: a file_overlap conflict between two packets used to mark
    // both as blocked, leaving safeAgentsNow = 0. Now both stay runnable.
    const workGraph: WorkGraph = { generatedAt: '', packets: [packet('a'), packet('b')] };
    const depGraph: DependencyGraph = {
      generatedAt: '',
      edges: [],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: ['b'], mergeAfter: [] },
        { workPacketId: 'b', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: ['a'], mergeAfter: [] },
      ],
    };
    const conflictReport: ConflictReport = {
      generatedAt: '',
      conflicts: [{
        conflictId: 'c1', level: 'HIGH', type: 'file_overlap',
        detectedAt: '', description: 'both touch src/foo.ts', recommendedAction: 'sequence_merge',
        workPacketIds: ['a', 'b'],
      }],
      summary: { low: 0, medium: 0, high: 1, critical: 0 },
    };
    const r = calculateSafeParallelism({
      workGraph, dependencyGraph: depGraph, conflictReport, requestedAgents: 5,
    });
    assert.equal(r.safeAgentsNow, 2, 'both packets remain runnable; conflict is a sequencing constraint, not a blocker');
    assert.equal(r.highConflictPackets, 0, 'no hard blocks');
    assert.ok(r.reasoning.some(s => s.includes('sequenced across waves')), 'reasoning calls out the sequencing constraint');
  });

  it('protected_path_violation on a single packet IS a hard block', () => {
    const workGraph: WorkGraph = { generatedAt: '', packets: [packet('a'), packet('b')] };
    const depGraph: DependencyGraph = {
      generatedAt: '',
      edges: [],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] },
        { workPacketId: 'b', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] },
      ],
    };
    const conflictReport: ConflictReport = {
      generatedAt: '',
      conflicts: [{
        conflictId: 'c1', level: 'CRITICAL', type: 'protected_path_violation',
        detectedAt: '', description: 'a touches a frozen path', recommendedAction: 'block_immediately',
        workPacketIds: ['a'],
      }],
      summary: { low: 0, medium: 0, high: 0, critical: 1 },
    };
    const r = calculateSafeParallelism({
      workGraph, dependencyGraph: depGraph, conflictReport, requestedAgents: 5,
    });
    assert.equal(r.safeAgentsNow, 1, 'only b is runnable');
    assert.equal(r.highConflictPackets, 1);
  });

  it('reports blocked packets in reasoning', () => {
    const workGraph: WorkGraph = { generatedAt: '', packets: [packet('a'), packet('b')] };
    const depGraph: DependencyGraph = {
      generatedAt: '',
      edges: [{ fromPacketId: 'a', toPacketId: 'b', strength: 'hard', reason: 'depends' }],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] },
        { workPacketId: 'b', status: 'BLOCKED_BY_DEPENDENCY', blockedBy: ['a'], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: ['a'] },
      ],
    };
    const r = calculateSafeParallelism({
      workGraph, dependencyGraph: depGraph, conflictReport: emptyConflicts(), requestedAgents: 5,
    });
    assert.equal(r.blockedWorkPackets, 1);
    assert.ok(r.reasoning.some(s => s.includes('blocked by dependencies')));
  });
});

describe('selectWaveMembers', () => {
  it('selects only READY non-conflicting packets', () => {
    const depGraph: DependencyGraph = {
      generatedAt: '', edges: [],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] },
        { workPacketId: 'b', status: 'BLOCKED_BY_DEPENDENCY', blockedBy: ['a'], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: ['a'] },
      ],
    };
    const wave = selectWaveMembers(depGraph, emptyConflicts(), 5);
    assert.deepEqual(wave, ['a']);
  });
});

// ── Simulation ───────────────────────────────────────────────────────────────

describe('simulate', () => {
  it('returns a plan with waves and totals', () => {
    const workGraph: WorkGraph = { generatedAt: '', packets: [packet('a'), packet('b')] };
    const depGraph: DependencyGraph = {
      generatedAt: '', edges: [],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: ['b'], cannotRunWith: [], mergeAfter: [] },
        { workPacketId: 'b', status: 'READY', blockedBy: [], canRunInParallelWith: ['a'], cannotRunWith: [], mergeAfter: [] },
      ],
    };
    const plan = simulate({
      projectGraph: emptyProject(),
      dimensionGraph: emptyDimensions(),
      workGraph, dependencyGraph: depGraph,
      conflictReport: emptyConflicts(),
      requestedAgents: 5,
    });
    assert.ok(plan.waves.length >= 1);
    assert.ok(plan.totalEstimatedTokens > 0);
    assert.ok(plan.totalEstimatedUsdLow >= 0);
    assert.equal(plan.safeParallelism.requestedAgents, 5);
  });

  it('plans multiple waves when packets are dependent', () => {
    const workGraph: WorkGraph = { generatedAt: '', packets: [packet('a'), packet('b', { dependsOn: ['a'] })] };
    const depGraph: DependencyGraph = {
      generatedAt: '',
      edges: [{ fromPacketId: 'a', toPacketId: 'b', strength: 'hard', reason: 'depends' }],
      nodes: [
        { workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] },
        { workPacketId: 'b', status: 'BLOCKED_BY_DEPENDENCY', blockedBy: ['a'], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: ['a'] },
      ],
    };
    const plan = simulate({
      projectGraph: emptyProject(),
      dimensionGraph: emptyDimensions(),
      workGraph, dependencyGraph: depGraph,
      conflictReport: emptyConflicts(),
      requestedAgents: 5,
    });
    assert.ok(plan.waves.length >= 2, `expected ≥2 waves, got ${plan.waves.length}`);
  });

  it('includes risk summary with required approvals count', () => {
    const workGraph: WorkGraph = {
      generatedAt: '',
      packets: [packet('a', { tasteGateRequired: true })],
    };
    const depGraph: DependencyGraph = {
      generatedAt: '', edges: [],
      nodes: [{ workPacketId: 'a', status: 'READY', blockedBy: [], canRunInParallelWith: [], cannotRunWith: [], mergeAfter: [] }],
    };
    const plan = simulate({
      projectGraph: emptyProject(),
      dimensionGraph: emptyDimensions(),
      workGraph, dependencyGraph: depGraph,
      conflictReport: emptyConflicts(),
      requestedAgents: 5,
    });
    assert.equal(plan.riskSummary.requiredHumanApprovals, 1);
  });
});
