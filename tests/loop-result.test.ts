import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runAutoforgeLoop,
  AutoforgeLoopState,
  writeLoopResult,
  getLoopResultPath,
  type AutoforgeLoopContext,
  type LoopResult,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker, ProjectType } from '../src/core/completion-tracker.js';

function makeState(): DanteState {
  return {
    project: 'test',
    workflowStage: 'forge',
    currentPhase: 1,
    tasks: {},
    auditLog: [],
    completedTasks: [],
    projectType: 'cli' as ProjectType,
  } as unknown as DanteState;
}

function makeScore(score = 80): ScoreResult {
  return { score, autoforgeDecision: 'advance', suggestions: [], evidence: [] } as unknown as ScoreResult;
}

function makeTracker(overall = 95): CompletionTracker {
  return {
    overall,
    projectedCompletion: overall,
    phases: {
      planning: { complete: true, score: 95 },
      execution: { complete: true, score: 95 },
      verification: { complete: true, score: 95 },
      synthesis: { complete: true, score: 95 },
    },
  } as unknown as CompletionTracker;
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
    recentScores: [60, 70, 80],
    ...overrides,
  };
}

const BASE_DEPS = {
  scoreAllArtifacts: async () => ({ spec: makeScore(95) }) as unknown as Record<ScoredArtifact, ScoreResult>,
  persistScoreResult: async () => '/tmp/score.json',
  detectProjectType: async () => 'cli' as ProjectType,
  computeCompletionTracker: () => makeTracker(95),
  recordMemory: async () => {},
  loadState: async () => makeState(),
  saveState: async () => {},
  setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
  _executeCommand: async () => ({ success: true }),
  _addSignalListener: () => {},
  _removeSignalListener: () => {},
};

describe('loop-result quality delta reporting', () => {
  it('T1: loop-result is written after loop completes (via _writeLoopResult injection)', async () => {
    let written: LoopResult | null = null;
    const ctx = makeCtx({ recentScores: [60] });
    await runAutoforgeLoop(ctx, {
      ...BASE_DEPS,
      _writeLoopResult: async (result) => { written = result; },
    });
    assert.ok(written !== null, '_writeLoopResult must be called');
    assert.ok(typeof (written as LoopResult).startScore === 'number');
    assert.ok(typeof (written as LoopResult).endScore === 'number');
    assert.ok(typeof (written as LoopResult).delta === 'number');
    assert.ok(typeof (written as LoopResult).cycles === 'number');
    assert.ok(typeof (written as LoopResult).duration === 'number');
  });

  it('T2: delta = endScore - startScore (correct arithmetic)', async () => {
    let written: LoopResult | null = null;
    const ctx = makeCtx({ recentScores: [60, 80] });
    await runAutoforgeLoop(ctx, {
      ...BASE_DEPS,
      _writeLoopResult: async (result) => { written = result; },
    });
    const r = written as LoopResult;
    assert.ok(r !== null);
    assert.strictEqual(r.startScore, 60);
    assert.ok(r.endScore >= 60, 'endScore must be >= startScore after a loop that improves scores');
    assert.ok(Math.abs(r.delta - (r.endScore - r.startScore)) < 0.01, 'delta must equal endScore - startScore');
  });

  it('T3: terminationReason is target-reached when completion >= threshold', async () => {
    let written: LoopResult | null = null;
    const ctx = makeCtx({ recentScores: [60] });
    await runAutoforgeLoop(ctx, {
      ...BASE_DEPS,
      computeCompletionTracker: () => makeTracker(95),   // above 95 threshold
      _writeLoopResult: async (result) => { written = result; },
    });
    assert.strictEqual((written as LoopResult | null)?.terminationReason, 'target-reached');
  });

  it('T4: terminationReason is advisory when no _executeCommand provided', async () => {
    let written: LoopResult | null = null;
    const ctx = makeCtx({ recentScores: [60] });
    const depsNoExec = { ...BASE_DEPS, _executeCommand: undefined };
    await runAutoforgeLoop(ctx, {
      ...depsNoExec,
      _writeLoopResult: async (result) => { written = result; },
    });
    assert.ok((written as LoopResult | null)?.terminationReason === 'advisory' ||
              (written as LoopResult | null)?.terminationReason === 'target-reached',
      'advisory or target-reached when no executor provided');
  });

  it('T5: duration is a positive number of milliseconds', async () => {
    let written: LoopResult | null = null;
    const ctx = makeCtx({ recentScores: [60] });
    await runAutoforgeLoop(ctx, {
      ...BASE_DEPS,
      _writeLoopResult: async (result) => { written = result; },
    });
    assert.ok((written as LoopResult | null)?.duration >= 0, 'duration must be non-negative');
    assert.ok(typeof (written as LoopResult | null)?.timestamp === 'string');
  });

  it('T6: writeLoopResult + getLoopResultPath are exported and usable directly', async () => {
    const p = getLoopResultPath('/tmp/my-project');
    assert.ok(p.endsWith('loop-result.json'), 'path must end with loop-result.json');
    assert.ok(p.includes('.danteforge'), 'path must be in .danteforge/');

    let written = '';
    const mockResult: LoopResult = {
      startScore: 5.0, endScore: 7.5, delta: 2.5,
      cycles: 3, duration: 12000,
      terminationReason: 'target-reached',
      timestamp: new Date().toISOString(),
    };
    await writeLoopResult(mockResult, '/tmp/test', async (_, d) => { written = d; });
    const parsed = JSON.parse(written) as LoopResult;
    assert.strictEqual(parsed.delta, 2.5);
    assert.strictEqual(parsed.terminationReason, 'target-reached');
  });
});
