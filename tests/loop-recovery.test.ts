import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectRecoveryAction,
  inferFailureKind,
  formatRecoveryPlan,
  type RecoveryContext,
  type FailureKind,
} from '../src/core/loop-recovery.js';

function makeCtx(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    dimensionId: 'security',
    consecutiveFailures: 1,
    lastPatternCount: 5,
    lastScoreDelta: 0.1,
    cyclesWithoutProgress: 1,
    llmAvailable: true,
    ...overrides,
  };
}

describe('selectRecoveryAction', () => {
  it('returns wait-llm when LLM is unavailable regardless of failure kind', () => {
    const ctx = makeCtx({ llmAvailable: false });
    const action = selectRecoveryAction('zero-patterns', ctx);
    assert.equal(action.kind, 'wait-llm');
    assert.equal(action.urgency, 'critical');
  });

  it('returns retry-oss on first zero-patterns failure', () => {
    const ctx = makeCtx({ consecutiveFailures: 1 });
    const action = selectRecoveryAction('zero-patterns', ctx);
    assert.equal(action.kind, 'retry-oss');
    assert.equal(action.urgency, 'medium');
  });

  it('escalates to run-autoresearch after 2+ consecutive zero-pattern failures', () => {
    const ctx = makeCtx({ consecutiveFailures: 2 });
    const action = selectRecoveryAction('zero-patterns', ctx);
    assert.equal(action.kind, 'run-autoresearch');
    assert.equal(action.urgency, 'high');
    assert.ok(action.command?.includes('autoresearch'));
  });

  it('returns switch-dimension after 3+ forge failures', () => {
    const ctx = makeCtx({ consecutiveFailures: 3 });
    const action = selectRecoveryAction('forge-wave-failed', ctx);
    assert.equal(action.kind, 'switch-dimension');
  });

  it('returns run-autoresearch for score-no-progress after moderate cycles', () => {
    const ctx = makeCtx({ cyclesWithoutProgress: 3 });
    const action = selectRecoveryAction('score-no-progress', ctx);
    assert.equal(action.kind, 'run-autoresearch');
    assert.ok(action.command?.includes('autoresearch'));
  });

  it('escalates to halt-operator for prolonged no-progress', () => {
    const ctx = makeCtx({ cyclesWithoutProgress: 5 });
    const action = selectRecoveryAction('score-no-progress', ctx);
    assert.equal(action.kind, 'halt-operator');
    assert.equal(action.urgency, 'critical');
  });

  it('returns fix-capability-test for capability-test-fail', () => {
    const action = selectRecoveryAction('capability-test-fail', makeCtx());
    assert.equal(action.kind, 'fix-capability-test');
    assert.equal(action.urgency, 'critical');
  });

  it('returns validate-evidence for stale evidence', () => {
    const action = selectRecoveryAction('evidence-stale', makeCtx());
    assert.equal(action.kind, 'validate-evidence');
    assert.ok(action.command?.includes('validate'));
    assert.ok(action.command?.includes('--force-cold'));
  });

  it('returns halt-operator for unknown failure kind', () => {
    const action = selectRecoveryAction('unknown', makeCtx());
    assert.equal(action.kind, 'halt-operator');
  });
});

describe('inferFailureKind', () => {
  it('infers llm-unreachable when LLM is not available', () => {
    const kind = inferFailureKind({
      patternsFound: 0, forgeSucceeded: false,
      scoreDelta: 0, cyclesWithoutProgress: 0,
      capabilityTestFailed: false, llmAvailable: false,
    });
    assert.equal(kind, 'llm-unreachable');
  });

  it('infers capability-test-fail before zero-patterns', () => {
    const kind = inferFailureKind({
      patternsFound: 0, forgeSucceeded: false,
      scoreDelta: 0, cyclesWithoutProgress: 0,
      capabilityTestFailed: true, llmAvailable: true,
    });
    assert.equal(kind, 'capability-test-fail');
  });

  it('infers zero-patterns when patterns=0 and LLM ok', () => {
    const kind = inferFailureKind({
      patternsFound: 0, forgeSucceeded: false,
      scoreDelta: 0, cyclesWithoutProgress: 0,
      capabilityTestFailed: false, llmAvailable: true,
    });
    assert.equal(kind, 'zero-patterns');
  });

  it('infers forge-wave-failed when patterns>0 but forge failed', () => {
    const kind = inferFailureKind({
      patternsFound: 5, forgeSucceeded: false,
      scoreDelta: 0, cyclesWithoutProgress: 0,
      capabilityTestFailed: false, llmAvailable: true,
    });
    assert.equal(kind, 'forge-wave-failed');
  });

  it('infers synthesize-blocked when forge error contains "Synthesis is blocked"', () => {
    const kind = inferFailureKind({
      patternsFound: 5, forgeSucceeded: false,
      scoreDelta: 0, cyclesWithoutProgress: 0,
      capabilityTestFailed: false, llmAvailable: true,
      forgeError: 'Command failed: node dist/index.js magic test --yes\nSynthesis is blocked until verification succeeds.',
    });
    assert.equal(kind, 'synthesize-blocked');
  });

  it('infers score-no-progress after 3+ cycles of stall', () => {
    const kind = inferFailureKind({
      patternsFound: 5, forgeSucceeded: true,
      scoreDelta: 0.01, cyclesWithoutProgress: 3,
      capabilityTestFailed: false, llmAvailable: true,
    });
    assert.equal(kind, 'score-no-progress');
  });
});

describe('formatRecoveryPlan', () => {
  it('includes kind and urgency in output', () => {
    const action = selectRecoveryAction('zero-patterns', makeCtx({ consecutiveFailures: 2 }));
    const plan = formatRecoveryPlan(action);
    assert.ok(plan.includes('run-autoresearch'), `plan: ${plan}`);
    assert.ok(plan.includes('HIGH'), `plan: ${plan}`);
  });

  it('includes command when action has one', () => {
    const action = selectRecoveryAction('evidence-stale', makeCtx());
    const plan = formatRecoveryPlan(action);
    assert.ok(plan.includes('Command:'), `plan: ${plan}`);
    assert.ok(plan.includes('--force-cold'), `plan: ${plan}`);
  });
});
