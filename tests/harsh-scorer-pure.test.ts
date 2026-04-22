import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePlanningQualityScore,
  computeSelfImprovementScore,
  computeDeveloperExperienceScore,
  computeAutonomyScore,
  computeSpecDrivenPipelineScore,
  computeConvergenceSelfHealingScore,
  computeErrorHandlingScore,
  computeTokenEconomyScore,
} from '../src/core/harsh-scorer.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';

function makeAssessment(overrides: Partial<MaturityAssessment> = {}): MaturityAssessment {
  return {
    currentLevel: 'mvp' as any,
    targetLevel: 'production' as any,
    overallScore: 60,
    dimensions: {
      functionality: 60,
      testing: 60,
      errorHandling: 50,
      security: 60,
      uxPolish: 40,
      documentation: 55,
      performance: 50,
      maintainability: 55,
    },
    gaps: [],
    founderExplanation: '',
    recommendation: 'proceed',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    phase: 'forge',
    tasks: {},
    auditLog: [],
    ...overrides,
  } as unknown as DanteState;
}

describe('computePlanningQualityScore', () => {
  it('returns 0 when no pdse scores present', () => {
    const score = computePlanningQualityScore({});
    assert.equal(score, 0);
  });

  it('averages scores across the 5 planning artifacts', () => {
    const pdseScores = {
      CONSTITUTION: { score: 100 } as any,
      SPEC: { score: 100 } as any,
      CLARIFY: { score: 100 } as any,
      PLAN: { score: 100 } as any,
      TASKS: { score: 100 } as any,
    };
    const score = computePlanningQualityScore(pdseScores);
    assert.equal(score, 100);
  });

  it('uses 0 for missing artifacts', () => {
    const pdseScores = {
      CONSTITUTION: { score: 100 } as any,
    };
    // Only 1 out of 5 present = avg of [100, 0, 0, 0, 0] = 20
    const score = computePlanningQualityScore(pdseScores);
    assert.equal(score, 20);
  });
});

describe('computeSelfImprovementScore', () => {
  it('starts at 40 base', () => {
    const state = makeState({ retroDelta: 0, auditLog: [], lastVerifyStatus: 'fail', autoforgeFailedAttempts: 1 });
    const score = computeSelfImprovementScore(state);
    assert.equal(score, 40);
  });

  it('adds 20 for positive retroDelta', () => {
    const state = makeState({ retroDelta: 5, auditLog: [], lastVerifyStatus: 'fail', autoforgeFailedAttempts: 1 });
    const score = computeSelfImprovementScore(state);
    assert.equal(score, 60);
  });

  it('adds 20 for audit log > 20 entries', () => {
    const state = makeState({ auditLog: Array(21).fill({ action: 'x' }), retroDelta: 0, lastVerifyStatus: 'fail', autoforgeFailedAttempts: 1 });
    const score = computeSelfImprovementScore(state);
    assert.equal(score, 60);
  });

  it('caps at 100', () => {
    const state = makeState({
      retroDelta: 10,
      auditLog: Array(25).fill({ action: 'x' }),
      lastVerifyStatus: 'pass',
      autoforgeFailedAttempts: 0,
    });
    const score = computeSelfImprovementScore(state);
    assert.ok(score <= 100);
  });
});

describe('computeDeveloperExperienceScore', () => {
  it('averages documentation and maintainability', () => {
    const assessment = makeAssessment({
      dimensions: { ...makeAssessment().dimensions, documentation: 80, maintainability: 60 },
    });
    const score = computeDeveloperExperienceScore(assessment);
    // base = (80+60)/2 = 70, no critical gaps → bonus 10 = 80
    assert.equal(score, 80);
  });

  it('adds 10 bonus when no critical gaps', () => {
    const assessment = makeAssessment({ gaps: [] });
    const score = computeDeveloperExperienceScore(assessment);
    const base = Math.round((assessment.dimensions.documentation + assessment.dimensions.maintainability) / 2);
    assert.equal(score, base + 10);
  });

  it('adds 5 bonus when exactly 1 critical gap', () => {
    const gap = { dimension: 'testing' as any, currentScore: 20, targetScore: 60, gapSize: 40, severity: 'critical' as any, recommendation: '' };
    const assessment = makeAssessment({ gaps: [gap] });
    const score = computeDeveloperExperienceScore(assessment);
    const base = Math.round((assessment.dimensions.documentation + assessment.dimensions.maintainability) / 2);
    assert.equal(score, base + 5);
  });
});

describe('computeAutonomyScore', () => {
  it('returns base 30 without any extras', () => {
    const state = makeState({ lastVerifyStatus: 'fail', tasks: {}, autoforgeEnabled: false });
    const assessment = makeAssessment({ recommendation: 'refine' });
    const score = computeAutonomyScore(state, assessment);
    assert.equal(score, 30);
  });

  it('adds 25 when lastVerifyStatus is pass', () => {
    const state = makeState({ lastVerifyStatus: 'pass', tasks: {}, autoforgeEnabled: false });
    const assessment = makeAssessment({ recommendation: 'refine' });
    const score = computeAutonomyScore(state, assessment);
    assert.equal(score, 55);
  });

  it('adds 20 when recommendation is target-exceeded', () => {
    const state = makeState({ lastVerifyStatus: 'fail', tasks: {} });
    const assessment = makeAssessment({ recommendation: 'target-exceeded' });
    const score = computeAutonomyScore(state, assessment);
    assert.equal(score, 50);
  });

  it('caps at 100', () => {
    const state = makeState({ lastVerifyStatus: 'pass', tasks: { a: 1, b: 1, c: 1 } as any, autoforgeEnabled: true });
    const assessment = makeAssessment({ recommendation: 'target-exceeded' });
    const score = computeAutonomyScore(state, assessment);
    assert.ok(score <= 100);
  });
});

describe('computeSpecDrivenPipelineScore', () => {
  it('returns 20 base with no artifacts or stage', () => {
    const state = makeState({ workflowStage: 'initialized' });
    const score = computeSpecDrivenPipelineScore({}, state);
    assert.equal(score, 20);
  });

  it('adds 12 per present artifact', () => {
    const state = makeState({ workflowStage: 'initialized' });
    const pdse = { CONSTITUTION: { score: 80 } as any };
    const score = computeSpecDrivenPipelineScore(pdse, state);
    assert.equal(score, 32); // 20 + 12
  });

  it('adds 20 for stage index >= 5 (plan stage or later)', () => {
    const state = makeState({ workflowStage: 'verify' });
    const score = computeSpecDrivenPipelineScore({}, state);
    assert.equal(score, 40); // 20 + 20
  });

  it('capped at 95', () => {
    const state = makeState({ workflowStage: 'verify' });
    const pdse = {
      CONSTITUTION: { score: 90 } as any,
      SPEC: { score: 90 } as any,
      CLARIFY: { score: 90 } as any,
      PLAN: { score: 90 } as any,
      TASKS: { score: 90 } as any,
    };
    const score = computeSpecDrivenPipelineScore(pdse, state, { hasPipelineEvidence: true, hasE2ETest: true });
    assert.ok(score <= 95);
  });
});

describe('computeConvergenceSelfHealingScore', () => {
  it('returns 30 base with no extras', () => {
    const state = makeState({ lastVerifyStatus: 'fail', auditLog: [], autoforgeEnabled: false });
    const score = computeConvergenceSelfHealingScore(state);
    assert.equal(score, 30);
  });

  it('adds 25 for lastVerifyStatus pass', () => {
    const state = makeState({ lastVerifyStatus: 'pass', auditLog: [], autoforgeEnabled: false });
    const score = computeConvergenceSelfHealingScore(state);
    assert.equal(score, 55);
  });

  it('adds convergence proof bonus', () => {
    const state = makeState({ lastVerifyStatus: 'pass', auditLog: [] });
    const score = computeConvergenceSelfHealingScore(state, { hasConvergenceProof: true, hasE2EConvergenceTest: false });
    assert.ok(score > 55);
  });

  it('capped at 95', () => {
    const state = makeState({
      lastVerifyStatus: 'pass',
      auditLog: Array(15).fill({ action: 'x' }),
      autoforgeEnabled: true,
      autoforgeFailedAttempts: 1,
    });
    const score = computeConvergenceSelfHealingScore(state, { hasConvergenceProof: true, hasE2EConvergenceTest: true });
    assert.ok(score <= 95);
  });
});

describe('computeErrorHandlingScore', () => {
  it('returns 35 base with minimal assessment', () => {
    const assessment = makeAssessment({ dimensions: { ...makeAssessment().dimensions, errorHandling: 30 } });
    const score = computeErrorHandlingScore(assessment);
    assert.equal(score, 35);
  });

  it('adds 15 when errorHandling maturity >= 40', () => {
    const assessment = makeAssessment({ dimensions: { ...makeAssessment().dimensions, errorHandling: 50 } });
    const score = computeErrorHandlingScore(assessment);
    assert.equal(score, 50);
  });

  it('adds error hierarchy bonus when flag is set (no wiring)', () => {
    const assessment = makeAssessment({ dimensions: { ...makeAssessment().dimensions, errorHandling: 50 } });
    const score = computeErrorHandlingScore(assessment, { hasErrorHierarchy: true });
    assert.equal(score, 65); // 35 + 15 + 15
  });

  it('capped at 95', () => {
    const assessment = makeAssessment({ dimensions: { ...makeAssessment().dimensions, errorHandling: 80 } });
    const score = computeErrorHandlingScore(assessment, {
      hasErrorHierarchy: true,
      hasCircuitBreaker: true,
      hasResilienceModule: true,
      hasE2EErrorHandlingTest: true,
    });
    assert.ok(score <= 95);
  });
});

describe('computeTokenEconomyScore', () => {
  it('returns 40 base with empty state', () => {
    const state = makeState({});
    const score = computeTokenEconomyScore(state);
    assert.equal(score, 40);
  });

  it('adds 20 for maxBudgetUsd > 0', () => {
    const state = { ...makeState(), maxBudgetUsd: 5 } as any;
    const score = computeTokenEconomyScore(state);
    assert.equal(score, 60);
  });

  it('adds 10 for totalTokensUsed >= 1000', () => {
    const state = { ...makeState(), totalTokensUsed: 2000 } as any;
    const score = computeTokenEconomyScore(state);
    assert.equal(score, 50);
  });

  it('caps at 100', () => {
    const state = {
      ...makeState(),
      maxBudgetUsd: 10,
      routingAggressiveness: 'high',
      lastComplexityPreset: 'heavy',
      totalTokensUsed: 5000,
    } as any;
    const score = computeTokenEconomyScore(state);
    assert.ok(score <= 100);
  });
});
