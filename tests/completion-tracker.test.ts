// Completion Tracker tests — phase completion conditions, overall %, projectedCompletion
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeCompletionTracker,
  computeProjectedCompletion,
  detectProjectType,
  type CompletionTracker,
} from '../src/core/completion-tracker.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    workflowStage: 'initialized',
    currentPhase: 1,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    ...overrides,
  };
}

function makeScoreResult(artifact: ScoredArtifact, score: number): ScoreResult {
  return {
    artifact,
    score,
    dimensions: {
      completeness: Math.round(score * 0.2),
      clarity: Math.round(score * 0.2),
      testability: Math.round(score * 0.2),
      constitutionAlignment: Math.round(score * 0.2),
      integrationFitness: Math.round(score * 0.1),
      freshness: Math.round(score * 0.1),
    },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: score >= 90 ? 'advance' : score >= 70 ? 'warn' : score >= 50 ? 'pause' : 'blocked',
    hasCEOReviewBonus: false,
  };
}

function makeAllScores(score: number): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScoreResult('CONSTITUTION', score),
    SPEC: makeScoreResult('SPEC', score),
    CLARIFY: makeScoreResult('CLARIFY', score),
    PLAN: makeScoreResult('PLAN', score),
    TASKS: makeScoreResult('TASKS', score),
  };
}

describe('computeCompletionTracker — phase completion conditions', () => {
  it('marks planning complete when all 5 artifacts score >= 70', () => {
    const tracker = computeCompletionTracker(makeState(), makeAllScores(82));
    assert.strictEqual(tracker.phases.planning.complete, true);
    assert.ok(tracker.phases.planning.score >= 70);
  });

  it('marks planning incomplete when any artifact scores < 70', () => {
    const scores = makeAllScores(82);
    scores.TASKS = makeScoreResult('TASKS', 65);
    const tracker = computeCompletionTracker(makeState(), scores);
    assert.strictEqual(tracker.phases.planning.complete, false);
  });

  it('computes execution score from wavesComplete / totalWaves', () => {
    const state = makeState({
      currentPhase: 2,
      tasks: { 1: [{ name: 'task1' }], 2: [{ name: 'task2' }], 3: [{ name: 'task3' }] },
    });
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    // wavesComplete = currentPhase - 1 = 1, totalWaves = 3 (from task phases)
    assert.strictEqual(tracker.phases.execution.wavesComplete, 1);
    assert.strictEqual(tracker.phases.execution.totalWaves, 3);
    assert.ok(tracker.phases.execution.score > 0);
  });

  it('counts the active wave as complete after the workflow reaches verify or synthesize', () => {
    const state = makeState({
      workflowStage: 'synthesize',
      currentPhase: 1,
      tasks: { 1: [{ name: 'task1' }] },
    });
    const tracker = computeCompletionTracker(state, makeAllScores(80));

    assert.strictEqual(tracker.phases.execution.wavesComplete, 1);
    assert.strictEqual(tracker.phases.execution.complete, true);
    assert.strictEqual(tracker.phases.execution.score, 100);
  });

  it('marks verification complete when verifier passes and qaScore >= 80 for web projects', () => {
    const state = makeState({
      lastVerifiedAt: new Date().toISOString(),
      lastVerifyStatus: 'pass',
      projectType: 'web',
      qaHealthScore: 87,
    } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.complete, true);
    assert.strictEqual(tracker.phases.verification.qaScore, 87);
  });

  it('marks verification incomplete when qaScore < 80 for web projects', () => {
    const state = makeState({
      lastVerifiedAt: new Date().toISOString(),
      lastVerifyStatus: 'pass',
      projectType: 'web',
      qaHealthScore: 60,
    } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.complete, false);
  });

  it('marks verification complete for non-web projects when tests pass', () => {
    const state = makeState({
      lastVerifiedAt: new Date().toISOString(),
      lastVerifyStatus: 'pass',
      projectType: 'cli',
    } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.complete, true);
  });

  it('overall = weighted average: planning 25% + execution 40% + verification 25% + synthesis 10%', () => {
    // All planning scores at 100 (complete)
    // Execution at 0% (currentPhase = 1, no waves done)
    // Verification incomplete (no lastVerifiedAt)
    // Synthesis incomplete
    const state = makeState({ currentPhase: 1 });
    const tracker = computeCompletionTracker(state, makeAllScores(100));
    // planning: 100 * 0.25 = 25
    // execution: 0 * 0.40 = 0
    // verification: 0 * 0.25 = 0
    // synthesis: 0 * 0.10 = 0
    // overall = 25
    assert.strictEqual(tracker.overall, 25);
  });

  it('is idempotent — calling twice produces identical output', () => {
    const state = makeState();
    const scores = makeAllScores(80);
    const t1 = computeCompletionTracker(state, scores);
    const t2 = computeCompletionTracker(state, scores);
    assert.strictEqual(t1.overall, t2.overall);
    assert.strictEqual(t1.phases.planning.complete, t2.phases.planning.complete);
    assert.strictEqual(t1.phases.execution.score, t2.phases.execution.score);
  });

  it('produces a projectedCompletion string', () => {
    const tracker = computeCompletionTracker(makeState(), makeAllScores(80));
    assert.ok(typeof tracker.projectedCompletion === 'string');
    assert.ok(tracker.projectedCompletion.length > 0);
  });

  it('returns "Ready for ship" when all phases complete', () => {
    const state = makeState({
      currentPhase: 4,
      tasks: { 1: [{ name: 't1' }], 2: [{ name: 't2' }], 3: [{ name: 't3' }] },
      lastVerifiedAt: new Date().toISOString(),
      lastVerifyStatus: 'pass',
      workflowStage: 'synthesize',
      retroDelta: 5,
    } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(95));
    assert.strictEqual(tracker.projectedCompletion, 'Ready for ship');
  });
});

describe('computeCompletionTracker — receipt-based testsPassing', () => {
  it('testsPassing is false when lastVerifyStatus is undefined', () => {
    const state = makeState({ projectType: 'cli' } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.testsPassing, false);
    assert.strictEqual(tracker.phases.verification.complete, false);
  });

  it('testsPassing is false when lastVerifyStatus is "fail"', () => {
    const state = makeState({ projectType: 'cli', lastVerifyStatus: 'fail' } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.testsPassing, false);
  });

  it('testsPassing is false when lastVerifyStatus is "warn"', () => {
    const state = makeState({ projectType: 'cli', lastVerifyStatus: 'warn' } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.testsPassing, false);
  });

  it('testsPassing is true when lastVerifyStatus is "pass"', () => {
    const state = makeState({ projectType: 'cli', lastVerifyStatus: 'pass' } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.testsPassing, true);
  });

  it('testsPassing is false even if lastVerifiedAt is set but lastVerifyStatus is "fail"', () => {
    const state = makeState({
      projectType: 'cli',
      lastVerifiedAt: new Date().toISOString(),
      lastVerifyStatus: 'fail',
    } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.testsPassing, false);
    assert.strictEqual(tracker.phases.verification.complete, false);
  });

  it('verificationComplete is false for web project when testsPassing is false despite high qaScore', () => {
    const state = makeState({
      projectType: 'web',
      qaHealthScore: 95,
      lastVerifyStatus: 'fail',
    } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.testsPassing, false);
    assert.strictEqual(tracker.phases.verification.complete, false);
  });

  it('verificationComplete is false for non-web project when lastVerifyStatus is "warn"', () => {
    const state = makeState({
      projectType: 'library',
      lastVerifyStatus: 'warn',
    } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.complete, false);
  });

  it('verification score is 0 for cli project when lastVerifyStatus is missing', () => {
    const state = makeState({ projectType: 'cli' } as Partial<DanteState>);
    const tracker = computeCompletionTracker(state, makeAllScores(80));
    assert.strictEqual(tracker.phases.verification.score, 0);
  });

  it('verification.testsPassing field matches receipt status, not presence of lastVerifiedAt', () => {
    const withTimestampOnly = makeState({
      projectType: 'cli',
      lastVerifiedAt: new Date().toISOString(),
    } as Partial<DanteState>);
    const withReceiptPass = makeState({
      projectType: 'cli',
      lastVerifyStatus: 'pass',
    } as Partial<DanteState>);

    const t1 = computeCompletionTracker(withTimestampOnly, makeAllScores(80));
    const t2 = computeCompletionTracker(withReceiptPass, makeAllScores(80));

    assert.strictEqual(t1.phases.verification.testsPassing, false);
    assert.strictEqual(t2.phases.verification.testsPassing, true);
  });
});

describe('detectProjectType', () => {
  it('prefers cli when a package exposes a bin even if it also has start scripts', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-project-type-'));

    try {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({
          name: 'danteforge',
          bin: {
            danteforge: './dist/index.js',
          },
          scripts: {
            start: 'node dist/index.js',
            dev: 'tsx src/cli/index.ts',
          },
        }),
        'utf8',
      );

      await assert.doesNotReject(async () => {
        const projectType = await detectProjectType(cwd);
        assert.strictEqual(projectType, 'cli');
      });
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
