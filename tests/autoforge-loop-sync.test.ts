// Autoforge Loop — context-sync hook tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AutoforgeLoopState,
  runAutoforgeLoop,
  type AutoforgeLoopContext,
  type AutoforgeLoopDeps,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker, ProjectType } from '../src/core/completion-tracker.js';

// ── Factories ──────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-sync',
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
    overall: 60,
    phases: {
      planning: {
        score: 90,
        complete: true,
        artifacts: {
          CONSTITUTION: { score: 90, complete: true },
          SPEC: { score: 85, complete: true },
          CLARIFY: { score: 80, complete: true },
          PLAN: { score: 80, complete: true },
          TASKS: { score: 75, complete: true },
        },
      },
      // execution is incomplete so determineNextCommand returns 'forge'
      execution: { score: 33, complete: false, currentPhase: 1, wavesComplete: 1, totalWaves: 3 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: '2 forge waves remaining',
    ...overrides,
  } as CompletionTracker;
}

function makeScoreResult(artifact: ScoredArtifact, score: number): ScoreResult {
  return {
    artifact,
    score,
    dimensions: { completeness: score, clarity: score, testability: score, constitutionAlignment: score, integrationFitness: score, freshness: score },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: 'advance' as ScoreResult['autoforgeDecision'],
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

function makeCtx(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  return {
    goal: 'test goal',
    cwd: '/tmp/test-sync',
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

/**
 * Deps that run one execution cycle (overall=60%) then complete (overall=96%).
 * This ensures the sync hook (which fires after execution) is reached.
 */
function makeStubDeps(overrides: Partial<AutoforgeLoopDeps> = {}): AutoforgeLoopDeps {
  let cycle = 0;
  return {
    scoreAllArtifacts: async () => makePassingScores(),
    persistScoreResult: async () => '',
    detectProjectType: async () => 'cli' as ProjectType,
    computeCompletionTracker: () => {
      cycle++;
      // First cycle: below threshold so execution happens; second cycle: complete
      return makeTracker({ overall: cycle === 1 ? 60 : 96 });
    },
    recordMemory: async () => {},
    loadState: async () => makeState(),
    saveState: async () => {},
    setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    _executeCommand: async () => ({ success: true }),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('autoforge-loop context-sync hook', () => {
  it('_syncContext is called when .cursor directory exists', async () => {
    let syncCalled = false;
    let syncOpts: { cwd: string; target: 'cursor' } | undefined;

    const deps = makeStubDeps({
      _existsSync: () => true,
      _syncContext: async (opts) => {
        syncCalled = true;
        syncOpts = opts;
      },
    });

    const ctx = makeCtx();
    await runAutoforgeLoop(ctx, deps);

    assert.ok(syncCalled, '_syncContext should have been called');
    assert.strictEqual(syncOpts?.target, 'cursor');
    assert.ok(syncOpts?.cwd !== undefined);
  });

  it('_syncContext is NOT called when .cursor directory is absent', async () => {
    let syncCalled = false;

    const deps = makeStubDeps({
      _existsSync: () => false,
      _syncContext: async () => {
        syncCalled = true;
      },
    });

    const ctx = makeCtx();
    await runAutoforgeLoop(ctx, deps);

    assert.ok(!syncCalled, '_syncContext should NOT have been called when .cursor is absent');
  });

  it('_syncContext error does not block the loop', async () => {
    const deps = makeStubDeps({
      _existsSync: () => true,
      _syncContext: async () => {
        throw new Error('sync failed');
      },
    });

    const ctx = makeCtx();
    // Should resolve without throwing
    const result = await runAutoforgeLoop(ctx, deps);
    assert.strictEqual(result.loopState, AutoforgeLoopState.COMPLETE);
  });

  it('_existsSync receives the correct .cursor path', async () => {
    const capturedPaths: string[] = [];

    const deps = makeStubDeps({
      _existsSync: (p) => {
        capturedPaths.push(p);
        return false;
      },
    });

    const ctx = makeCtx({ cwd: '/tmp/test-sync-path' });
    await runAutoforgeLoop(ctx, deps);

    const cursorPath = capturedPaths.find(p => p.endsWith('.cursor'));
    assert.ok(cursorPath !== undefined, 'Should have checked for .cursor path');
    assert.ok(cursorPath.endsWith('.cursor'), `Path should end with .cursor, got: ${cursorPath}`);
  });
});
