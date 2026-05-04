// autoforge-unified.test.ts — Blade Group 7: autoforge new flags
// Tests: --target calls selfImproveFn, --adversarial calls adversarialScoreFn,
//        --resume calls loadCheckpointFn, --dimension focuses goal, plateau logs correctly

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { autoforge } from '../src/cli/commands/autoforge.js';

// Shared policy gate seam that always allows
const allowPolicy = async () => ({ allowed: true, requiresApproval: false, timestamp: '', reason: '' });

describe('autoforge — --target calls selfImproveFn', () => {
  it('dispatches to _selfImproveFn with target score', async () => {
    let capturedTarget: number | undefined;
    await autoforge(undefined, {
      target: 9.0,
      _policyGate: allowPolicy,
      _selfImproveFn: async (_g, minScore, _cwd) => {
        capturedTarget = minScore;
        return { finalScore: 9.1, plateauDetected: false };
      },
    });
    assert.equal(capturedTarget, 9.0, '--target should be passed to selfImproveFn as minScore');
  });

  it('does not call analyzeProjectState when --target is set', async () => {
    let analyzeCalled = false;
    await autoforge(undefined, {
      target: 8.5,
      _policyGate: allowPolicy,
      _selfImproveFn: async () => ({ finalScore: 8.6, plateauDetected: false }),
      _analyzeProjectState: async () => { analyzeCalled = true; return {} as never; },
    });
    assert.ok(!analyzeCalled, 'analyzeProjectState should not be called when --target is set');
  });
});

describe('autoforge — --adversarial calls adversarialScoreFn', () => {
  it('calls _adversarialScoreFn after selfImprove when --adversarial + --target', async () => {
    const order: string[] = [];
    await autoforge(undefined, {
      target: 9.0,
      adversarial: true,
      _policyGate: allowPolicy,
      _selfImproveFn: async () => { order.push('selfImprove'); return { finalScore: 9.0, plateauDetected: false }; },
      _adversarialScoreFn: async () => { order.push('adversarialScore'); return true; },
    });
    assert.deepEqual(order, ['selfImprove', 'adversarialScore']);
  });
});

describe('autoforge — --resume calls loadCheckpointFn', () => {
  it('calls _loadCheckpointFn when --resume is set', async () => {
    let checkpointCalled = false;
    await autoforge('improve', {
      resume: true,
      auto: true,
      _policyGate: allowPolicy,
      _loadCheckpointFn: async () => { checkpointCalled = true; return 'forge'; },
      _runLoop: async (ctx) => ctx,
    });
    assert.ok(checkpointCalled, '--resume should invoke _loadCheckpointFn');
  });
});

describe('autoforge — --dimension focuses goal', () => {
  it('prepends dimension to effectiveGoal passed to auto mode', async () => {
    let capturedGoal: string | undefined;
    await autoforge(undefined, {
      dimension: 'testing',
      auto: true,
      _policyGate: allowPolicy,
      _runLoop: async (ctx) => { capturedGoal = ctx.goal; return ctx; },
    });
    assert.ok(capturedGoal?.includes('testing'), '--dimension should appear in the goal passed to the loop');
  });
});

describe('autoforge — plateau handled gracefully', () => {
  it('completes without error when plateau is detected', async () => {
    await assert.doesNotReject(() => autoforge(undefined, {
      target: 9.5,
      _policyGate: allowPolicy,
      _selfImproveFn: async () => ({ finalScore: 7.0, plateauDetected: true }),
    }));
  });
});
