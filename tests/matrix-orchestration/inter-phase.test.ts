// Inter-phase retrospective + Phase B planner tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generateInterPhaseRetrospective,
  planPhaseB,
} from '../../src/matrix-orchestration/phases/inter-phase.js';
import type {
  CapacityReport,
  OrchestrationDimensionMatrix,
  PhaseAttempt,
  PhaseExecutionResult,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];
async function tmpCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'inter-phase-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

function makeMatrix(): OrchestrationDimensionMatrix {
  return {
    generatedAt: '', projectName: 'fixture',
    overallCurrentScore: 5, overallOssFrontierScore: 8, overallClosedFrontierScore: 9,
    approvedByUser: true,
    dimensions: [
      {
        dimensionId: 'a', name: 'A', category: 'core', weight: 1,
        rubric: { score5: '', score7: '', score9: '' }, evidenceRequired: [],
        currentScore: 5, ossFrontierScore: 8, closedFrontierScore: 9,
        gapToOssFrontier: 3, gapToClosedFrontier: 4,
      },
      {
        dimensionId: 'b', name: 'B', category: 'core', weight: 1,
        rubric: { score5: '', score7: '', score9: '' }, evidenceRequired: [],
        currentScore: 5, ossFrontierScore: 8, closedFrontierScore: 9,
        gapToOssFrontier: 3, gapToClosedFrontier: 4,
      },
    ],
  };
}

function makeAttempt(provider: 'claude' | 'codex', outcome: PhaseAttempt['outcome'], reason?: string): PhaseAttempt {
  return {
    workPacketId: `work.${provider}.${outcome}`, providerId: provider,
    outcome, rejectionReason: reason,
    scoreDeltaByDimension: outcome === 'merged' ? { a: 1 } : undefined,
    tokensConsumed: 0, costUsd: 0, wallClockMs: 100,
    startedAt: '', completedAt: '',
  };
}

function makePhaseAResult(attempts: PhaseAttempt[]): PhaseExecutionResult {
  return {
    phase: 'phase_a_oss_frontier',
    config: {
      phase: 'phase_a_oss_frontier', workPacketIds: [], maxCostUsd: 0,
      maxWallClockMinutes: 0, maxConcurrentAgents: 0,
      allowedProviders: [], redTeamEveryMerge: false, tasteGateMinScore: 7,
    },
    attempts, dimensionsClosed: [], dimensionsOpen: ['a', 'b'],
    totalCostUsd: 0, totalWallClockMs: 0,
    startedAt: '', completedAt: '', terminationReason: 'completed',
  };
}

function makeCapacity(): CapacityReport {
  return {
    generatedAt: '', hostMachineSignature: '',
    totalPracticalConcurrency: 2, benchmarkDurationMs: 0,
    providers: [
      { providerId: 'claude', installed: true, authStatus: 'authenticated', concurrentInstances: 1 },
      { providerId: 'codex', installed: true, authStatus: 'authenticated', concurrentInstances: 1 },
    ],
  };
}

describe('inter-phase', () => {
  it('groups attempts by provider and computes success rates', async () => {
    const cwd = await tmpCwd();
    const result = makePhaseAResult([
      makeAttempt('claude', 'merged'),
      makeAttempt('claude', 'rejected_by_verification'),
      makeAttempt('codex', 'merged'),
    ]);
    const retro = await generateInterPhaseRetrospective(result, makeMatrix(), { cwd });
    const claude = retro.providerPerformance.find(p => p.providerId === 'claude');
    const codex = retro.providerPerformance.find(p => p.providerId === 'codex');
    assert.equal(claude?.attempts, 2);
    assert.equal(claude?.successRate, 0.5);
    assert.equal(codex?.successRate, 1.0);
  });

  it('detects recurring conflict paths from rejection reasons', async () => {
    const cwd = await tmpCwd();
    const result = makePhaseAResult([
      makeAttempt('claude', 'rejected_by_verification', 'collision on src/core/foo.ts'),
      makeAttempt('codex', 'rejected_by_verification', 'collision on src/core/foo.ts'),
    ]);
    const retro = await generateInterPhaseRetrospective(result, makeMatrix(), { cwd });
    assert.ok(retro.recurringConflictPatterns.some(p => p.includes('src/core/foo.ts')));
  });

  it('recommends proceed_to_phase_b when gap remains and termination was clean', async () => {
    const cwd = await tmpCwd();
    const result = makePhaseAResult([makeAttempt('claude', 'merged')]);
    const retro = await generateInterPhaseRetrospective(result, makeMatrix(), { cwd });
    assert.equal(retro.recommendation, 'proceed_to_phase_b');
  });

  it('recommends pause_for_user_input when budget exhausted', async () => {
    const cwd = await tmpCwd();
    const result = makePhaseAResult([makeAttempt('claude', 'merged')]);
    result.terminationReason = 'budget_exhausted';
    const retro = await generateInterPhaseRetrospective(result, makeMatrix(), { cwd });
    assert.equal(retro.recommendation, 'pause_for_user_input');
  });

  it('planPhaseB forces redTeamEveryMerge and tasteGateMinScore >= 8', async () => {
    const cwd = await tmpCwd();
    const result = makePhaseAResult([makeAttempt('claude', 'merged')]);
    const retro = await generateInterPhaseRetrospective(result, makeMatrix(), { cwd });
    const plan = await planPhaseB(
      { retrospective: retro, matrix: makeMatrix(), capacity: makeCapacity() },
      { cwd },
    );
    assert.equal(plan.redTeamEveryMerge, true);
    assert.ok(plan.tasteGateMinScore >= 8);
    assert.ok(plan.allowedProviders.includes('claude'));
  });
});
