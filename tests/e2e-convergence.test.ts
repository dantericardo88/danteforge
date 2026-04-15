/**
 * E2E Convergence Self-Healing scoring tests.
 *
 * Validates the convergenceSelfHealing dimension scoring logic including the
 * execution-evidence bonuses added in the convergence masterplan.
 *
 * All tests use injection seams — zero real LLM calls, zero real filesystem I/O.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeConvergenceSelfHealingScore,
  computeHarshScore,
  type ConvergenceEvidenceFlags,
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

function makeAssessment(): MaturityAssessment {
  return {
    level: 4,
    levelName: 'Beta',
    score: 70,
    dimensions: {
      functionality: 70, testing: 70, errorHandling: 65, security: 70,
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
    _loadState: async () => makeMinimalState({ workflowStage: 'synthesize' }),
    _scoreAllArtifacts: async () => makeAllArtifacts(80),
    _assessMaturity: async () => makeAssessment(),
    _computeCompletionTracker: () => makeTracker(),
    _readFile: async () => 'const x = 1;',
    _listSourceFiles: async () => ['src/index.ts'],
    _readHistory: async () => [],
    _writeHistory: async () => {},
    _existsFn: async () => false,
    _readConvergenceProof: async () => ({ hasConvergenceProof: false, hasE2EConvergenceTest: false }),
    ...overrides,
  };
}

// ── computeConvergenceSelfHealingScore — base behavior ────────────────────────

describe('computeConvergenceSelfHealingScore — base behavior', () => {
  it('base score is 30 with no state signals and no evidence', () => {
    const score = computeConvergenceSelfHealingScore(
      makeMinimalState({
        workflowStage: 'initialized',
        lastVerifyStatus: 'unknown',
        autoforgeEnabled: false,
        autoforgeFailedAttempts: 0,
        auditLog: [],
      }),
    );
    assert.strictEqual(score, 30);
  });

  it('lastVerifyStatus=pass adds 25 points', () => {
    const base = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'unknown', autoforgeEnabled: false, auditLog: [] }),
    );
    const withPass = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'pass', autoforgeEnabled: false, auditLog: [] }),
    );
    assert.strictEqual(withPass - base, 25);
  });

  it('autoforgeFailedAttempts>0 AND pass adds 15 more points (recovery proven)', () => {
    const base = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'pass', autoforgeFailedAttempts: 0, autoforgeEnabled: false, auditLog: [] }),
    );
    const withRecovery = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'pass', autoforgeFailedAttempts: 2, autoforgeEnabled: false, auditLog: [] }),
    );
    assert.strictEqual(withRecovery - base, 15);
  });

  it('auditLog.length>10 adds 15 points; length>3 adds 8 points', () => {
    const base = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'unknown', autoforgeEnabled: false, auditLog: [] }),
    );
    const shortLog = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'unknown', autoforgeEnabled: false, auditLog: Array(5).fill('e') }),
    );
    const longLog = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'unknown', autoforgeEnabled: false, auditLog: Array(15).fill('e') }),
    );
    assert.strictEqual(shortLog - base, 8, 'short log adds 8');
    assert.strictEqual(longLog - base, 15, 'long log adds 15');
  });

  it('autoforgeEnabled adds 10 points', () => {
    const base = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'unknown', autoforgeEnabled: false, auditLog: [] }),
    );
    const enabled = computeConvergenceSelfHealingScore(
      makeMinimalState({ lastVerifyStatus: 'unknown', autoforgeEnabled: true, auditLog: [] }),
    );
    assert.strictEqual(enabled - base, 10);
  });

  it('score is capped at 95 even with all state signals (120 → 95)', () => {
    // 30+25+15+15+10 = 95 from state alone (exactly at cap)
    const score = computeConvergenceSelfHealingScore(
      makeMinimalState({
        lastVerifyStatus: 'pass',
        autoforgeFailedAttempts: 1,
        autoforgeEnabled: true,
        auditLog: Array(15).fill('e'),
      }),
    );
    assert.strictEqual(score, 95);
  });
});

// ── computeConvergenceSelfHealingScore — evidence bonuses ─────────────────────

describe('computeConvergenceSelfHealingScore — evidence bonuses', () => {
  // Use low-signal state to avoid cap masking in delta tests
  const lowState = makeMinimalState({
    workflowStage: 'initialized',
    lastVerifyStatus: 'unknown',
    autoforgeEnabled: false,
    autoforgeFailedAttempts: 0,
    auditLog: [],
  });

  it('hasConvergenceProof: true adds 15 points', () => {
    const base = computeConvergenceSelfHealingScore(lowState);
    const withProof = computeConvergenceSelfHealingScore(
      lowState,
      { hasConvergenceProof: true, hasE2EConvergenceTest: false },
    );
    assert.strictEqual(withProof - base, 15);
  });

  it('hasE2EConvergenceTest: true adds 10 points', () => {
    const base = computeConvergenceSelfHealingScore(lowState);
    const withTest = computeConvergenceSelfHealingScore(
      lowState,
      { hasConvergenceProof: false, hasE2EConvergenceTest: true },
    );
    assert.strictEqual(withTest - base, 10);
  });

  it('both flags stack: +25 total', () => {
    const base = computeConvergenceSelfHealingScore(lowState);
    const withBoth = computeConvergenceSelfHealingScore(
      lowState,
      { hasConvergenceProof: true, hasE2EConvergenceTest: true },
    );
    assert.strictEqual(withBoth - base, 25);
  });

  it('score is capped at 95 even with all state signals + both bonuses', () => {
    // All state: 30+25+15+15+10=95, plus evidence 15+10=25 → 120 → capped 95
    const score = computeConvergenceSelfHealingScore(
      makeMinimalState({
        lastVerifyStatus: 'pass',
        autoforgeFailedAttempts: 1,
        autoforgeEnabled: true,
        auditLog: Array(15).fill('e'),
      }),
      { hasConvergenceProof: true, hasE2EConvergenceTest: true },
    );
    assert.strictEqual(score, 95);
  });

  it('undefined flags behave same as all-false', () => {
    const noFlags = computeConvergenceSelfHealingScore(makeMinimalState());
    const falseFlags = computeConvergenceSelfHealingScore(
      makeMinimalState(),
      { hasConvergenceProof: false, hasE2EConvergenceTest: false },
    );
    assert.strictEqual(noFlags, falseFlags);
  });
});

// ── computeHarshScore convergence detection via _readConvergenceProof ─────────

describe('computeHarshScore convergence detection via _readConvergenceProof', () => {
  // Use constitution stage (stageIndex=2) so convergence base doesn't pre-cap at 95
  const lowStateLowStage = async () => makeMinimalState({
    workflowStage: 'initialized',
    lastVerifyStatus: 'unknown',
    autoforgeEnabled: false,
    autoforgeFailedAttempts: 0,
    auditLog: [],
  });

  it('gains proof bonus when _readConvergenceProof returns hasConvergenceProof=true', async () => {
    const withProof = await computeHarshScore(makeHarshOptions({
      _loadState: lowStateLowStage,
      _readConvergenceProof: async () => ({ hasConvergenceProof: true, hasE2EConvergenceTest: false }),
    }));
    const withoutProof = await computeHarshScore(makeHarshOptions({
      _loadState: lowStateLowStage,
      _readConvergenceProof: async () => ({ hasConvergenceProof: false, hasE2EConvergenceTest: false }),
    }));
    assert.ok(
      withProof.dimensions.convergenceSelfHealing > withoutProof.dimensions.convergenceSelfHealing,
      'proof should raise convergenceSelfHealing score',
    );
    assert.strictEqual(
      withProof.dimensions.convergenceSelfHealing - withoutProof.dimensions.convergenceSelfHealing,
      15,
    );
  });

  it('gains E2E test bonus when _readConvergenceProof returns hasE2EConvergenceTest=true', async () => {
    const withTest = await computeHarshScore(makeHarshOptions({
      _loadState: lowStateLowStage,
      _readConvergenceProof: async () => ({ hasConvergenceProof: false, hasE2EConvergenceTest: true }),
    }));
    const withoutTest = await computeHarshScore(makeHarshOptions({
      _loadState: lowStateLowStage,
      _readConvergenceProof: async () => ({ hasConvergenceProof: false, hasE2EConvergenceTest: false }),
    }));
    assert.strictEqual(
      withTest.dimensions.convergenceSelfHealing - withoutTest.dimensions.convergenceSelfHealing,
      10,
    );
  });

  it('reaches 95 when all state signals + both evidence flags', async () => {
    const result = await computeHarshScore(makeHarshOptions({
      _loadState: async () => makeMinimalState({
        lastVerifyStatus: 'pass',
        autoforgeFailedAttempts: 2,
        autoforgeEnabled: true,
        auditLog: Array(15).fill('| verify: passed'),
      }),
      _readConvergenceProof: async () => ({ hasConvergenceProof: true, hasE2EConvergenceTest: true }),
    }));
    assert.strictEqual(result.dimensions.convergenceSelfHealing, 95);
  });

  it('convergenceSelfHealing unaffected when _readConvergenceProof returns all-false', async () => {
    const withFalse = await computeHarshScore(makeHarshOptions({
      _readConvergenceProof: async () => ({ hasConvergenceProof: false, hasE2EConvergenceTest: false }),
    }));
    const withDefault = await computeHarshScore(makeHarshOptions());
    assert.strictEqual(
      withFalse.dimensions.convergenceSelfHealing,
      withDefault.dimensions.convergenceSelfHealing,
    );
  });
});
