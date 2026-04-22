import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  runAutoforgeLoop,
  AutoforgeLoopState,
  type AutoforgeLoopContext,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';
import type { TerminationDecision } from '../src/core/termination-governor.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(): DanteState {
  return {
    project: 'test',
    workflowStage: 'forge',
    currentPhase: '1',
    tasks: {},
    auditLog: [],
    constitution: '',
    projectType: 'cli',
    lastVerifyStatus: undefined,
  } as unknown as DanteState;
}

function makeScores(): Record<ScoredArtifact, ScoreResult> {
  const score: ScoreResult = {
    artifact: 'SPEC',
    score: 50,
    decision: 'improve',
    autoforgeDecision: 'refine',
    remediation: '',
    timestamp: new Date().toISOString(),
  } as unknown as ScoreResult;
  return { SPEC: score } as Record<ScoredArtifact, ScoreResult>;
}

function makeTracker(overall = 60): CompletionTracker {
  return {
    overall,
    verdict: 'incomplete',
    projectedCompletion: '2026-05-01',
    testsPassing: true,
    specPresent: true,
    completionRationale: '',
    recommendation: 'refine',
    phases: {
      planning: { complete: true, score: overall },
      execution: { complete: true, score: overall },
      verification: { complete: true, score: overall },
      synthesis: { complete: true, score: overall },
    },
  } as unknown as CompletionTracker;
}

function makeCtx(): AutoforgeLoopContext {
  return {
    goal: 'test',
    cwd: process.cwd(),
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
    recentScores: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('termination-governor integration', () => {
  it('T1: terminate=true → loop exits BLOCKED (non-completion reason)', async () => {
    const ctx = makeCtx();
    let callCount = 0;

    const result = await runAutoforgeLoop(ctx, {
      scoreAllArtifacts: async () => makeScores(),
      persistScoreResult: async () => '',
      detectProjectType: async () => 'cli',
      computeCompletionTracker: () => makeTracker(60),
      recordMemory: async () => {},
      loadState: async () => makeState(),
      saveState: async () => {},
      setTimeout: (_fn, _ms) => 0 as unknown as ReturnType<typeof globalThis.setTimeout>,
      _writeLoopResult: async () => {},
      _evaluateTermination: async () => {
        callCount++;
        return { terminate: true, reason: 'diminishing_returns', confidence: 0.8 };
      },
    });

    assert.ok(callCount >= 1, 'evaluateTermination should be called');
    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
  });

  it('T2: governor terminate=true → loop exits BLOCKED, completion is via 95% threshold', async () => {
    // The governor runs after the threshold check. If score < 95%, threshold doesn't fire.
    // Governor returning terminate=true → BLOCKED exit.
    const ctx = makeCtx();

    const result = await runAutoforgeLoop(ctx, {
      scoreAllArtifacts: async () => makeScores(),
      persistScoreResult: async () => '',
      detectProjectType: async () => 'cli',
      computeCompletionTracker: () => makeTracker(60),
      recordMemory: async () => {},
      loadState: async () => makeState(),
      saveState: async () => {},
      setTimeout: (_fn, _ms) => 0 as unknown as ReturnType<typeof globalThis.setTimeout>,
      _writeLoopResult: async () => {},
      _evaluateTermination: async (): Promise<TerminationDecision> => ({
        terminate: true,
        reason: 'diminishing_returns: inconclusive repeated 3 cycles',
        confidence: 0.8,
      }),
    });

    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
  });

  it('T3: terminate=false → loop continues past governor (exits via threshold when score >= 95)', async () => {
    const ctx = makeCtx();
    // The governor runs AFTER the threshold check.
    // With score=60, threshold (95%) is not met → governor is called → returns false → loop continues.
    // Without _executeCommand the loop exits via advisory mode.
    let terminationCalls = 0;

    const result = await runAutoforgeLoop(ctx, {
      scoreAllArtifacts: async () => makeScores(),
      persistScoreResult: async () => '',
      detectProjectType: async () => 'cli',
      computeCompletionTracker: () => makeTracker(60),
      recordMemory: async () => {},
      loadState: async () => makeState(),
      saveState: async () => {},
      setTimeout: (_fn, _ms) => 0 as unknown as ReturnType<typeof globalThis.setTimeout>,
      _writeLoopResult: async () => {},
      _evaluateTermination: async (): Promise<TerminationDecision> => {
        terminationCalls++;
        return { terminate: false, reason: 'continue', confidence: 0.6 };
      },
      // No _executeCommand → advisory mode exits after one cycle
    });

    assert.ok(terminationCalls >= 1, 'evaluateTermination was called');
    // Loop exited by some other mechanism (advisory, nextCommand=null, etc.) — not by governor
    // The key invariant: governor returned terminate:false, so loop continued past the governor call
    assert.ok(terminationCalls > 0, 'Loop ran the governor at least once before exiting');
  });

  it('T4: _evaluateTermination injection overrides real function', async () => {
    const ctx = makeCtx();
    let injectedCalled = false;

    await runAutoforgeLoop(ctx, {
      scoreAllArtifacts: async () => makeScores(),
      persistScoreResult: async () => '',
      detectProjectType: async () => 'cli',
      computeCompletionTracker: () => makeTracker(60),
      recordMemory: async () => {},
      loadState: async () => makeState(),
      saveState: async () => {},
      setTimeout: (_fn, _ms) => 0 as unknown as ReturnType<typeof globalThis.setTimeout>,
      _writeLoopResult: async () => {},
      _evaluateTermination: async (): Promise<TerminationDecision> => {
        injectedCalled = true;
        return { terminate: true, reason: 'injected', confidence: 1.0 };
      },
    });

    assert.ok(injectedCalled, 'Injected _evaluateTermination was called');
  });

  it('T5: maxCycles is maxRetries * 5 (not raw maxRetries)', async () => {
    const ctx = makeCtx();
    ctx.maxRetries = 3;
    let capturedMaxCycles = 0;

    await runAutoforgeLoop(ctx, {
      scoreAllArtifacts: async () => makeScores(),
      persistScoreResult: async () => '',
      detectProjectType: async () => 'cli',
      computeCompletionTracker: () => makeTracker(60),
      recordMemory: async () => {},
      loadState: async () => makeState(),
      saveState: async () => {},
      setTimeout: (_fn, _ms) => 0 as unknown as ReturnType<typeof globalThis.setTimeout>,
      _writeLoopResult: async () => {},
      _evaluateTermination: async (tctx): Promise<TerminationDecision> => {
        capturedMaxCycles = tctx.maxCycles;
        return { terminate: true, reason: 'test', confidence: 1.0 };
      },
    });

    assert.strictEqual(capturedMaxCycles, 15, 'maxCycles should be maxRetries (3) * 5 = 15');
  });
});
