// Phase 10 — Red Team Verifier + Taste Gate tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyBranchAdversarial,
  buildRedTeamPrompt,
  parseFindings,
} from '../../src/matrix/courts/red-team-verifier.js';
import {
  checkTasteGate,
  detectAffectedSurfaces,
  approveTasteGate,
  rejectTasteGate,
  isBlockingStatus,
} from '../../src/matrix/courts/taste-gate.js';
import type {
  AgentLease, WorkPacket, AgentRunResult, GateReport, TasteGateRequest,
} from '../../src/matrix/types/index.js';

function lease(overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'fake', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath: '/tmp',
    allowedWritePaths: [], allowedReadPaths: [], forbiddenPaths: [],
    requiredCommands: [], budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
    status: 'active',
    ...overrides,
  };
}

function packet(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: 'work.test', title: 't', objective: 'o',
    dimensionId: 'dim.test',
    paths: { ownedPaths: [], readOnlyPaths: [], forbiddenPaths: [] },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['a'], proof: { proofRequired: ['p'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'r', riskLevel: 'low', createdAt: '',
    ...overrides,
  };
}

function gate(overrides: Partial<GateReport> = {}): GateReport {
  return {
    id: 'g', leaseId: 'lease.test', workPacketId: 'work.test',
    status: 'passed', checks: [], generatedAt: '',
    ...overrides,
  };
}

function runResult(files: string[] = []): AgentRunResult {
  return {
    runId: 'r', leaseId: 'lease.test', status: 'completed',
    filesChanged: files, commandsExecuted: [],
    startedAt: '', completedAt: '',
  };
}

// ── Red Team Verifier ──────────────────────────────────────────────────────

describe('Red Team Verifier', () => {
  it('passes through when redTeamRequired=false and gate passed', async () => {
    const report = await verifyBranchAdversarial({
      lease: lease(),
      workPacket: packet({ redTeamRequired: false }),
      gateReport: gate({ status: 'passed' }),
      agentRunResult: runResult(),
    });
    assert.equal(report.status, 'passed');
    assert.equal(report.recommendation, 'allow_merge');
    assert.equal(report.findings.length, 0);
  });

  it('returns needs_human_review when no _redTeamCaller and redTeam required', async () => {
    const report = await verifyBranchAdversarial({
      lease: lease(),
      workPacket: packet({ redTeamRequired: true }),
      gateReport: gate(),
      agentRunResult: runResult(),
    });
    assert.equal(report.status, 'needs_human_review');
  });

  it('calls _redTeamCaller and parses findings into a failed report', async () => {
    const findings = [
      { category: 'fake_completion', severity: 'high', detail: 'agent returned TODO stub', affectedFiles: ['src/x.ts'] },
    ];
    const report = await verifyBranchAdversarial({
      lease: lease(),
      workPacket: packet({ redTeamRequired: true }),
      gateReport: gate(),
      agentRunResult: runResult(['src/x.ts']),
      _redTeamCaller: async () => JSON.stringify(findings),
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.recommendation, 'block_merge');
    assert.equal(report.findings.length, 1);
    assert.equal(report.riskLevel, 'high');
  });

  it('passes when LLM returns empty findings array', async () => {
    const report = await verifyBranchAdversarial({
      lease: lease(),
      workPacket: packet({ redTeamRequired: true }),
      gateReport: gate(),
      agentRunResult: runResult(),
      _redTeamCaller: async () => '[]',
    });
    assert.equal(report.status, 'passed');
    assert.equal(report.recommendation, 'allow_merge');
  });

  it('handles LLM errors gracefully', async () => {
    const report = await verifyBranchAdversarial({
      lease: lease(),
      workPacket: packet({ redTeamRequired: true }),
      gateReport: gate(),
      agentRunResult: runResult(),
      _redTeamCaller: async () => { throw new Error('rate limited'); },
    });
    assert.equal(report.status, 'needs_human_review');
    assert.ok(report.findings[0]!.detail.includes('rate limited'));
  });
});

describe('parseFindings', () => {
  it('strips markdown fences', () => {
    const findings = parseFindings('```json\n[{"category":"weak_tests","severity":"medium","detail":"x"}]\n```');
    assert.equal(findings.length, 1);
  });

  it('returns empty array for malformed input', () => {
    assert.deepEqual(parseFindings('not json'), []);
    assert.deepEqual(parseFindings('{"not": "array"}'), []);
  });
});

describe('buildRedTeamPrompt', () => {
  it('includes the work packet objective and changed files', () => {
    const prompt = buildRedTeamPrompt({
      lease: lease(),
      workPacket: packet({ objective: 'Build X' }),
      gateReport: gate(),
      agentRunResult: runResult(['src/x.ts']),
    });
    assert.ok(prompt.includes('Build X'));
    assert.ok(prompt.includes('src/x.ts'));
    assert.ok(prompt.includes('JSON'));
  });
});

// ── Taste Gate ─────────────────────────────────────────────────────────────

describe('Taste Gate', () => {
  it('not_required when no product-sensitive files changed', () => {
    const req = checkTasteGate({
      lease: lease(),
      workPacket: packet(),
      agentRunResult: runResult(['src/core/internal.ts']),
    });
    assert.equal(req.status, 'not_required');
  });

  it('requires approval for CLI command edits', () => {
    const req = checkTasteGate({
      lease: lease(),
      workPacket: packet(),
      agentRunResult: runResult(['src/cli/commands/hello.ts']),
    });
    assert.equal(req.status, 'requires_human_approval');
    assert.ok(req.affectedSurfaces.length > 0);
  });

  it('requires approval for docs/ edits', () => {
    const req = checkTasteGate({
      lease: lease(),
      workPacket: packet(),
      agentRunResult: runResult(['docs/MASTERPLAN.md']),
    });
    assert.equal(req.status, 'requires_human_approval');
  });

  it('requires approval when packet flags tasteGateRequired even without surface match', () => {
    const req = checkTasteGate({
      lease: lease(),
      workPacket: packet({ tasteGateRequired: true }),
      agentRunResult: runResult([]),
    });
    assert.equal(req.status, 'requires_human_approval');
  });
});

describe('detectAffectedSurfaces', () => {
  it('matches docs/ and CLAUDE.md', () => {
    const surfaces = detectAffectedSurfaces(['docs/x.md', 'CLAUDE.md', 'src/other.ts']);
    assert.ok(surfaces.some(s => s.includes('docs/')));
    assert.ok(surfaces.some(s => s.includes('CLAUDE.md')));
    assert.ok(!surfaces.some(s => s.includes('src/other.ts')));
  });
});

describe('Taste Gate lifecycle', () => {
  const base: TasteGateRequest = {
    id: 't.1', leaseId: 'l', workPacketId: 'w',
    status: 'requires_human_approval', reason: 'CLI change',
    affectedSurfaces: [], requestedAt: '',
  };

  it('approveTasteGate transitions to approved', () => {
    const next = approveTasteGate(base, 'human', 'OK');
    assert.equal(next.status, 'approved');
    assert.equal(next.resolvedBy, 'human');
    assert.equal(next.decisionNotes, 'OK');
  });

  it('rejectTasteGate transitions to rejected', () => {
    const next = rejectTasteGate(base, 'human', 'wording bad');
    assert.equal(next.status, 'rejected');
  });

  it('isBlockingStatus returns true for requires_human_approval/rejected/needs_revision', () => {
    assert.equal(isBlockingStatus('requires_human_approval'), true);
    assert.equal(isBlockingStatus('rejected'), true);
    assert.equal(isBlockingStatus('needs_revision'), true);
    assert.equal(isBlockingStatus('approved'), false);
    assert.equal(isBlockingStatus('not_required'), false);
  });
});
