// Learning loop tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  capturePostRunLearning,
  loadLearningState,
} from '../../src/matrix-orchestration/learning/learning-loop.js';
import type {
  FinalReportSummary,
  InterPhaseRetrospective,
  PhaseExecutionResult,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
async function tmpCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'learning-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

function makeFinalReport(): FinalReportSummary {
  return {
    generatedAt: '', projectName: 'fixture', prdSource: '',
    startingOverallScore: 5, endingOverallScore: 7,
    ossFrontierAchievement: 0.5, closedSourceFrontierAchievement: 0,
    totalAgentsDeployed: 1, totalCostUsd: 1, totalWallClockMs: 100,
    conflictsEncountered: 0, conflictsResolved: 1,
    branchesApproved: 1, branchesRejected: 0,
    patternsHarvestedCount: 0, licenseViolations: 0,
    recommendedNextIterations: [],
  };
}

function makePhaseResult(): PhaseExecutionResult {
  return {
    phase: 'phase_a_oss_frontier',
    config: {
      phase: 'phase_a_oss_frontier', workPacketIds: [], maxCostUsd: 0,
      maxWallClockMinutes: 0, maxConcurrentAgents: 0, allowedProviders: [],
      redTeamEveryMerge: false, tasteGateMinScore: 7,
    },
    attempts: [{
      workPacketId: 'w.1', providerId: 'claude', outcome: 'merged',
      scoreDeltaByDimension: { a: 1 },
      tokensConsumed: 1000, costUsd: 0.5, wallClockMs: 1000,
      startedAt: '', completedAt: '',
    }],
    dimensionsClosed: [], dimensionsOpen: [],
    totalCostUsd: 0.5, totalWallClockMs: 1000,
    startedAt: '', completedAt: '', terminationReason: 'completed',
  };
}

function makeRetro(): InterPhaseRetrospective {
  return {
    generatedAt: '', phaseAResult: makePhaseResult(),
    providerPerformance: [{
      providerId: 'claude', attempts: 1, successRate: 1.0,
      avgCostUsd: 0.5, avgWallClockMs: 1000,
      bestAtDimensions: ['a'], worstAtDimensions: [],
    }],
    recurringConflictPatterns: [],
    remainingGapToClosedSourceFrontier: 0,
    recommendation: 'stop', recommendationReason: '',
  };
}

describe('learning-loop', () => {
  it('writes a valid LearningState with version 1', async () => {
    const cwd = await tmpCwd();
    const state = await capturePostRunLearning(
      { finalReport: makeFinalReport(), phaseResults: [makePhaseResult()], retrospective: makeRetro() },
      { cwd },
    );
    assert.equal(state.version, 1);
    assert.ok(state.providerPerformance.claude);
  });

  it('loadLearningState returns null when no prior state', async () => {
    const cwd = await tmpCwd();
    const state = await loadLearningState(cwd);
    assert.equal(state, null);
  });

  it('merges across runs (totalAttempts accumulates)', async () => {
    const cwd = await tmpCwd();
    await capturePostRunLearning(
      { finalReport: makeFinalReport(), phaseResults: [makePhaseResult()], retrospective: makeRetro() },
      { cwd },
    );
    const state2 = await capturePostRunLearning(
      { finalReport: makeFinalReport(), phaseResults: [makePhaseResult()], retrospective: makeRetro() },
      { cwd },
    );
    assert.equal(state2.providerPerformance.claude?.runs, 2);
    assert.equal(state2.providerPerformance.claude?.totalAttempts, 2);
  });

  it('reset:true wipes prior state', async () => {
    const cwd = await tmpCwd();
    await capturePostRunLearning(
      { finalReport: makeFinalReport(), phaseResults: [makePhaseResult()], retrospective: makeRetro() },
      { cwd },
    );
    const reset = await capturePostRunLearning(
      { finalReport: makeFinalReport(), phaseResults: [makePhaseResult()], retrospective: makeRetro() },
      { cwd, reset: true },
    );
    assert.equal(reset.providerPerformance.claude?.runs, 1);
  });

  it('records successful harvest sources when supplied', async () => {
    const cwd = await tmpCwd();
    const state = await capturePostRunLearning(
      {
        finalReport: makeFinalReport(),
        phaseResults: [makePhaseResult()],
        retrospective: makeRetro(),
        harvestedSources: [{ repoUrl: 'https://github.com/foo/bar', patternsExtracted: 3, scoreLift: 0.5 }],
      },
      { cwd },
    );
    assert.equal(state.successfulHarvestSources.length, 1);
    assert.equal(state.successfulHarvestSources[0]?.patternsExtracted, 3);
  });
});
