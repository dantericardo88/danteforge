// Final report generator tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateFinalReport } from '../../src/matrix-orchestration/reporting/final-report.js';
import type {
  OrchestrationDimensionMatrix,
  PhaseExecutionResult,
  RunState,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
async function tmpCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'final-report-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

function makeRunState(cwd: string): RunState {
  return {
    runId: 'orch.test',
    startedAt: '2026-05-12T00:00:00Z',
    updatedAt: '2026-05-12T01:00:00Z',
    prdPath: path.join(cwd, 'PRD.md'),
    target: 'closed_source_frontier',
    stage: 'generating_final_report',
    completedStages: [],
    costSpentUsd: 12.5,
    overrides: {},
  };
}

function makeMatrix(): OrchestrationDimensionMatrix {
  return {
    generatedAt: '', projectName: 'fixture',
    overallCurrentScore: 5, overallOssFrontierScore: 8, overallClosedFrontierScore: 9,
    approvedByUser: true,
    dimensions: [{
      dimensionId: 'a', name: 'A', category: 'core', weight: 1,
      rubric: { score5: '', score7: '', score9: '' }, evidenceRequired: [],
      currentScore: 5, ossFrontierScore: 8, closedFrontierScore: 9,
      gapToOssFrontier: 3, gapToClosedFrontier: 4,
    }],
  };
}

function makePhaseResult(phase: 'phase_a_oss_frontier' | 'phase_b_closed_source_frontier'): PhaseExecutionResult {
  return {
    phase,
    config: {
      phase, workPacketIds: ['w.a'], maxCostUsd: 100,
      maxWallClockMinutes: 60, maxConcurrentAgents: 2,
      allowedProviders: ['claude'], redTeamEveryMerge: false, tasteGateMinScore: 7,
    },
    attempts: [{
      workPacketId: 'w.a', providerId: 'claude', outcome: 'merged',
      scoreDeltaByDimension: { a: 2 }, tokensConsumed: 1000,
      costUsd: 5, wallClockMs: 60000, startedAt: '', completedAt: '',
    }],
    dimensionsClosed: ['a'], dimensionsOpen: [],
    totalCostUsd: 5, totalWallClockMs: 60000,
    startedAt: '', completedAt: '', terminationReason: 'completed',
  };
}

describe('final-report', () => {
  it('writes both markdown and JSON paths', async () => {
    const cwd = await tmpCwd();
    const result = await generateFinalReport(
      { runState: makeRunState(cwd), matrix: makeMatrix(), phaseAResult: makePhaseResult('phase_a_oss_frontier') },
      { cwd, writeNotices: false },
    );
    assert.ok(result.markdownPath.endsWith('.md'));
    assert.ok(result.jsonPath.endsWith('.json'));
    const md = await fs.readFile(result.markdownPath, 'utf8');
    assert.match(md, /Matrix Orchestration/);
  });

  it('summary aggregates costs from both phases', async () => {
    const cwd = await tmpCwd();
    const result = await generateFinalReport(
      {
        runState: makeRunState(cwd),
        matrix: makeMatrix(),
        phaseAResult: makePhaseResult('phase_a_oss_frontier'),
        phaseBResult: makePhaseResult('phase_b_closed_source_frontier'),
      },
      { cwd, writeNotices: false },
    );
    assert.equal(result.summary.totalCostUsd, 10);
    assert.equal(result.summary.totalAgentsDeployed, 2);
  });

  it('headline numbers show end > start when attempts merge', async () => {
    const cwd = await tmpCwd();
    const result = await generateFinalReport(
      {
        runState: makeRunState(cwd),
        matrix: makeMatrix(),
        phaseAResult: makePhaseResult('phase_a_oss_frontier'),
      },
      { cwd, writeNotices: false },
    );
    assert.ok(result.summary.endingOverallScore > result.summary.startingOverallScore);
  });

  it('skips THIRD_PARTY_NOTICES when writeNotices is false', async () => {
    const cwd = await tmpCwd();
    const result = await generateFinalReport(
      { runState: makeRunState(cwd), matrix: makeMatrix() },
      { cwd, writeNotices: false },
    );
    assert.equal(result.noticesPath, undefined);
  });

  it('emits no-phase recommendations when phases are absent', async () => {
    const cwd = await tmpCwd();
    const result = await generateFinalReport(
      { runState: makeRunState(cwd), matrix: makeMatrix() },
      { cwd, writeNotices: false },
    );
    assert.ok(result.summary.recommendedNextIterations.length > 0);
  });

  it('dimension table marks dims closed by Phase A correctly', async () => {
    const cwd = await tmpCwd();
    const phaseA = makePhaseResult('phase_a_oss_frontier');
    const result = await generateFinalReport(
      { runState: makeRunState(cwd), matrix: makeMatrix(), phaseAResult: phaseA },
      { cwd, writeNotices: false },
    );
    const md = await fs.readFile(result.markdownPath, 'utf8');
    assert.match(md, /closed \(A\)/);
  });
});
