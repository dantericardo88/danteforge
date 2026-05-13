// Phase 11 — Merge Court tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMergeCourt } from '../../src/matrix/courts/merge-court.js';
import type {
  AgentLease, WorkPacket, MergeCandidate,
  GateReport, RedTeamReport, TasteGateRequest, ConflictReport,
} from '../../src/matrix/types/index.js';

function lease(id: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id, workPacketId: `work.${id}`,
    provider: 'fake', agentRole: 'dimension-engineer',
    branch: `branch/${id}`, worktreePath: `/tmp/${id}`,
    allowedWritePaths: [`src/${id}.ts`], allowedReadPaths: [], forbiddenPaths: [],
    requiredCommands: [], budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
    status: 'active',
    ...overrides,
  };
}

function packet(id: string, overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: `work.${id}`, title: id, objective: id,
    dimensionId: `dim.${id}`,
    paths: { ownedPaths: [`src/${id}.ts`], readOnlyPaths: [], forbiddenPaths: [] },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['a'], proof: { proofRequired: ['p'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'r', riskLevel: 'low', createdAt: '',
    ...overrides,
  };
}

function candidate(id: string, overrides: Partial<MergeCandidate> = {}): MergeCandidate {
  return {
    candidateId: `c.${id}`, leaseId: id, workPacketId: `work.${id}`,
    branch: `branch/${id}`, gateReportId: `g.${id}`,
    blastRadius: 1, riskLevel: 'low',
    // Default to a non-empty diff so existing tests don't trip the new
    // no-diff rejection rule. Tests that need the zero-change path should
    // override explicitly.
    filesChanged: [`src/${id}.ts`],
    ...overrides,
  };
}

function gateReport(status: GateReport['status'] = 'passed'): GateReport {
  return { id: 'g', leaseId: '', workPacketId: '', status, checks: [], generatedAt: '' };
}

function emptyConflicts(): ConflictReport {
  return { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } };
}

describe('Merge Court', () => {
  it('approves a clean candidate', async () => {
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a'),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
      }],
      conflictReport: emptyConflicts(),
      _runMerge: async () => ({ success: true }),
    });
    assert.equal(result.approvedCount, 1);
    assert.equal(result.decisions[0]!.decision, 'APPROVED');
    assert.ok(result.decisions[0]!.timeMachineEventId);
  });

  it('rejects when gate failed', async () => {
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a'),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('failed'),
      }],
      conflictReport: emptyConflicts(),
    });
    assert.equal(result.decisions[0]!.decision, 'REJECTED');
  });

  it('blocks on red team', async () => {
    const redTeam: RedTeamReport = {
      id: 'rt', leaseId: 'a', workPacketId: 'work.a',
      status: 'failed', riskLevel: 'high', recommendation: 'block_merge',
      findings: [{ category: 'fake_completion', severity: 'high', detail: 'stub' }],
      generatedAt: '',
    };
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a'),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
        redTeamReport: redTeam,
      }],
      conflictReport: emptyConflicts(),
    });
    assert.equal(result.decisions[0]!.decision, 'BLOCKED_BY_RED_TEAM');
  });

  it('blocks on unapproved taste gate', async () => {
    const tasteGate: TasteGateRequest = {
      id: 't', leaseId: 'a', workPacketId: 'work.a',
      status: 'requires_human_approval', reason: 'CLI change',
      affectedSurfaces: [], requestedAt: '',
    };
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a'),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
        tasteGateRequest: tasteGate,
      }],
      conflictReport: emptyConflicts(),
    });
    assert.equal(result.decisions[0]!.decision, 'BLOCKED_BY_TASTE_GATE');
  });

  it('approves when taste gate is already approved', async () => {
    const tasteGate: TasteGateRequest = {
      id: 't', leaseId: 'a', workPacketId: 'work.a',
      status: 'approved', reason: 'OK', affectedSurfaces: [], requestedAt: '',
    };
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a'),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
        tasteGateRequest: tasteGate,
      }],
      conflictReport: emptyConflicts(),
      _runMerge: async () => ({ success: true }),
    });
    assert.equal(result.decisions[0]!.decision, 'APPROVED');
  });

  it('marks second overlapping candidate as SUPERSEDED', async () => {
    const result = await runMergeCourt({
      candidates: [
        {
          candidate: candidate('a', { scoreDelta: { dimensionId: 'd', before: 1, after: 5 } }),
          lease: lease('a', { allowedWritePaths: ['src/shared.ts'] }),
          workPacket: packet('a'),
          gateReport: gateReport('passed'),
        },
        {
          candidate: candidate('b', { scoreDelta: { dimensionId: 'd', before: 1, after: 3 } }),
          lease: lease('b', { allowedWritePaths: ['src/shared.ts'] }),
          workPacket: packet('b'),
          gateReport: gateReport('passed'),
        },
      ],
      conflictReport: emptyConflicts(),
      _runMerge: async () => ({ success: true }),
    });
    // a should be approved (higher score), b should be superseded
    const aDecision = result.decisions.find(d => d.candidateId === 'c.a')!;
    const bDecision = result.decisions.find(d => d.candidateId === 'c.b')!;
    assert.equal(aDecision.decision, 'APPROVED');
    assert.equal(bDecision.decision, 'SUPERSEDED_BY_BETTER_BRANCH');
  });

  it('marks NEEDS_REPAIR when merge command fails', async () => {
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a'),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
      }],
      conflictReport: emptyConflicts(),
      _runMerge: async () => ({ success: false, error: 'merge conflict in src/a.ts' }),
    });
    assert.equal(result.decisions[0]!.decision, 'NEEDS_REPAIR');
  });

  it('rejects a candidate with zero file changes (no-diff rule)', async () => {
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a', { filesChanged: [] }),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
      }],
      conflictReport: emptyConflicts(),
    });
    assert.equal(result.decisions[0]!.decision, 'REJECTED');
    assert.match(result.decisions[0]!.reason, /no substantive diff/i);
  });

  it('rejects a candidate with missing filesChanged field (defensive)', async () => {
    // candidate factory's default fills filesChanged — explicitly drop it.
    const c = candidate('a');
    delete (c as { filesChanged?: string[] }).filesChanged;
    const result = await runMergeCourt({
      candidates: [{
        candidate: c,
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
      }],
      conflictReport: emptyConflicts(),
    });
    assert.equal(result.decisions[0]!.decision, 'REJECTED');
    assert.match(result.decisions[0]!.reason, /no substantive diff/i);
  });

  it('approves a zero-change candidate when allowEmptyDiff is set (audit flow opt-in)', async () => {
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a', { filesChanged: [], allowEmptyDiff: true }),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
      }],
      conflictReport: emptyConflicts(),
      _runMerge: async () => ({ success: true }),
    });
    assert.equal(result.decisions[0]!.decision, 'APPROVED');
  });

  it('blocks on HIGH/CRITICAL conflicts touching the packet', async () => {
    const conflictReport: ConflictReport = {
      generatedAt: '',
      summary: { low: 0, medium: 0, high: 1, critical: 0 },
      conflicts: [{
        conflictId: 'c1', level: 'HIGH', type: 'file_overlap',
        detectedAt: '', description: 'overlap', recommendedAction: 'sequence_merge',
        workPacketIds: ['work.a'],
      }],
    };
    const result = await runMergeCourt({
      candidates: [{
        candidate: candidate('a'),
        lease: lease('a'),
        workPacket: packet('a'),
        gateReport: gateReport('passed'),
      }],
      conflictReport,
    });
    assert.equal(result.decisions[0]!.decision, 'BLOCKED_BY_CONFLICT');
  });
});
