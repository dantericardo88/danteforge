// Unit tests for pure helper functions exported from autoforge-loop.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findBlockedArtifacts,
  determineNextCommand,
  buildGuidance,
  findBottleneck,
  getRecommendationReason,
  computeEstimatedSteps,
  AutoforgeLoopState,
  type AutoforgeLoopContext,
  type BlockingIssue,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';

// ── Factory helpers ─────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-helpers',
    workflowStage: 'forge',
    currentPhase: 1,
    tasks: { 1: [{ name: 'task-a' }] },
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    projectType: 'cli',
    ...overrides,
  } as DanteState;
}

function makeTracker(overrides: Partial<CompletionTracker> = {}): CompletionTracker {
  return {
    overall: 50,
    phases: {
      planning: {
        score: 80,
        complete: true,
        artifacts: {
          CONSTITUTION: { score: 90, complete: true },
          SPEC: { score: 85, complete: true },
          CLARIFY: { score: 80, complete: true },
          PLAN: { score: 80, complete: true },
          TASKS: { score: 75, complete: true },
        },
      },
      execution: {
        score: 33,
        complete: false,
        currentPhase: 1,
        wavesComplete: 1,
        totalWaves: 3,
      },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: '2 more forge waves',
    ...overrides,
  } as CompletionTracker;
}

function makeScoreResult(artifact: ScoredArtifact, score: number, decision = 'advance'): ScoreResult {
  return {
    artifact,
    score,
    dimensions: {
      completeness: score,
      clarity: score,
      testability: score,
      constitutionAlignment: score,
      integrationFitness: score,
      freshness: score,
    },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: decision as ScoreResult['autoforgeDecision'],
    hasCEOReviewBonus: false,
  };
}

function makePassingScores(): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScoreResult('CONSTITUTION', 90),
    SPEC: makeScoreResult('SPEC', 85),
    CLARIFY: makeScoreResult('CLARIFY', 80),
    PLAN: makeScoreResult('PLAN', 80),
    TASKS: makeScoreResult('TASKS', 75),
  };
}

function makeBlockingScores(): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScoreResult('CONSTITUTION', 90),
    SPEC: makeScoreResult('SPEC', 30, 'blocked'),  // Below NEEDS_WORK (50)
    CLARIFY: makeScoreResult('CLARIFY', 80),
    PLAN: makeScoreResult('PLAN', 80),
    TASKS: makeScoreResult('TASKS', 75),
  };
}

function makeCtx(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  return {
    goal: 'test goal',
    cwd: '/tmp/test',
    state: makeState(),
    loopState: AutoforgeLoopState.IDLE,
    cycleCount: 0,
    startedAt: new Date().toISOString(),
    retryCounters: {},
    blockedArtifacts: [],
    lastGuidance: null,
    isWebProject: false,
    force: false,
    maxRetries: 3,
    ...overrides,
  };
}

// ── findBlockedArtifacts ────────────────────────────────────────────────────

describe('findBlockedArtifacts', () => {
  it('returns empty array when all scores above threshold', () => {
    const scores = makePassingScores();
    const result = findBlockedArtifacts(scores);
    assert.equal(result.length, 0);
  });

  it('returns blocking issues for scores below NEEDS_WORK', () => {
    const scores = makeBlockingScores();
    const result = findBlockedArtifacts(scores);
    assert.equal(result.length, 1);
    assert.equal(result[0].artifact, 'SPEC');
  });

  it('blocking issue has correct fields', () => {
    const scores = makeBlockingScores();
    const result = findBlockedArtifacts(scores);
    const issue = result[0];
    assert.equal(issue.artifact, 'SPEC');
    assert.equal(issue.score, 30);
    assert.equal(issue.decision, 'blocked');
    assert.ok(typeof issue.remediation === 'string');
    assert.ok(issue.remediation.length > 0);
  });

  it('remediation uses artifact command map', () => {
    const scores = makeBlockingScores();
    const result = findBlockedArtifacts(scores);
    const issue = result[0];
    // ARTIFACT_COMMAND_MAP.SPEC = 'specify --refine'
    assert.ok(issue.remediation.includes('specify'), `Expected remediation to include 'specify', got: ${issue.remediation}`);
  });
});

// ── determineNextCommand ────────────────────────────────────────────────────

describe('determineNextCommand', () => {
  it('returns planning command when planning incomplete and artifact below ACCEPTABLE', () => {
    const tracker = makeTracker({
      phases: {
        ...makeTracker().phases,
        planning: {
          score: 50,
          complete: false,
          artifacts: {
            CONSTITUTION: { score: 90, complete: true },
            SPEC: { score: 60, complete: false },  // Below ACCEPTABLE (70)
            CLARIFY: { score: 80, complete: true },
            PLAN: { score: 80, complete: true },
            TASKS: { score: 75, complete: true },
          },
        },
      },
    });
    const scores: Record<ScoredArtifact, ScoreResult> = {
      CONSTITUTION: makeScoreResult('CONSTITUTION', 90),
      SPEC: makeScoreResult('SPEC', 60),  // Below ACCEPTABLE (70)
      CLARIFY: makeScoreResult('CLARIFY', 80),
      PLAN: makeScoreResult('PLAN', 80),
      TASKS: makeScoreResult('TASKS', 75),
    };
    const state = makeState();
    const result = determineNextCommand(state, tracker, scores);
    assert.equal(result, 'specify --refine');
  });

  it('returns forge when planning complete but execution incomplete', () => {
    const tracker = makeTracker();  // Default: planning complete, execution incomplete
    const scores = makePassingScores();
    const state = makeState();
    const result = determineNextCommand(state, tracker, scores);
    assert.equal(result, 'forge');
  });

  it('returns verify when execution complete but verification incomplete', () => {
    const tracker = makeTracker({
      phases: {
        ...makeTracker().phases,
        execution: { score: 100, complete: true, currentPhase: 3, wavesComplete: 3, totalWaves: 3 },
        verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      },
    });
    const scores = makePassingScores();
    const state = makeState();
    const result = determineNextCommand(state, tracker, scores);
    assert.equal(result, 'verify');
  });

  it('returns synthesize when verification complete but synthesis incomplete', () => {
    const tracker = makeTracker({
      phases: {
        ...makeTracker().phases,
        execution: { score: 100, complete: true, currentPhase: 3, wavesComplete: 3, totalWaves: 3 },
        verification: { score: 100, complete: true, qaScore: 95, testsPassing: true },
        synthesis: { score: 0, complete: false, retroDelta: null },
      },
    });
    const scores = makePassingScores();
    const state = makeState();
    const result = determineNextCommand(state, tracker, scores);
    assert.equal(result, 'synthesize');
  });

  it('returns null when all phases complete', () => {
    const tracker = makeTracker({
      overall: 100,
      phases: {
        planning: {
          score: 100,
          complete: true,
          artifacts: {
            CONSTITUTION: { score: 95, complete: true },
            SPEC: { score: 95, complete: true },
            CLARIFY: { score: 90, complete: true },
            PLAN: { score: 90, complete: true },
            TASKS: { score: 90, complete: true },
          },
        },
        execution: { score: 100, complete: true, currentPhase: 3, wavesComplete: 3, totalWaves: 3 },
        verification: { score: 100, complete: true, qaScore: 95, testsPassing: true },
        synthesis: { score: 100, complete: true, retroDelta: 5 },
      },
    });
    const scores = makePassingScores();
    const state = makeState();
    const result = determineNextCommand(state, tracker, scores);
    assert.equal(result, null);
  });
});

// ── findBottleneck ──────────────────────────────────────────────────────────

describe('findBottleneck', () => {
  it('returns lowest artifact when blocked', () => {
    const scores = makeBlockingScores();
    const tracker = makeTracker();
    const result = findBottleneck(tracker, scores);
    assert.ok(result.includes('SPEC'), `Expected bottleneck to include 'SPEC', got: ${result}`);
  });

  it('returns planning phase message when incomplete but not blocked', () => {
    const scores: Record<ScoredArtifact, ScoreResult> = {
      CONSTITUTION: makeScoreResult('CONSTITUTION', 90),
      SPEC: makeScoreResult('SPEC', 55),  // Above NEEDS_WORK (50) but below ACCEPTABLE
      CLARIFY: makeScoreResult('CLARIFY', 80),
      PLAN: makeScoreResult('PLAN', 80),
      TASKS: makeScoreResult('TASKS', 75),
    };
    const tracker = makeTracker({
      phases: {
        ...makeTracker().phases,
        planning: {
          score: 60,
          complete: false,
          artifacts: {
            CONSTITUTION: { score: 90, complete: true },
            SPEC: { score: 55, complete: false },
            CLARIFY: { score: 80, complete: true },
            PLAN: { score: 80, complete: true },
            TASKS: { score: 75, complete: true },
          },
        },
      },
    });
    const result = findBottleneck(tracker, scores);
    assert.equal(result, 'Planning phase incomplete');
  });

  it('returns None when all complete', () => {
    const scores = makePassingScores();
    const tracker = makeTracker({
      overall: 100,
      phases: {
        planning: {
          score: 100,
          complete: true,
          artifacts: {
            CONSTITUTION: { score: 95, complete: true },
            SPEC: { score: 95, complete: true },
            CLARIFY: { score: 90, complete: true },
            PLAN: { score: 90, complete: true },
            TASKS: { score: 90, complete: true },
          },
        },
        execution: { score: 100, complete: true, currentPhase: 3, wavesComplete: 3, totalWaves: 3 },
        verification: { score: 100, complete: true, qaScore: 95, testsPassing: true },
        synthesis: { score: 100, complete: true, retroDelta: 5 },
      },
    });
    const result = findBottleneck(tracker, scores);
    assert.equal(result, 'None');
  });
});

// ── buildGuidance ───────────────────────────────────────────────────────────

describe('buildGuidance', () => {
  it('returns correct overallCompletion', () => {
    const tracker = makeTracker({ overall: 65 });
    const scores = makePassingScores();
    const ctx = makeCtx();
    const guidance = buildGuidance(tracker, scores, ctx);
    assert.equal(guidance.overallCompletion, 65);
  });

  it('autoAdvanceEligible true when no blocking and below threshold', () => {
    const tracker = makeTracker({ overall: 60 });
    const scores = makePassingScores();  // All passing, no blocked
    const ctx = makeCtx();
    const guidance = buildGuidance(tracker, scores, ctx);
    assert.equal(guidance.autoAdvanceEligible, true);
  });

  it('autoAdvanceBlockReason set when blocking issues', () => {
    const tracker = makeTracker({ overall: 40 });
    const scores = makeBlockingScores();  // SPEC is blocked at 30
    const ctx = makeCtx();
    const guidance = buildGuidance(tracker, scores, ctx);
    assert.equal(guidance.autoAdvanceEligible, false);
    assert.ok(typeof guidance.autoAdvanceBlockReason === 'string');
    assert.ok(guidance.autoAdvanceBlockReason!.includes('below score threshold'),
      `Expected block reason to mention threshold, got: ${guidance.autoAdvanceBlockReason}`);
  });
});

// ── getRecommendationReason ─────────────────────────────────────────────────

describe('getRecommendationReason', () => {
  it('returns remediation message with blocking issues', () => {
    const blockingIssues: BlockingIssue[] = [
      { artifact: 'SPEC', score: 30, decision: 'blocked', remediation: 'danteforge specify --refine' },
      { artifact: 'PLAN', score: 40, decision: 'blocked', remediation: 'danteforge plan --refine' },
    ];
    const tracker = makeTracker();
    const result = getRecommendationReason(tracker, blockingIssues);
    assert.ok(result.includes('remediation'), `Expected reason to include 'remediation', got: ${result}`);
  });

  it('returns phase message with no blocking issues', () => {
    const tracker = makeTracker({
      phases: {
        ...makeTracker().phases,
        planning: {
          score: 50,
          complete: false,
          artifacts: {
            CONSTITUTION: { score: 90, complete: true },
            SPEC: { score: 60, complete: false },
            CLARIFY: { score: 80, complete: true },
            PLAN: { score: 80, complete: true },
            TASKS: { score: 75, complete: true },
          },
        },
      },
    });
    const result = getRecommendationReason(tracker, []);
    assert.ok(result.includes('planning'), `Expected reason to mention planning, got: ${result}`);
  });
});

// ── computeEstimatedSteps ───────────────────────────────────────────────────

describe('computeEstimatedSteps', () => {
  it('returns pipeline length when no completionTracker', () => {
    const ctx = makeCtx({ state: makeState() });  // No completionTracker on state
    const result = computeEstimatedSteps(ctx);
    assert.equal(result, 9);  // PIPELINE_STAGES.length
  });
});
