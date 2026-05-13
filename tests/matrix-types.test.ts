// Matrix Kernel — Phase 1 contract tests
// Validates: serialization round-trips, predicate validators, constitution rules.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  // project-graph
  isMatrixProject, isProjectGraphNode, isProjectGraph,
  // dimension-graph
  isCompetitor, isDimensionContract, isDimensionGraph, violatesClosedSourceRule,
  // work-graph
  isWorkPacket, isWorkGraph, hasMandatoryFields,
  // dependency-graph
  isDependencyStatus, isDependencyEdge, isDependencyNode, isDependencyGraph,
  // ownership
  isOwnershipClaim, isOwnershipMap,
  // lease
  isAgentLease, isLeaseGraph, isLeaseStatus, isActiveLease,
  // conflict
  isConflictLevel, isConflictType, isConflictRecord, isBlocking,
  // agent
  isAgentRunStatus, isAgentRunResult, isMailboxMessage,
  // simulation
  isSimulationWave, isSafeParallelismResult, isSimulationPlan,
  // gate
  isGateReport, isRedTeamReport, isTasteGateRequest,
  // merge
  isMergeOutcome, isMergeCandidate, isMergeDecision, isApproved,
  // evidence
  isEvidenceLink, isEvidenceGraph, hasScoreEvidence,
  // retrospective
  isMatrixRetrospective, isMatrixRunReport,
  // index
  MATRIX_REPORT_PATHS,
} from '../src/matrix/types/index.js';

import type {
  MatrixProject, ProjectGraphNode, Competitor, DimensionContract,
  WorkPacket, DependencyNode, AgentLease, ConflictRecord, AgentMailboxMessage,
  SimulationPlan, GateReport, RedTeamReport, TasteGateRequest,
  MergeDecision, EvidenceLink, MatrixRetrospective, MatrixRunReport,
  OwnershipMap,
} from '../src/matrix/types/index.js';

// ── Round-trip helper ──────────────────────────────────────────────────────

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Project Graph ──────────────────────────────────────────────────────────

describe('project-graph types', () => {
  it('isMatrixProject validates a real project', () => {
    const p: MatrixProject = {
      projectId: 'danteforge',
      rootPath: '/c/Projects/DanteForge',
      detectedAt: '2026-05-11',
      buildCommands: ['npm run build'],
      verifyCommands: ['npm run typecheck', 'npm test'],
      protectedPaths: ['src/core/autoforge-loop.ts'],
      ownershipPath: '.danteforge/agent-ownership.json',
      evidenceDir: '.danteforge/evidence',
    };
    assert.equal(isMatrixProject(p), true);
    assert.equal(isMatrixProject(roundTrip(p)), true);
  });

  it('isMatrixProject rejects malformed input', () => {
    assert.equal(isMatrixProject(null), false);
    assert.equal(isMatrixProject({ projectId: 'x' }), false);  // missing fields
    assert.equal(isMatrixProject({ projectId: 1 }), false);    // wrong type
  });

  it('isProjectGraphNode validates a node', () => {
    const n: ProjectGraphNode = {
      nodeId: 'module.matrix.leases',
      type: 'module',
      paths: ['src/matrix/leases/**'],
    };
    assert.equal(isProjectGraphNode(n), true);
    assert.equal(isProjectGraphNode(roundTrip(n)), true);
  });

  it('isProjectGraph validates a full graph', () => {
    assert.equal(isProjectGraph({
      project: {
        projectId: 'x', rootPath: '/x', detectedAt: '',
        buildCommands: [], verifyCommands: [],
        protectedPaths: [], ownershipPath: '', evidenceDir: '',
      },
      nodes: [{ nodeId: 'n1', type: 'module', paths: [] }],
      generatedAt: '',
    }), true);
  });
});

// ── Dimension Graph ─────────────────────────────────────────────────────────

describe('dimension-graph types', () => {
  it('isCompetitor validates an OSS competitor', () => {
    const c: Competitor = {
      id: 'competitor.aider',
      name: 'Aider',
      category: 'oss',
      inspectionMode: 'source_available',
      repoUrl: 'https://github.com/Aider-AI/aider',
      license: 'Apache-2.0',
      confidence: 0.95,
      provenance: [{ type: 'repo', capturedAt: '2026-05-11' }],
    };
    assert.equal(isCompetitor(c), true);
    assert.equal(isCompetitor(roundTrip(c)), true);
  });

  it('violatesClosedSourceRule catches source-inspection claim on closed competitor', () => {
    const bad: Competitor = {
      id: 'x', name: 'Cursor', category: 'closed_source',
      inspectionMode: 'source_available',  // forbidden!
      confidence: 0.7, provenance: [],
    };
    assert.equal(violatesClosedSourceRule(bad), true);
  });

  it('violatesClosedSourceRule allows observational mode on closed source', () => {
    const ok: Competitor = {
      id: 'x', name: 'Cursor', category: 'closed_source',
      inspectionMode: 'observational',
      confidence: 0.7, provenance: [],
    };
    assert.equal(violatesClosedSourceRule(ok), false);
  });

  it('isDimensionContract validates a dimension', () => {
    const d: DimensionContract = {
      dimensionId: 'dimension.safe-parallelism',
      name: 'Safe Parallelism',
      targetScore: 9,
      currentScore: 3.5,
      touches: ['module.matrix.scheduler'],
      dependsOnDimensions: [],
      evidenceRequired: ['simulation calculates safe agent count'],
    };
    assert.equal(isDimensionContract(d), true);
    assert.equal(isDimensionContract(roundTrip(d)), true);
  });
});

// ── Work Graph ─────────────────────────────────────────────────────────────

describe('work-graph types', () => {
  const validPacket: WorkPacket = {
    id: 'work.conflict-radar.001',
    title: 'Implement static conflict detection',
    objective: 'Detect overlapping write paths.',
    dimensionId: 'dimension.conflict-radar',
    paths: {
      ownedPaths: ['src/matrix/conflicts/**'],
      readOnlyPaths: [],
      forbiddenPaths: ['src/time-machine/**'],
    },
    dependsOn: [],
    mayConflictWith: [],
    acceptanceCriteria: ['Detect overlapping write paths'],
    proof: { proofRequired: ['unit tests pass'] },
    tasteGateRequired: false,
    redTeamRequired: true,
    rollbackPlan: 'Remove worktree',
    riskLevel: 'high',
    createdAt: '2026-05-11',
  };

  it('isWorkPacket validates a real packet', () => {
    assert.equal(isWorkPacket(validPacket), true);
    assert.equal(isWorkPacket(roundTrip(validPacket)), true);
  });

  it('hasMandatoryFields enforces acceptance/proof/rollback', () => {
    assert.equal(hasMandatoryFields(validPacket), true);
    const empty = { ...validPacket, acceptanceCriteria: [] };
    assert.equal(hasMandatoryFields(empty), false);
  });

  it('isWorkPacket rejects missing forbidden paths', () => {
    const bad = { ...validPacket, paths: { ownedPaths: [], readOnlyPaths: [] } };
    assert.equal(isWorkPacket(bad), false);
  });
});

// ── Dependency Graph ───────────────────────────────────────────────────────

describe('dependency-graph types', () => {
  it('isDependencyStatus accepts known statuses', () => {
    assert.equal(isDependencyStatus('READY'), true);
    assert.equal(isDependencyStatus('BLOCKED_BY_DEPENDENCY'), true);
    assert.equal(isDependencyStatus('UNKNOWN'), false);
  });

  it('isDependencyEdge validates an edge', () => {
    assert.equal(isDependencyEdge({
      fromPacketId: 'a', toPacketId: 'b', strength: 'hard', reason: 'contract',
    }), true);
  });

  it('isDependencyNode validates a node', () => {
    const n: DependencyNode = {
      workPacketId: 'work.codex-adapter.001',
      status: 'BLOCKED_BY_DEPENDENCY',
      blockedBy: ['work.agent-adapter-interface.001'],
      canRunInParallelWith: ['work.claude-adapter.001'],
      cannotRunWith: ['work.provider-contract-refactor.001'],
      mergeAfter: ['work.agent-adapter-interface.001'],
    };
    assert.equal(isDependencyNode(n), true);
    assert.equal(isDependencyNode(roundTrip(n)), true);
  });
});

// ── Ownership ──────────────────────────────────────────────────────────────

describe('ownership types', () => {
  it('isOwnershipMap validates a real map', () => {
    const m: OwnershipMap = {
      version: 1,
      generatedAt: '2026-05-11',
      globalAllowed: ['.danteforge/agent-claims/.gitkeep'],
      workstreams: {
        'platform-kernel': {
          workstream: 'platform-kernel',
          ownedPaths: ['.danteforge/agent-guard.json'],
        },
      },
      frozenFiles: ['src/cli/index.ts'],
    };
    assert.equal(isOwnershipMap(m), true);
    assert.equal(isOwnershipMap(roundTrip(m)), true);
  });

  it('isOwnershipClaim rejects missing workstream', () => {
    assert.equal(isOwnershipClaim({ ownedPaths: [] }), false);
  });
});

// ── Lease ──────────────────────────────────────────────────────────────────

describe('lease types', () => {
  const validLease: AgentLease = {
    id: 'lease.conflict-radar.codex.001',
    workPacketId: 'work.conflict-radar.001',
    provider: 'codex',
    agentRole: 'dimension-engineer',
    branch: 'matrix/conflict-radar/codex-001',
    worktreePath: '.danteforge/worktrees/x',
    allowedWritePaths: ['src/matrix/conflicts/**'],
    allowedReadPaths: ['src/**'],
    forbiddenPaths: ['src/time-machine/**'],
    requiredCommands: ['npm test'],
    budget: { maxTokens: 200000, maxRuntimeMinutes: 90, maxIterations: 3 },
    status: 'pending',
  };

  it('isAgentLease validates a real lease', () => {
    assert.equal(isAgentLease(validLease), true);
    assert.equal(isAgentLease(roundTrip(validLease)), true);
  });

  it('isLeaseStatus enforces enum', () => {
    assert.equal(isLeaseStatus('pending'), true);
    assert.equal(isLeaseStatus('xyz'), false);
  });

  it('isActiveLease returns true for active/issued', () => {
    assert.equal(isActiveLease({ ...validLease, status: 'active' }), true);
    assert.equal(isActiveLease({ ...validLease, status: 'completed' }), false);
  });
});

// ── Conflict ───────────────────────────────────────────────────────────────

describe('conflict types', () => {
  it('isConflictLevel accepts known levels', () => {
    assert.equal(isConflictLevel('HIGH'), true);
    assert.equal(isConflictLevel('UNKNOWN'), false);
  });

  it('isConflictType accepts known types', () => {
    assert.equal(isConflictType('file_overlap'), true);
    assert.equal(isConflictType('unknown_type'), false);
  });

  it('isBlocking detects HIGH/CRITICAL', () => {
    const high: ConflictRecord = {
      conflictId: 'x', level: 'HIGH', type: 'file_overlap',
      detectedAt: '', description: '', recommendedAction: 'block_immediately',
    };
    assert.equal(isBlocking(high), true);
    assert.equal(isBlocking({ ...high, level: 'LOW' }), false);
  });
});

// ── Agent ──────────────────────────────────────────────────────────────────

describe('agent types', () => {
  it('isAgentRunStatus accepts known statuses', () => {
    assert.equal(isAgentRunStatus('running'), true);
    assert.equal(isAgentRunStatus('unknown'), false);
  });

  it('isAgentRunResult validates a result', () => {
    assert.equal(isAgentRunResult({
      runId: 'r1', leaseId: 'l1', status: 'completed',
      filesChanged: ['src/x.ts'], commandsExecuted: [],
      startedAt: '', completedAt: '',
    }), true);
  });

  it('isMailboxMessage validates a message', () => {
    const m: AgentMailboxMessage = {
      messageId: 'msg.x',
      type: 'interface_changed',
      fromLease: 'lease.a', toLease: 'lease.b',
      summary: 'API renamed',
      requiresAck: true,
      status: 'pending_ack',
      createdAt: '',
    };
    assert.equal(isMailboxMessage(m), true);
  });
});

// ── Simulation ─────────────────────────────────────────────────────────────

describe('simulation types', () => {
  it('isSafeParallelismResult validates', () => {
    assert.equal(isSafeParallelismResult({
      requestedAgents: 50, safeAgentsNow: 11, recommendedWaveSize: 8,
      blockedWorkPackets: 18, highConflictPackets: 7, sequentialOnlyPackets: 14,
      reasoning: ['Provider contracts must land before adapters.'],
    }), true);
  });

  it('isSimulationPlan rejects missing waves', () => {
    assert.equal(isSimulationPlan({ waves: 'not-array' }), false);
  });
});

// ── Gates ──────────────────────────────────────────────────────────────────

describe('gate types', () => {
  it('isGateReport validates a passing report', () => {
    const r: GateReport = {
      id: 'gate.x', leaseId: 'l', workPacketId: 'w', status: 'passed',
      checks: [{ name: 'unit_tests', status: 'passed' }],
      generatedAt: '',
    };
    assert.equal(isGateReport(r), true);
  });

  it('isRedTeamReport validates', () => {
    const r: RedTeamReport = {
      id: 'rt.x', leaseId: 'l', workPacketId: 'w',
      status: 'passed', riskLevel: 'medium',
      recommendation: 'allow_merge', findings: [],
      generatedAt: '',
    };
    assert.equal(isRedTeamReport(r), true);
  });

  it('isTasteGateRequest validates', () => {
    const t: TasteGateRequest = {
      id: 'tg.x', leaseId: 'l', workPacketId: 'w',
      status: 'requires_human_approval',
      reason: 'CLI wording change',
      affectedSurfaces: ['src/cli/commands/matrix.ts'],
      requestedAt: '',
    };
    assert.equal(isTasteGateRequest(t), true);
  });
});

// ── Merge ──────────────────────────────────────────────────────────────────

describe('merge types', () => {
  it('isMergeOutcome enforces enum', () => {
    assert.equal(isMergeOutcome('APPROVED'), true);
    assert.equal(isMergeOutcome('FOO'), false);
  });

  it('isApproved detects APPROVED decisions', () => {
    const m: MergeDecision = {
      id: 'm.x', candidateId: 'c', leaseId: 'l',
      branch: 'b', decision: 'APPROVED', reason: 'all gates passed',
      createdAt: '',
    };
    assert.equal(isApproved(m), true);
    assert.equal(isApproved({ ...m, decision: 'REJECTED' }), false);
  });
});

// ── Evidence ───────────────────────────────────────────────────────────────

describe('evidence types', () => {
  it('isEvidenceLink validates', () => {
    const e: EvidenceLink = {
      evidenceId: 'ev.x', workPacketId: 'w', leaseId: 'l', agentRunId: 'r',
      createdAt: '',
    };
    assert.equal(isEvidenceLink(e), true);
  });

  it('hasScoreEvidence requires both scoreDelta and gateReportId', () => {
    const e: EvidenceLink = {
      evidenceId: 'ev.x', workPacketId: 'w', leaseId: 'l', agentRunId: 'r',
      gateReportId: 'g', scoreDelta: { dimensionId: 'd', before: 1, after: 2 },
      createdAt: '',
    };
    assert.equal(hasScoreEvidence(e), true);
    assert.equal(hasScoreEvidence({ ...e, gateReportId: undefined }), false);
    assert.equal(hasScoreEvidence({ ...e, scoreDelta: undefined }), false);
  });
});

// ── Retrospective ──────────────────────────────────────────────────────────

describe('retrospective types', () => {
  it('isMatrixRetrospective validates', () => {
    const r: MatrixRetrospective = {
      runId: 'run.1', generatedAt: '', startedAt: '', completedAt: '',
      bestPerformingProvider: 'codex',
      highestConflictArea: 'src/matrix/leases/**',
      mostReliableGate: 'forbidden-path-check',
      weakestGate: 'semantic-conflict-detection',
      mergeBottleneck: 'contract changes late',
      providerPerformance: [],
      conflictPatterns: [],
      gateEffectiveness: [],
      highRiskFiles: [],
      recommendedNextRunChanges: [],
    };
    assert.equal(isMatrixRetrospective(r), true);
  });

  it('isMatrixRunReport validates', () => {
    const r: MatrixRunReport = {
      runId: 'run.1', startedAt: '', completedAt: '',
      startingScore: 5, endingScore: 7, dimensionsImproved: [],
      workPacketsCreated: 0, agentsRan: 0, conflictsPredicted: 0,
      conflictsHappened: 0, branchesRejected: 0, branchesMerged: 0,
      branchesRolledBack: 0, reportPaths: {},
      proofExists: false, nextSteps: [],
    };
    assert.equal(isMatrixRunReport(r), true);
  });
});

// ── Index ──────────────────────────────────────────────────────────────────

describe('index re-exports', () => {
  it('MATRIX_REPORT_PATHS lists all 18 canonical reports', () => {
    const keys = Object.keys(MATRIX_REPORT_PATHS);
    assert.ok(keys.length >= 18, `expected >= 18 reports, got ${keys.length}`);
    assert.ok(keys.includes('projectGraph'));
    assert.ok(keys.includes('finalReport'));
  });
});
