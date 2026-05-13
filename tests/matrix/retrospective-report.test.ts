// Phase 12 — Retrospective + Report Generator tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generateRetrospective,
  writeRetrospective,
} from '../../src/matrix/engines/retrospective.js';
import {
  generateRunReport,
  renderFinalReport,
  writeFinalReport,
} from '../../src/matrix/engines/report-generator.js';
import type {
  AgentRunResult, GateReport, RedTeamReport, MergeDecision, ConflictReport,
} from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-retro-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeRun(id: string, leaseId: string, status: AgentRunResult['status'] = 'completed'): AgentRunResult {
  return {
    runId: id, leaseId, status,
    filesChanged: [], commandsExecuted: [],
    startedAt: '2026-05-11T00:00:00Z',
    completedAt: '2026-05-11T00:01:00Z',
  };
}

describe('generateRetrospective', () => {
  it('aggregates basic provider performance', () => {
    const retro = generateRetrospective({
      runId: 'run.1',
      startedAt: '2026-05-11T00:00:00Z',
      agentRuns: [
        fakeRun('fakerun.lease.a.1', 'lease.dim.a.fake.1'),
        fakeRun('fakerun.lease.b.1', 'lease.dim.b.fake.1', 'failed'),
      ],
      gateReports: [],
      redTeamReports: [],
      mergeDecisions: [],
      conflictReport: { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } },
    });
    const fake = retro.providerPerformance.find(p => p.provider === 'fake');
    assert.ok(fake);
    assert.equal(fake!.runsAttempted, 2);
    assert.equal(fake!.runsSucceeded, 1);
    assert.equal(fake!.runsFailed, 1);
  });

  it('computes gate effectiveness from gate reports', () => {
    const gateReports: GateReport[] = [{
      id: 'g1', leaseId: 'l', workPacketId: 'w', status: 'failed',
      checks: [
        { name: 'forbidden_paths', status: 'failed', details: 'edit detected' },
        { name: 'no_stub_scan', status: 'passed' },
      ],
      generatedAt: '',
    }];
    const retro = generateRetrospective({
      runId: 'r', startedAt: '',
      agentRuns: [], gateReports, redTeamReports: [], mergeDecisions: [],
      conflictReport: { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } },
    });
    const forbiddenGate = retro.gateEffectiveness.find(g => g.gateName === 'forbidden_paths');
    assert.equal(forbiddenGate!.triggered, 1);
    assert.equal(forbiddenGate!.caughtIssues, 1);
  });

  it('emits recommendations when conflicts repeat', () => {
    const conflictReport: ConflictReport = {
      generatedAt: '',
      summary: { low: 0, medium: 0, high: 0, critical: 2 },
      conflicts: [
        { conflictId: 'c1', level: 'CRITICAL', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'sequence_merge', affectedPaths: ['src/x.ts'] },
        { conflictId: 'c2', level: 'CRITICAL', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'sequence_merge', affectedPaths: ['src/x.ts'] },
      ],
    };
    const retro = generateRetrospective({
      runId: 'r', startedAt: '',
      agentRuns: [], gateReports: [], redTeamReports: [], mergeDecisions: [],
      conflictReport,
    });
    assert.ok(retro.recommendedNextRunChanges.length > 0);
    assert.ok(retro.recommendedNextRunChanges.some(s => s.includes('conflict')));
  });

  it('identifies high-risk files by conflict frequency', () => {
    const conflictReport: ConflictReport = {
      generatedAt: '',
      summary: { low: 0, medium: 0, high: 0, critical: 2 },
      conflicts: [
        { conflictId: 'c1', level: 'CRITICAL', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'sequence_merge', affectedPaths: ['src/x.ts', 'src/y.ts'] },
        { conflictId: 'c2', level: 'HIGH', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'sequence_merge', affectedPaths: ['src/x.ts'] },
      ],
    };
    const retro = generateRetrospective({
      runId: 'r', startedAt: '',
      agentRuns: [], gateReports: [], redTeamReports: [], mergeDecisions: [],
      conflictReport,
    });
    assert.equal(retro.highRiskFiles[0], 'src/x.ts', 'most-mentioned should be first');
  });
});

describe('writeRetrospective', () => {
  it('persists retrospective to canonical path', async () => {
    const cwd = await tmp();
    const retro = generateRetrospective({
      runId: 'r', startedAt: '',
      agentRuns: [], gateReports: [], redTeamReports: [], mergeDecisions: [],
      conflictReport: { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } },
    });
    const outPath = await writeRetrospective(retro, cwd);
    assert.ok(outPath.endsWith('matrix.retrospective.json'));
    await fs.access(outPath);
  });
});

describe('generateRunReport + renderFinalReport', () => {
  function fakeMergeDecisions(approved: number, rejected: number): MergeDecision[] {
    const decisions: MergeDecision[] = [];
    for (let i = 0; i < approved; i++) decisions.push({
      id: `m.${i}`, candidateId: `c.${i}`, leaseId: `l.${i}`, branch: `b.${i}`,
      decision: 'APPROVED', reason: 'ok', createdAt: '',
    });
    for (let i = 0; i < rejected; i++) decisions.push({
      id: `m.r.${i}`, candidateId: `c.r.${i}`, leaseId: `l.r.${i}`, branch: `b.r.${i}`,
      decision: 'REJECTED', reason: 'gate failed', createdAt: '',
    });
    return decisions;
  }

  it('counts merged + rejected from decisions', () => {
    const retro = generateRetrospective({
      runId: 'r', startedAt: '',
      agentRuns: [], gateReports: [], redTeamReports: [], mergeDecisions: [],
      conflictReport: { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } },
    });
    const report = generateRunReport({
      runId: 'r', startedAt: '', completedAt: '',
      startingScore: 5.0, endingScore: 6.5, dimensionsImproved: ['dim.x'],
      workPacketsCreated: 3, agentsRan: 3,
      conflictsPredicted: 1, conflictsHappened: 0,
      mergeDecisions: fakeMergeDecisions(1, 2),
      gateReports: [], redTeamReports: [],
      retrospective: retro,
    });
    assert.equal(report.branchesMerged, 1);
    assert.equal(report.branchesRejected, 2);
    assert.equal(report.startingScore, 5.0);
    assert.equal(report.endingScore, 6.5);
  });

  it('renders a markdown report with all sections', () => {
    const retro = generateRetrospective({
      runId: 'r', startedAt: '',
      agentRuns: [], gateReports: [], redTeamReports: [], mergeDecisions: [],
      conflictReport: { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } },
    });
    const report = generateRunReport({
      runId: 'r.1', startedAt: '2026-05-11', completedAt: '2026-05-11',
      startingScore: 5.0, endingScore: 7.0, dimensionsImproved: ['dim.a'],
      workPacketsCreated: 2, agentsRan: 2,
      conflictsPredicted: 0, conflictsHappened: 0,
      mergeDecisions: fakeMergeDecisions(1, 0),
      gateReports: [], redTeamReports: [],
      retrospective: retro,
    });
    const md = renderFinalReport(report, retro);
    assert.ok(md.includes('# Matrix Run Report'));
    assert.ok(md.includes('Score Delta'));
    assert.ok(md.includes('5.00'));
    assert.ok(md.includes('7.00'));
    assert.ok(md.includes('Recommendations for Next Run'));
  });

  it('writeFinalReport writes to canonical path', async () => {
    const cwd = await tmp();
    const retro = generateRetrospective({
      runId: 'r', startedAt: '',
      agentRuns: [], gateReports: [], redTeamReports: [], mergeDecisions: [],
      conflictReport: { generatedAt: '', conflicts: [], summary: { low: 0, medium: 0, high: 0, critical: 0 } },
    });
    const report = generateRunReport({
      runId: 'r', startedAt: '', completedAt: '',
      startingScore: 5, endingScore: 6, dimensionsImproved: [],
      workPacketsCreated: 0, agentsRan: 0,
      conflictsPredicted: 0, conflictsHappened: 0,
      mergeDecisions: [], gateReports: [], redTeamReports: [],
      retrospective: retro,
    });
    const outPath = await writeFinalReport(report, retro, cwd);
    assert.ok(outPath.endsWith('matrix.final-report.md'));
    const content = await fs.readFile(outPath, 'utf8');
    assert.ok(content.includes('Matrix Run Report'));
  });
});
