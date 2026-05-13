// Autoforge Loop — Time Machine auto-capture tests (isolated to avoid OOM in large test file)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  AutoforgeLoopState,
  runAutoforgeLoop,
  type AutoforgeLoopContext,
  type AutoforgeLoopDeps,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';
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
      execution: { score: 33, complete: false, currentPhase: 2, wavesComplete: 1, totalWaves: 3 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: '2 more forge waves + verify + synthesize',
    ...overrides,
  };
}

function makeContext(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  return {
    goal: 'build test app',
    cwd: '/tmp/test',
    state: overrides.state ?? makeState(),
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

function makeAllScores(score: number): Record<ScoredArtifact, ScoreResult> {
  const dims = {
    completeness: Math.round(score * 0.2),
    clarity: Math.round(score * 0.2),
    testability: Math.round(score * 0.2),
    constitutionAlignment: Math.round(score * 0.2),
    integrationFitness: Math.round(score * 0.1),
    freshness: Math.round(score * 0.1),
  };
  const makeOne = (a: ScoredArtifact): ScoreResult => ({
    artifact: a,
    score,
    dimensions: dims,
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: score >= 90 ? 'advance' : score >= 70 ? 'warn' : score >= 50 ? 'pause' : 'blocked',
    hasCEOReviewBonus: false,
  });
  return {
    CONSTITUTION: makeOne('CONSTITUTION'),
    SPEC: makeOne('SPEC'),
    CLARIFY: makeOne('CLARIFY'),
    PLAN: makeOne('PLAN'),
    TASKS: makeOne('TASKS'),
  };
}

function makeForgeReadyTracker(): CompletionTracker {
  return makeTracker({
    overall: 30,
    phases: {
      planning: {
        score: 85,
        complete: true,
        artifacts: {
          CONSTITUTION: { score: 90, complete: true },
          SPEC: { score: 85, complete: true },
          CLARIFY: { score: 85, complete: true },
          PLAN: { score: 85, complete: true },
          TASKS: { score: 80, complete: true },
        },
      },
      execution: { score: 0, complete: false, currentPhase: 1, wavesComplete: 0, totalWaves: 3 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
  });
}

function makeMockDeps(overrides: Partial<AutoforgeLoopDeps> = {}): AutoforgeLoopDeps {
  const tracker = makeForgeReadyTracker();
  const state = makeState({ currentPhase: 1, tasks: { 1: [{ name: 'task-a' }], 2: [{ name: 'task-b' }], 3: [{ name: 'task-c' }] } });
  return {
    scoreAllArtifacts: async () => makeAllScores(85),
    persistScoreResult: async () => '/tmp/score.json',
    detectProjectType: async () => 'cli',
    computeCompletionTracker: () => tracker,
    recordMemory: async () => {},
    loadState: async () => state,
    saveState: async () => {},
    setTimeout: (fn, _ms) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    _checkProtectedPaths: async () => ({ approved: true, blocked: [] }),
    _postWaveSanitize: async () => {},  // prevent dynamic import in tests
    ...overrides,
  };
}

describe('autoforge-loop Time Machine auto-capture', () => {
  it('calls _timeMachineCommit after a successful command execution', async () => {
    const captured: { cwd: string; paths: string[]; label: string }[] = [];
    const forgeStageState = makeState({ workflowStage: 'tasks', currentPhase: 1, tasks: { 1: [{ name: 'task-a' }] } });
    const ctx = makeContext({ state: forgeStageState });
    // First scoring call returns below-threshold so the loop executes a command;
    // second call returns above-threshold so the loop exits cleanly.
    let scoringCallCount = 0;
    await runAutoforgeLoop(ctx, makeMockDeps({
      loadState: async () => forgeStageState,
      _executeCommand: async () => ({ success: true }),
      computeCompletionTracker: () => {
        scoringCallCount++;
        return scoringCallCount === 1 ? makeForgeReadyTracker() : makeTracker({ overall: 96 });
      },
      _timeMachineCommit: async (opts) => { captured.push(opts); },
    }));
    assert.ok(captured.length >= 1, 'should capture at least one Time Machine snapshot per successful wave');
    assert.ok(
      captured[0]!.label.startsWith('auto-forge-loop-cycle-'),
      `label should be auto-forge-loop-cycle-N; got ${captured[0]!.label}`,
    );
  });

  it('does not call _timeMachineCommit when the command fails', async () => {
    const captured: unknown[] = [];
    const forgeStageState = makeState({ workflowStage: 'tasks', currentPhase: 1, tasks: { 1: [{ name: 'task-a' }] } });
    const ctx = makeContext({ state: forgeStageState });
    await runAutoforgeLoop(ctx, makeMockDeps({
      loadState: async () => forgeStageState,
      _executeCommand: async () => ({ success: false }),
      _timeMachineCommit: async () => { captured.push(true); },
    }));
    assert.strictEqual(captured.length, 0, 'no snapshot on failure');
  });
});
