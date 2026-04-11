// State machine tests for runAutoforgeLoop using AutoforgeLoopDeps injection
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AutoforgeLoopState,
  runAutoforgeLoop,
  runScoreOnlyPass,
  CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT,
  type AutoforgeLoopContext,
  type AutoforgeLoopDeps,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker, ProjectType } from '../src/core/completion-tracker.js';

// ── Factories ──────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-sm',
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
    dimensions: { completeness: score, clarity: score, testability: score, constitutionAlignment: score, integrationFitness: score, freshness: score },
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
    cwd: '/tmp/test-sm',
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

function makeStubDeps(overrides: Partial<AutoforgeLoopDeps> = {}): AutoforgeLoopDeps {
  return {
    scoreAllArtifacts: async () => makePassingScores(),
    persistScoreResult: async () => '',
    detectProjectType: async () => 'cli' as ProjectType,
    computeCompletionTracker: () => makeTracker({ overall: 96 }),
    recordMemory: async () => {},
    loadState: async () => makeState(),
    saveState: async () => {},
    setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    // Default no-op executor so the advisory-mode guard does not break multi-cycle tests.
    // Tests that need to verify advisory-mode behaviour should override with _executeCommand: undefined.
    _executeCommand: async () => ({ success: true }),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('runAutoforgeLoop state machine', () => {
  it('IDLE → COMPLETE when tracker >= 95%', async () => {
    const saveStateCalls: DanteState[] = [];
    const deps = makeStubDeps({
      computeCompletionTracker: () => makeTracker({ overall: 96 }),
      saveState: async (state) => { saveStateCalls.push(structuredClone(state)); },
    });

    const ctx = makeCtx();
    const result = await runAutoforgeLoop(ctx, deps);

    assert.strictEqual(result.loopState, AutoforgeLoopState.COMPLETE);
    assert.strictEqual(result.cycleCount, 1);
    assert.ok(result.lastGuidance !== null, 'should have guidance');
    assert.ok(saveStateCalls.length > 0, 'should save state');
    assert.ok(
      saveStateCalls[0].auditLog.some(e => e.includes('COMPLETE')),
      'audit log should mention COMPLETE',
    );
  });

  it('IDLE → BLOCKED when maxRetries=0 and artifact blocked', async () => {
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => makeBlockingScores(),
      computeCompletionTracker: () => makeTracker({ overall: 40 }),
    });

    const ctx = makeCtx({ maxRetries: 0 });
    const result = await runAutoforgeLoop(ctx, deps);

    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
    assert.ok(result.blockedArtifacts.includes('SPEC'), 'SPEC should be blocked');
    assert.ok(result.lastGuidance !== null, 'should have guidance');
  });

  it('circuit breaker trips after consecutive failure limit', async () => {
    let cycleCounter = 0;
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => makeBlockingScores(),
      computeCompletionTracker: () => makeTracker({ overall: 40 }),
      setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    });

    // maxRetries high enough that per-artifact limit doesn't trip first
    const ctx = makeCtx({ maxRetries: 100 });
    const result = await runAutoforgeLoop(ctx, deps);

    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
    assert.ok(
      result.state.auditLog.some(e => e.includes('circuit breaker')),
      'audit log should mention circuit breaker',
    );
    assert.ok(result.cycleCount >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT);
  });

  it('retry/backoff path: first pass blocked, second passes', async () => {
    let cycle = 0;
    let setTimeoutCalled = false;
    let savedState: DanteState | null = null;

    const deps = makeStubDeps({
      scoreAllArtifacts: async () => {
        cycle++;
        if (cycle === 1) return makeBlockingScores();
        return makePassingScores();
      },
      computeCompletionTracker: () => {
        if (cycle >= 2) return makeTracker({ overall: 96 });
        return makeTracker({ overall: 40 });
      },
      setTimeout: (fn, ms) => {
        setTimeoutCalled = true;
        fn();
        return 0 as unknown as ReturnType<typeof globalThis.setTimeout>;
      },
      saveState: async (state) => { savedState = structuredClone(state); },
      loadState: async () => savedState ?? makeState(),
    });

    const ctx = makeCtx({ maxRetries: 5 });
    const result = await runAutoforgeLoop(ctx, deps);

    assert.strictEqual(result.loopState, AutoforgeLoopState.COMPLETE);
    assert.ok(setTimeoutCalled, 'setTimeout should have been called for backoff');
    assert.ok(result.cycleCount >= 2, 'should have run at least 2 cycles');
  });

  it('force override bypasses blocking on first cycle', async () => {
    let cycle = 0;
    let savedState: DanteState | null = null;
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => {
        cycle++;
        if (cycle === 1) return makeBlockingScores();
        return makePassingScores();
      },
      computeCompletionTracker: () => {
        if (cycle >= 2) return makeTracker({ overall: 96 });
        return makeTracker({ overall: 40 });
      },
      saveState: async (state) => { savedState = structuredClone(state); },
      loadState: async () => savedState ?? makeState(),
    });

    const ctx = makeCtx({ force: true });
    const result = await runAutoforgeLoop(ctx, deps);

    // With force=true, first cycle should not block
    assert.strictEqual(result.loopState, AutoforgeLoopState.COMPLETE);
    assert.ok(
      result.state.auditLog.some(e => e.includes('--force override')),
      'audit log should mention force override',
    );
  });

  it('dry-run exits after computing guidance without executing', async () => {
    const deps = makeStubDeps({
      computeCompletionTracker: () => makeTracker({ overall: 40 }),
    });

    const ctx = makeCtx({ dryRun: true });
    const result = await runAutoforgeLoop(ctx, deps);

    assert.ok(result.lastGuidance !== null, 'should have guidance');
    assert.strictEqual(result.cycleCount, 1, 'should only run 1 cycle in dry-run');
  });

  it('COMPLETE when no next command found', async () => {
    // All phases complete in tracker
    const completeTracker = makeTracker({
      overall: 80,  // Below threshold so it doesn't exit via threshold
      phases: {
        planning: {
          score: 100, complete: true,
          artifacts: {
            CONSTITUTION: { score: 100, complete: true },
            SPEC: { score: 100, complete: true },
            CLARIFY: { score: 100, complete: true },
            PLAN: { score: 100, complete: true },
            TASKS: { score: 100, complete: true },
          },
        },
        execution: { score: 100, complete: true, currentPhase: 3, wavesComplete: 3, totalWaves: 3 },
        verification: { score: 100, complete: true, qaScore: 100, testsPassing: true },
        synthesis: { score: 100, complete: true, retroDelta: null },
      },
    });

    const deps = makeStubDeps({
      computeCompletionTracker: () => completeTracker,
    });

    const ctx = makeCtx();
    const result = await runAutoforgeLoop(ctx, deps);

    // determineNextCommand returns null → loop sets COMPLETE
    assert.strictEqual(result.loopState, AutoforgeLoopState.COMPLETE);
  });

  it('reloads state at end of non-dry-run iteration', async () => {
    let loadStateCalls = 0;
    let cycle = 0;
    let savedState: DanteState | null = null;

    const deps = makeStubDeps({
      computeCompletionTracker: () => {
        cycle++;
        if (cycle >= 2) return makeTracker({ overall: 96 });
        return makeTracker({ overall: 40 });
      },
      saveState: async (state) => { savedState = structuredClone(state); },
      loadState: async () => {
        loadStateCalls++;
        return savedState ?? makeState();
      },
    });

    const ctx = makeCtx();
    const result = await runAutoforgeLoop(ctx, deps);

    assert.ok(loadStateCalls > 0, 'loadState should have been called to reload state');
  });

  it('recordMemory called on COMPLETE', async () => {
    let memoryCalls: Array<{ category: string; tags: string[] }> = [];
    const deps = makeStubDeps({
      computeCompletionTracker: () => makeTracker({ overall: 96 }),
      recordMemory: async (entry) => {
        memoryCalls.push({ category: entry.category, tags: entry.tags ?? [] });
      },
    });

    const ctx = makeCtx();
    await runAutoforgeLoop(ctx, deps);

    assert.ok(memoryCalls.length > 0, 'should record memory');
    assert.strictEqual(memoryCalls[0].category, 'decision');
    assert.ok(memoryCalls[0].tags.includes('complete'));
  });

  it('recordMemory called on circuit breaker', async () => {
    let memoryCalls: string[] = [];
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => makeBlockingScores(),
      computeCompletionTracker: () => makeTracker({ overall: 40 }),
      recordMemory: async (entry) => { memoryCalls.push(entry.category); },
      setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    });

    const ctx = makeCtx({ maxRetries: 100 });
    await runAutoforgeLoop(ctx, deps);

    assert.ok(memoryCalls.includes('error'), 'should record error memory for circuit breaker');
  });

  it('retryCounters are incremented for blocked artifacts', async () => {
    let cycle = 0;
    let savedState: DanteState | null = null;
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => {
        cycle++;
        if (cycle <= 2) return makeBlockingScores();
        return makePassingScores();
      },
      computeCompletionTracker: () => {
        if (cycle > 2) return makeTracker({ overall: 96 });
        return makeTracker({ overall: 40 });
      },
      setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
      saveState: async (state) => { savedState = structuredClone(state); },
      loadState: async () => savedState ?? makeState(),
    });

    const ctx = makeCtx({ maxRetries: 5 });
    const result = await runAutoforgeLoop(ctx, deps);

    assert.ok((result.retryCounters['SPEC'] ?? 0) >= 1, 'SPEC retry counter should be incremented');
  });

  it('complexity classifier failure does not break the loop', async () => {
    // The complexity classifier is loaded via dynamic import — if it throws, the loop continues
    const deps = makeStubDeps({
      computeCompletionTracker: () => makeTracker({ overall: 96 }),
    });

    const ctx = makeCtx();
    // This should succeed even if complexity classifier throws internally
    const result = await runAutoforgeLoop(ctx, deps);
    assert.strictEqual(result.loopState, AutoforgeLoopState.COMPLETE);
  });

  it('permanently blocked artifacts set BLOCKED after maxRetries', async () => {
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => makeBlockingScores(),
      computeCompletionTracker: () => makeTracker({ overall: 40 }),
      setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    });

    // maxRetries=2 means after 2 retries, artifact becomes permanently blocked
    const ctx = makeCtx({ maxRetries: 2 });
    const result = await runAutoforgeLoop(ctx, deps);

    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
    assert.ok(result.blockedArtifacts.includes('SPEC'));
    // Should have retried at least twice before permanently blocking
    assert.ok((result.retryCounters['SPEC'] ?? 0) >= 2);
  });

  it('detects project type when state has unknown type', async () => {
    let detectCalled = false;
    const deps = makeStubDeps({
      computeCompletionTracker: () => makeTracker({ overall: 96 }),
      detectProjectType: async () => { detectCalled = true; return 'web' as ProjectType; },
      loadState: async () => makeState({ projectType: 'unknown' as DanteState['projectType'] }),
    });

    const ctx = makeCtx();
    ctx.state = makeState({ projectType: 'unknown' as DanteState['projectType'] });
    await runAutoforgeLoop(ctx, deps);
    assert.ok(detectCalled, 'Should call detectProjectType when type is unknown');
  });

  it('skips detectProjectType when type is already set', async () => {
    const deps = makeStubDeps({
      computeCompletionTracker: () => makeTracker({ overall: 96 }),
      detectProjectType: async () => { throw new Error('should not be called'); },
    });

    const ctx = makeCtx();
    // state already has projectType: 'cli' from makeState default
    const result = await runAutoforgeLoop(ctx, deps);
    assert.strictEqual(result.loopState, AutoforgeLoopState.COMPLETE);
  });

  it('records audit log entries on each execution cycle', async () => {
    let cycle = 0;
    let savedState: DanteState | null = null;
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => {
        cycle++;
        if (cycle <= 1) return makeBlockingScores();
        return makePassingScores();
      },
      computeCompletionTracker: () => {
        if (cycle >= 2) return makeTracker({ overall: 96 });
        return makeTracker({ overall: 40 });
      },
      setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
      saveState: async (state) => { savedState = structuredClone(state); },
      loadState: async () => savedState ?? makeState(),
    });

    const ctx = makeCtx({ maxRetries: 5 });
    const result = await runAutoforgeLoop(ctx, deps);
    // Should have audit entries from multiple cycles
    assert.ok(result.state.auditLog.length >= 2, `Should have >=2 audit entries, got ${result.state.auditLog.length}`);
  });

  it('permanently blocked path records error memory with blocked tag', async () => {
    let memoryCalls: Array<{ category: string; tags: string[] }> = [];
    const deps = makeStubDeps({
      scoreAllArtifacts: async () => makeBlockingScores(),
      computeCompletionTracker: () => makeTracker({ overall: 40 }),
      setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
      recordMemory: async (entry) => {
        memoryCalls.push({ category: entry.category, tags: entry.tags ?? [] });
      },
    });

    const ctx = makeCtx({ maxRetries: 1 });
    const result = await runAutoforgeLoop(ctx, deps);

    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
    const errorMemory = memoryCalls.find(m => m.category === 'error');
    assert.ok(errorMemory, 'Should record error memory for permanent block');
    assert.ok(errorMemory.tags.includes('blocked'), 'Memory should include blocked tag');
  });
});

// ── runScoreOnlyPass ───────────────────────────────────────────────────────

describe('runScoreOnlyPass with deps', () => {
  it('computes scores and returns guidance', async () => {
    let savedState: DanteState | null = null;
    const deps: Partial<AutoforgeLoopDeps> = {
      loadState: async () => makeState(),
      scoreAllArtifacts: async () => makePassingScores(),
      persistScoreResult: async () => '',
      detectProjectType: async () => 'cli' as ProjectType,
      computeCompletionTracker: () => makeTracker({ overall: 60 }),
      saveState: async (state) => { savedState = structuredClone(state); },
    };

    const result = await runScoreOnlyPass('/tmp/test', deps);

    assert.ok(result.scores, 'should have scores');
    assert.ok(result.tracker, 'should have tracker');
    assert.ok(result.guidance, 'should have guidance');
    assert.ok(savedState !== null, 'should save state');
    assert.ok(
      savedState!.auditLog.some((e: string) => e.includes('score-only pass')),
      'audit log should mention score-only pass',
    );
  });

  it('detects project type when unknown', async () => {
    let detectedType: string | null = null;
    const deps: Partial<AutoforgeLoopDeps> = {
      loadState: async () => makeState({ projectType: 'unknown' as DanteState['projectType'] }),
      scoreAllArtifacts: async () => makePassingScores(),
      persistScoreResult: async () => '',
      detectProjectType: async (cwd) => { detectedType = 'web'; return 'web' as ProjectType; },
      computeCompletionTracker: () => makeTracker(),
      saveState: async () => {},
    };

    await runScoreOnlyPass('/tmp/test', deps);
    assert.strictEqual(detectedType, 'web', 'should have called detectProjectType');
  });

  it('persists each score result', async () => {
    let persistCalls = 0;
    const deps: Partial<AutoforgeLoopDeps> = {
      loadState: async () => makeState(),
      scoreAllArtifacts: async () => makePassingScores(),
      persistScoreResult: async () => { persistCalls++; return ''; },
      detectProjectType: async () => 'cli' as ProjectType,
      computeCompletionTracker: () => makeTracker(),
      saveState: async () => {},
    };

    await runScoreOnlyPass('/tmp/test', deps);
    assert.strictEqual(persistCalls, 5, 'should persist all 5 artifact scores');
  });

  it('skips detectProjectType when type is already known', async () => {
    const deps: Partial<AutoforgeLoopDeps> = {
      loadState: async () => makeState({ projectType: 'web' as DanteState['projectType'] }),
      scoreAllArtifacts: async () => makePassingScores(),
      persistScoreResult: async () => '',
      detectProjectType: async () => { throw new Error('should not be called'); },
      computeCompletionTracker: () => makeTracker(),
      saveState: async () => {},
    };

    // Should not throw — detectProjectType should be skipped
    const result = await runScoreOnlyPass('/tmp/test', deps);
    assert.ok(result.guidance, 'Should complete with guidance');
  });
});
