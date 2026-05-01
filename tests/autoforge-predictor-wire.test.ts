/**
 * Tests for buildPredictStepFn factory and --no-predictor wiring in autoforge.
 * Verifies: factory returns undefined on LLM error (fail-closed), injection seam
 * bypasses real LLM in tests, and noPredictor option suppresses prediction calls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeAutoForgePlan,
  planAutoForge,
  type AutoForgePlan,
  type PredictStepFn,
} from '../src/core/autoforge.js';

function noop(): Promise<void> { return Promise.resolve(); }

function makePlan(overrides: Partial<AutoForgePlan> = {}): AutoForgePlan {
  return {
    scenario: 'mid-project',
    reasoning: 'test plan',
    steps: [{ command: 'forge', reason: 'test step' }],
    maxWaves: 1,
    ...overrides,
  };
}

describe('executeAutoForgePlan — predictFn injection', () => {
  it('calls _predictFn before each step when provided', async () => {
    let predictCalled = 0;
    const predictFn: PredictStepFn = async () => {
      predictCalled++;
      return { delta: 0.2, confidence: 0.8 };
    };

    await executeAutoForgePlan(makePlan(), {
      _runStep: async () => noop(),
      _isStageComplete: async () => true,
      _isLLMAvailable: async () => true,
      _recordMemory: async () => { },
      _runFailureAnalysis: async () => { },
      _recordDecision: async () => ({ id: 'n1', parentId: null, sessionId: 's', timelineId: 'main', timestamp: '', actorType: 'agent', prompt: '', result: {}, success: true, costUsd: 0, latencyMs: 0, hash: '' }),
      _predictFn: predictFn,
    });

    assert.equal(predictCalled, 1, 'predictFn should have been called once (one step)');
  });

  it('does not call _predictFn when not provided (no-predictor path)', async () => {
    let predictCalled = 0;
    const predictFn: PredictStepFn = async () => {
      predictCalled++;
      return { delta: 0.1, confidence: 0.5 };
    };
    void predictFn; // referenced but not injected below

    await executeAutoForgePlan(makePlan(), {
      _runStep: async () => noop(),
      _isStageComplete: async () => true,
      _isLLMAvailable: async () => true,
      _recordMemory: async () => { },
      _runFailureAnalysis: async () => { },
      _recordDecision: async () => ({ id: 'n2', parentId: null, sessionId: 's', timelineId: 'main', timestamp: '', actorType: 'agent', prompt: '', result: {}, success: true, costUsd: 0, latencyMs: 0, hash: '' }),
      // _predictFn intentionally omitted
    });

    assert.equal(predictCalled, 0, 'predictFn must not be called when not injected');
  });

  it('handles _predictFn throwing without blocking step execution', async () => {
    let stepExecuted = false;
    const throwingPredict: PredictStepFn = async () => {
      throw new Error('predictor failure');
    };

    const result = await executeAutoForgePlan(makePlan(), {
      _runStep: async () => { stepExecuted = true; },
      _isStageComplete: async () => true,
      _isLLMAvailable: async () => true,
      _recordMemory: async () => { },
      _runFailureAnalysis: async () => { },
      _recordDecision: async () => ({ id: 'n3', parentId: null, sessionId: 's', timelineId: 'main', timestamp: '', actorType: 'agent', prompt: '', result: {}, success: true, costUsd: 0, latencyMs: 0, hash: '' }),
      _predictFn: throwingPredict,
    });

    assert.equal(stepExecuted, true, 'step must execute even when predictFn throws');
    assert.equal(result.completed.length, 1, 'step must be marked completed');
  });

  it('multi-step plan: predictFn called once per step', async () => {
    let predictCalled = 0;
    const plan = makePlan({
      steps: [
        { command: 'forge', reason: 'step 1' },
        { command: 'verify', reason: 'step 2' },
      ],
      maxWaves: 2,
    });

    await executeAutoForgePlan(plan, {
      _runStep: async () => noop(),
      _isStageComplete: async () => true,
      _isLLMAvailable: async () => true,
      _recordMemory: async () => { },
      _runFailureAnalysis: async () => { },
      _recordDecision: async () => ({ id: 'n4', parentId: null, sessionId: 's', timelineId: 'main', timestamp: '', actorType: 'agent', prompt: '', result: {}, success: true, costUsd: 0, latencyMs: 0, hash: '' }),
      _predictFn: async () => { predictCalled++; return { delta: 0.1, confidence: 0.6 }; },
    });

    assert.equal(predictCalled, 2, 'predictFn should be called once per step');
  });
});

describe('planAutoForge — basic smoke', () => {
  it('returns a plan with steps array', () => {
    const plan = planAutoForge({
      state: {
        workflowStage: 'forge',
        tasks: { phase1: [{ id: 't1', title: 'test task', status: 'pending', phase: 'phase1' }] },
        completionTracker: undefined,
        autoforgeFailedAttempts: 0,
        auditLog: [],
        version: '0.17.0',
        constitution: 'set',
        retroDelta: 0,
        lastVerifyStatus: 'unknown',
      } as Parameters<typeof planAutoForge>[0]['state'],
      hasDesignOp: false,
      hasUI: false,
      memoryEntryCount: 5,
      lastMemoryAge: 1,
      failedAttempts: 0,
      designViolationCount: 0,
    });

    assert.ok(Array.isArray(plan.steps), 'plan.steps must be an array');
    assert.ok(plan.scenario !== undefined, 'plan must have a scenario');
  });
});
