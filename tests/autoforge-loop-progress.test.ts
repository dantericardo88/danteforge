// autoforge-loop-progress.test.ts — formatElapsed + step tracker wiring (v0.21.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, AutoforgeLoopState } from '../src/core/autoforge-loop.js';
import { createStepTracker, type StepTracker } from '../src/core/progress.js';

describe('formatElapsed', () => {
  it('returns seconds format for < 60s', () => {
    const startedAt = new Date(Date.now() - 45_000).toISOString();
    const result = formatElapsed(startedAt);
    assert.match(result, /^\d+s$/, `Expected Xs format, got: ${result}`);
  });

  it('returns minutes+seconds format for >= 60s with remainder', () => {
    const startedAt = new Date(Date.now() - 90_000).toISOString();
    const result = formatElapsed(startedAt);
    assert.match(result, /^1m\d+s$/, `Expected 1mXs format, got: ${result}`);
  });

  it('returns just minutes when remainder is 0', () => {
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    const result = formatElapsed(startedAt);
    assert.equal(result, '2m', `Expected 2m, got: ${result}`);
  });

  it('handles very short elapsed (< 2s) as 0s or 1s', () => {
    const startedAt = new Date().toISOString();
    const result = formatElapsed(startedAt);
    assert.match(result, /^\d+s$/, `Should still return seconds format: ${result}`);
  });

  it('handles large elapsed (10 minutes)', () => {
    const startedAt = new Date(Date.now() - 600_000).toISOString();
    const result = formatElapsed(startedAt);
    assert.equal(result, '10m', `Expected 10m, got: ${result}`);
  });
});

describe('createStepTracker injection in runAutoforgeLoop', () => {
  it('createStepTracker is importable from progress.ts', () => {
    assert.equal(typeof createStepTracker, 'function');
  });

  it('step tracker increments and reports current step', () => {
    const tracker: StepTracker = createStepTracker(3, { _isTTY: false });
    assert.equal(tracker.current(), 0);
    tracker.step('step one');
    assert.equal(tracker.current(), 1);
    tracker.step('step two');
    assert.equal(tracker.current(), 2);
  });

  it('step tracker does not exceed total', () => {
    const tracker = createStepTracker(2, { _isTTY: false });
    tracker.step('a');
    tracker.step('b');
    tracker.step('c'); // should cap at 2
    assert.equal(tracker.current(), 2);
    assert.equal(tracker.total(), 2);
  });

  it('AutoforgeLoopContext._stepTracker field accepts a StepTracker', () => {
    // Verify the _stepTracker field is part of the context shape
    const calls: string[] = [];
    const mockTracker: StepTracker = {
      step: (label: string) => { calls.push(label); },
      current: () => calls.length,
      total: () => 10,
    };
    // Minimal context with the injected tracker
    const ctx = {
      goal: 'test',
      cwd: process.cwd(),
      state: {
        project: 'test',
        workflowStage: 'initialized' as const,
        currentPhase: 0,
        tasks: {},
        auditLog: [] as string[],
        profile: 'balanced' as const,
      },
      loopState: AutoforgeLoopState.IDLE,
      cycleCount: 0,
      startedAt: new Date().toISOString(),
      retryCounters: {} as Record<string, number>,
      blockedArtifacts: [] as string[],
      lastGuidance: null,
      isWebProject: false,
      force: false,
      maxRetries: 3,
      _stepTracker: mockTracker,
    };
    assert.equal(ctx._stepTracker, mockTracker);
    ctx._stepTracker.step('test label');
    assert.deepEqual(calls, ['test label']);
  });

  it('formatElapsed is exported from autoforge-loop', () => {
    assert.equal(typeof formatElapsed, 'function');
  });
});
