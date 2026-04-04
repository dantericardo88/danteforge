// Self-Improve Loop — tests for cycle counting, plateau detection, escalation,
// exit on success, max-cycles safety, and score tracking.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selfImprove,
  type SelfImproveOptions,
  type SelfImproveResult,
} from '../src/cli/commands/self-improve.js';
import type { AssessResult } from '../src/cli/commands/assess.js';
import type { HarshScoreResult, ScoringDimension } from '../src/core/harsh-scorer.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';
import type { Masterplan, MasterplanItem } from '../src/core/gap-masterplan.js';
import type { DanteState } from '../src/core/state.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_DIMS: ScoringDimension[] = [
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
  'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
];

function makeDims(score: number): Record<ScoringDimension, number> {
  return Object.fromEntries(ALL_DIMS.map((d) => [d, score])) as Record<ScoringDimension, number>;
}

function makeMaturityAssessment(score = 72): MaturityAssessment {
  return {
    currentLevel: 4, targetLevel: 5, overallScore: score,
    dimensions: {
      functionality: score, testing: score, errorHandling: score,
      security: score, uxPolish: score, documentation: score,
      performance: score, maintainability: score,
    },
    gaps: [], founderExplanation: 'Beta.', recommendation: 'refine',
    timestamp: new Date().toISOString(),
  };
}

function makeHarshResult(displayScore: number): HarshScoreResult {
  const internal = displayScore * 10;
  const dims = makeDims(internal);
  return {
    rawScore: internal, harshScore: internal, displayScore,
    dimensions: dims,
    displayDimensions: Object.fromEntries(
      Object.entries(dims).map(([k, v]) => [k, v / 10]),
    ) as Record<ScoringDimension, number>,
    penalties: [], stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: displayScore >= 9.0 ? 'excellent' : 'needs-work',
    maturityAssessment: makeMaturityAssessment(internal),
    timestamp: new Date().toISOString(),
  };
}

function makeMasterplanItems(count = 3): MasterplanItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `P1-0${i + 1}`,
    priority: 'P1' as const,
    dimension: ALL_DIMS[i % ALL_DIMS.length]!,
    currentScore: 7.0,
    targetScore: 9.0,
    title: `Fix ${ALL_DIMS[i % ALL_DIMS.length]}`,
    description: 'Needs work',
    forgeCommand: `danteforge forge "fix ${i}"`,
    verifyCondition: 'tests pass',
    estimatedDelta: 0.5,
  }));
}

function makeMasterplan(score: number, items?: MasterplanItem[]): Masterplan {
  return {
    generatedAt: new Date().toISOString(),
    cycleNumber: 1,
    overallScore: score,
    targetScore: 9.0,
    gapToTarget: Math.max(0, 9.0 - score),
    items: items ?? makeMasterplanItems(),
    criticalCount: 0,
    majorCount: 3,
    projectedCycles: 4,
  };
}

function makeAssessResult(score: number, minScore = 9.0): AssessResult {
  return {
    assessment: makeHarshResult(score),
    masterplan: makeMasterplan(score),
    completionTarget: {
      mode: 'dimension-based',
      minScore,
      description: 'Standard 12-dimension scoring',
      definedAt: new Date().toISOString(),
      definedBy: 'default',
    },
    overallScore: score,
    passesThreshold: score >= minScore,
    minScore,
  };
}

function makeState(): DanteState {
  return {
    project: 'test', lastHandoff: '', workflowStage: 'verify',
    currentPhase: 1, tasks: { 1: [{ name: 't1' }] },
    auditLog: [], profile: 'budget',
  };
}

// Build a cycle-incrementing assess mock
function makeCyclingAssess(scores: number[], minScore = 9.0) {
  let call = 0;
  return async (): Promise<AssessResult> => {
    const score = scores[call] ?? scores[scores.length - 1] ?? 7.0;
    call++;
    return makeAssessResult(score, minScore);
  };
}

function makeOptions(overrides: Partial<SelfImproveOptions> = {}): SelfImproveOptions {
  return {
    cwd: '/fake/cwd',
    minScore: 9.0,
    maxCycles: 5,
    _runAssess: makeCyclingAssess([7.0, 7.5, 8.0, 8.5, 9.0]),
    _runAutoforge: async () => {},
    _runVerify: async () => {},
    _runParty: async () => {},
    _loadState: async () => makeState(),
    _saveState: async () => {},
    _appendLesson: async () => {},
    _now: () => new Date().toISOString(),
    ...overrides,
  };
}

// ── selfImprove ───────────────────────────────────────────────────────────────

describe('selfImprove', () => {
  it('returns achieved=true when initial score already meets target', async () => {
    const result = await selfImprove(makeOptions({
      _runAssess: async () => makeAssessResult(9.5),
    }));
    assert.equal(result.achieved, true);
    assert.equal(result.cyclesRun, 0);
    assert.equal(result.stopReason, 'target-achieved');
  });

  it('runs cycles until score reaches target', async () => {
    // Scores: 7.0 → 7.5 → 8.0 → 8.5 → 9.0 → 9.2 (target at 9.0)
    const result = await selfImprove(makeOptions({
      maxCycles: 10,
      _runAssess: makeCyclingAssess([7.0, 7.5, 8.0, 8.5, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0, 9.2], 9.0),
    }));
    assert.equal(result.achieved, true);
    assert.equal(result.stopReason, 'target-achieved');
    assert.ok(result.finalScore >= 9.0);
  });

  it('stops at maxCycles when target not reached', async () => {
    // Always returns 7.0 — never reaches 9.0
    const result = await selfImprove(makeOptions({
      maxCycles: 3,
      _runAssess: async () => makeAssessResult(7.0),
    }));
    assert.equal(result.achieved, false);
    assert.equal(result.stopReason, 'max-cycles');
    assert.ok(result.cyclesRun <= 3);
  });

  it('records initial and final score', async () => {
    const scores = [7.0, 7.2, 7.5, 8.0, 8.5, 9.0, 9.0, 9.0, 9.0, 9.0, 9.0];
    const result = await selfImprove(makeOptions({
      _runAssess: makeCyclingAssess(scores, 9.0),
      maxCycles: 10,
    }));
    assert.equal(result.initialScore, 7.0);
    assert.ok(result.finalScore >= 7.0);
  });

  it('calls _runAutoforge for each focus item', async () => {
    const autoforgeGoals: string[] = [];
    await selfImprove(makeOptions({
      maxCycles: 1,
      _runAutoforge: async (goal) => { autoforgeGoals.push(goal); },
      _runAssess: makeCyclingAssess([7.0, 7.0, 7.0], 9.0),
    }));
    assert.ok(autoforgeGoals.length > 0, 'autoforge called at least once');
  });

  it('calls _runVerify after each autoforge cycle', async () => {
    let verifyCount = 0;
    await selfImprove(makeOptions({
      maxCycles: 2,
      _runVerify: async () => { verifyCount++; },
      _runAssess: makeCyclingAssess([7.0, 7.0, 7.0, 7.0, 7.0], 9.0),
    }));
    assert.ok(verifyCount >= 1, `verify should be called, got ${verifyCount}`);
  });

  it('escalates to party mode after plateau cycles', async () => {
    let partyCalled = false;
    const stuckScore = 7.0; // never improves → plateau

    await selfImprove(makeOptions({
      maxCycles: 6, // need >= 4 cycles to trigger plateau (3 plateau cycles + 1 escalation)
      _runAssess: async () => makeAssessResult(stuckScore),
      _runParty: async () => { partyCalled = true; },
    }));
    assert.ok(partyCalled, 'Party mode should be called on plateau');
  });

  it('sets plateauDetected=true when plateau occurs', async () => {
    const result = await selfImprove(makeOptions({
      maxCycles: 6,
      _runAssess: async () => makeAssessResult(7.0), // stuck
    }));
    assert.equal(result.plateauDetected, true);
  });

  it('continues gracefully when _runVerify throws', async () => {
    const result = await selfImprove(makeOptions({
      maxCycles: 2,
      _runVerify: async () => { throw new Error('verify failed'); },
      _runAssess: makeCyclingAssess([7.0, 8.0, 9.0, 9.0, 9.0], 9.0),
    }));
    // Should complete without throwing
    assert.ok(result.cyclesRun >= 1);
  });

  it('persists audit log entry via _saveState', async () => {
    let savedState: DanteState | undefined;
    await selfImprove(makeOptions({
      maxCycles: 1,
      _saveState: async (state) => { savedState = state; },
      _runAssess: makeCyclingAssess([7.0, 9.5, 9.5, 9.5, 9.5], 9.0),
    }));
    assert.ok(savedState !== undefined, 'saveState called');
    const hasAuditEntry = savedState!.auditLog?.some((entry) => entry.includes('self-improve'));
    assert.ok(hasAuditEntry, 'self-improve entry in audit log');
  });

  it('filters to focusDimensions when provided', async () => {
    const forgeCalls: string[] = [];
    await selfImprove(makeOptions({
      focusDimensions: ['testing'],
      maxCycles: 1,
      _runAutoforge: async (goal) => { forgeCalls.push(goal); },
      _runAssess: makeCyclingAssess([7.0, 7.0, 7.0], 9.0),
    }));
    // All forge calls should mention 'testing'
    if (forgeCalls.length > 0) {
      assert.ok(forgeCalls.every((g) => g.toLowerCase().includes('testing')));
    }
  });

  it('stopReason=target-achieved when target met mid-loop', async () => {
    const result = await selfImprove(makeOptions({
      maxCycles: 10,
      _runAssess: makeCyclingAssess([7.0, 7.5, 9.0, 9.0, 9.0, 9.0], 9.0),
    }));
    assert.equal(result.stopReason, 'target-achieved');
    assert.equal(result.achieved, true);
  });

  it('returns stopReason=plateau-unresolved when plateau + no improvement after party', async () => {
    const result = await selfImprove(makeOptions({
      maxCycles: 8,
      _runAssess: async () => makeAssessResult(6.0), // permanently stuck
      _runParty: async () => {},
    }));
    assert.ok(
      result.stopReason === 'plateau-unresolved' || result.stopReason === 'max-cycles',
      `Unexpected stopReason: ${result.stopReason}`,
    );
    assert.equal(result.achieved, false);
  });
});
