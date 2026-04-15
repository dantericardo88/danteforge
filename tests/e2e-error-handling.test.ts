/**
 * E2E Error Handling scoring tests.
 *
 * Validates the errorHandling dimension scoring logic including the
 * evidence-based infrastructure bonuses added in the error-handling masterplan.
 *
 * All tests use injection seams — zero real LLM calls, zero real filesystem I/O.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeErrorHandlingScore,
  computeHarshScore,
  type ErrorHandlingEvidenceFlags,
  type HarshScorerOptions,
} from '../src/core/harsh-scorer.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { MaturityAssessment } from '../src/core/maturity-assessor.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScore(score: number): ScoreResult {
  return {
    artifact: 'SPEC' as ScoredArtifact,
    score,
    dimensions: {
      completeness: 15, clarity: 15, testability: 15,
      constitutionAlignment: 15, integrationFitness: 8, freshness: 7,
    },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: 'advance',
    hasCEOReviewBonus: false,
  };
}

function makeAllArtifacts(score = 80): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScore(score),
    SPEC: makeScore(score),
    CLARIFY: makeScore(score),
    PLAN: makeScore(score),
    TASKS: makeScore(score),
  };
}

function makeMinimalState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    lastHandoff: '',
    workflowStage: 'verify',
    currentPhase: 1,
    tasks: { 1: [{ name: 'task1' }] },
    auditLog: Array(5).fill('entry'),
    profile: 'balanced',
    lastVerifyStatus: 'pass',
    autoforgeEnabled: false,
    ...overrides,
  } as DanteState;
}

function makeAssessment(errorHandling = 70): MaturityAssessment {
  return {
    level: 4,
    levelName: 'Beta',
    score: 70,
    dimensions: {
      functionality: 70, testing: 70, errorHandling, security: 70,
      uxPolish: 60, documentation: 72, performance: 68, maintainability: 74,
    },
    gaps: [],
    founderExplanation: 'Beta quality.',
    recommendation: 'refine',
    timestamp: new Date().toISOString(),
  };
}

function makeTracker(): CompletionTracker {
  return { overallCompletion: 70, phaseScores: {}, blockingGaps: [], healthScore: 70 } as unknown as CompletionTracker;
}

function makeHarshOptions(overrides: Partial<HarshScorerOptions> = {}): HarshScorerOptions {
  return {
    cwd: '/fake/project',
    _loadState: async () => makeMinimalState(),
    _scoreAllArtifacts: async () => makeAllArtifacts(80),
    _assessMaturity: async () => makeAssessment(),
    _computeCompletionTracker: () => makeTracker(),
    _readFile: async () => 'const x = 1;',
    _listSourceFiles: async () => ['src/index.ts'],
    _readHistory: async () => [],
    _writeHistory: async () => {},
    _existsFn: async () => false,
    _readConvergenceProof: async () => ({ hasConvergenceProof: false, hasE2EConvergenceTest: false }),
    _readErrorHandlingProof: async () => ({
      hasErrorHierarchy: false,
      hasCircuitBreaker: false,
      hasResilienceModule: false,
      hasE2EErrorHandlingTest: false,
    }),
    ...overrides,
  };
}

// ── computeErrorHandlingScore — base behavior ─────────────────────────────────

describe('computeErrorHandlingScore — base behavior', () => {
  it('base score is 35 with maturity < 40 and no evidence', () => {
    const score = computeErrorHandlingScore(makeAssessment(39));
    assert.strictEqual(score, 35);
  });

  it('maturity.errorHandling >= 40 adds 15 points', () => {
    const below = computeErrorHandlingScore(makeAssessment(39));
    const at = computeErrorHandlingScore(makeAssessment(40));
    assert.strictEqual(at - below, 15);
  });

  it('maturity.errorHandling < 40 adds 0 points (boundary: 39 vs 40)', () => {
    const at39 = computeErrorHandlingScore(makeAssessment(39));
    const at38 = computeErrorHandlingScore(makeAssessment(38));
    assert.strictEqual(at39 - at38, 0, 'no bonus below 40');
    assert.strictEqual(at39, 35, 'exactly base');
  });

  it('hasErrorHierarchy: true adds 15 points', () => {
    // Use maturity 39 to isolate the flag delta
    const base = computeErrorHandlingScore(makeAssessment(39));
    const withFlag = computeErrorHandlingScore(makeAssessment(39), {
      hasErrorHierarchy: true, hasCircuitBreaker: false,
      hasResilienceModule: false, hasE2EErrorHandlingTest: false,
    });
    assert.strictEqual(withFlag - base, 15);
  });

  it('hasCircuitBreaker: true adds 10 points', () => {
    const base = computeErrorHandlingScore(makeAssessment(39));
    const withFlag = computeErrorHandlingScore(makeAssessment(39), {
      hasErrorHierarchy: false, hasCircuitBreaker: true,
      hasResilienceModule: false, hasE2EErrorHandlingTest: false,
    });
    assert.strictEqual(withFlag - base, 10);
  });

  it('hasResilienceModule: true adds 10 points', () => {
    const base = computeErrorHandlingScore(makeAssessment(39));
    const withFlag = computeErrorHandlingScore(makeAssessment(39), {
      hasErrorHierarchy: false, hasCircuitBreaker: false,
      hasResilienceModule: true, hasE2EErrorHandlingTest: false,
    });
    assert.strictEqual(withFlag - base, 10);
  });

  it('hasE2EErrorHandlingTest: true adds 10 points', () => {
    const base = computeErrorHandlingScore(makeAssessment(39));
    const withFlag = computeErrorHandlingScore(makeAssessment(39), {
      hasErrorHierarchy: false, hasCircuitBreaker: false,
      hasResilienceModule: false, hasE2EErrorHandlingTest: true,
    });
    assert.strictEqual(withFlag - base, 10);
  });

  it('all flags + maturity >= 40 yields 95, capped (35+15+15+10+10+10=95)', () => {
    const score = computeErrorHandlingScore(makeAssessment(40), {
      hasErrorHierarchy: true, hasCircuitBreaker: true,
      hasResilienceModule: true, hasE2EErrorHandlingTest: true,
    });
    assert.strictEqual(score, 95);
  });

  it('undefined flags behave same as all-false', () => {
    const noFlags = computeErrorHandlingScore(makeAssessment(50));
    const falseFlags = computeErrorHandlingScore(makeAssessment(50), {
      hasErrorHierarchy: false, hasCircuitBreaker: false,
      hasResilienceModule: false, hasE2EErrorHandlingTest: false,
    });
    assert.strictEqual(noFlags, falseFlags);
  });
});

// ── computeHarshScore — errorHandling override via _readErrorHandlingProof ────

describe('computeHarshScore — errorHandling override via _readErrorHandlingProof', () => {
  // Use assessment with errorHandling=39 to avoid maturity bonus masking deltas
  const lowMaturityAssessment = async () => makeAssessment(39);

  it('errorHandling higher when hasErrorHierarchy=true', async () => {
    const withFlag = await computeHarshScore(makeHarshOptions({
      _assessMaturity: lowMaturityAssessment,
      _readErrorHandlingProof: async () => ({
        hasErrorHierarchy: true, hasCircuitBreaker: false,
        hasResilienceModule: false, hasE2EErrorHandlingTest: false,
      }),
    }));
    const withoutFlag = await computeHarshScore(makeHarshOptions({
      _assessMaturity: lowMaturityAssessment,
      _readErrorHandlingProof: async () => ({
        hasErrorHierarchy: false, hasCircuitBreaker: false,
        hasResilienceModule: false, hasE2EErrorHandlingTest: false,
      }),
    }));
    assert.ok(
      withFlag.dimensions.errorHandling > withoutFlag.dimensions.errorHandling,
      'hasErrorHierarchy should raise errorHandling score',
    );
    assert.strictEqual(withFlag.dimensions.errorHandling - withoutFlag.dimensions.errorHandling, 15);
  });

  it('errorHandling higher when hasCircuitBreaker=true', async () => {
    const withFlag = await computeHarshScore(makeHarshOptions({
      _assessMaturity: lowMaturityAssessment,
      _readErrorHandlingProof: async () => ({
        hasErrorHierarchy: false, hasCircuitBreaker: true,
        hasResilienceModule: false, hasE2EErrorHandlingTest: false,
      }),
    }));
    const withoutFlag = await computeHarshScore(makeHarshOptions({
      _assessMaturity: lowMaturityAssessment,
    }));
    assert.strictEqual(withFlag.dimensions.errorHandling - withoutFlag.dimensions.errorHandling, 10);
  });

  it('errorHandling higher when hasResilienceModule=true', async () => {
    const withFlag = await computeHarshScore(makeHarshOptions({
      _assessMaturity: lowMaturityAssessment,
      _readErrorHandlingProof: async () => ({
        hasErrorHierarchy: false, hasCircuitBreaker: false,
        hasResilienceModule: true, hasE2EErrorHandlingTest: false,
      }),
    }));
    const withoutFlag = await computeHarshScore(makeHarshOptions({
      _assessMaturity: lowMaturityAssessment,
    }));
    assert.strictEqual(withFlag.dimensions.errorHandling - withoutFlag.dimensions.errorHandling, 10);
  });

  it('reaches 95 with all flags true and maturity >= 40', async () => {
    const result = await computeHarshScore(makeHarshOptions({
      _assessMaturity: async () => makeAssessment(50),
      _readErrorHandlingProof: async () => ({
        hasErrorHierarchy: true, hasCircuitBreaker: true,
        hasResilienceModule: true, hasE2EErrorHandlingTest: true,
      }),
    }));
    assert.strictEqual(result.dimensions.errorHandling, 95);
  });

  it('unaffected when _readErrorHandlingProof returns all-false', async () => {
    const withFalse = await computeHarshScore(makeHarshOptions({
      _readErrorHandlingProof: async () => ({
        hasErrorHierarchy: false, hasCircuitBreaker: false,
        hasResilienceModule: false, hasE2EErrorHandlingTest: false,
      }),
    }));
    const withDefault = await computeHarshScore(makeHarshOptions());
    assert.strictEqual(withFalse.dimensions.errorHandling, withDefault.dimensions.errorHandling);
  });

  it('replaces raw dims.errorHandling — not additive with raw maturity score', async () => {
    // Without override, errorHandling would be whatever maturity returns (50+15=50 from maturity ≥40)
    // With override via _readErrorHandlingProof, the full formula applies
    const maturity50Assessment = async () => makeAssessment(50);
    const withAllFlags = await computeHarshScore(makeHarshOptions({
      _assessMaturity: maturity50Assessment,
      _readErrorHandlingProof: async () => ({
        hasErrorHierarchy: true, hasCircuitBreaker: true,
        hasResilienceModule: true, hasE2EErrorHandlingTest: true,
      }),
    }));
    // 35 + 15 (maturity≥40) + 15 + 10 + 10 + 10 = 95
    assert.strictEqual(withAllFlags.dimensions.errorHandling, 95);
    // Without any flags: 35 + 15 (maturity≥40) = 50
    const withNoFlags = await computeHarshScore(makeHarshOptions({
      _assessMaturity: maturity50Assessment,
    }));
    assert.strictEqual(withNoFlags.dimensions.errorHandling, 50);
  });
});
