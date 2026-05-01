import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAutoForgePlan, type AutoForgePlan } from '../src/core/autoforge.js';
import { recordDecision, getSession, _resetSession } from '../src/core/decision-node-recorder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<AutoForgePlan> = {}): AutoForgePlan {
  return {
    scenario: 'cold-start',
    reasoning: 'test reasoning',
    steps: [{ command: 'specify', reason: 'need a spec' }],
    maxWaves: 10,
    ...overrides,
  };
}

/** No-op injected dependencies that keep tests fast and isolated */
const noopRunStep = async (_command: string): Promise<void> => { /* no-op */ };
const noopMemory = async (): Promise<void> => { /* no-op */ };
const noopFailure = async (): Promise<void> => { /* no-op */ };
const alwaysComplete = async (): Promise<boolean> => true;
const llmUnavailable = async (): Promise<boolean> => false;

type RecordDecisionParams = Parameters<typeof recordDecision>[0];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autoforge decision-node recording', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'autoforge-recorder-test-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset the session singleton so each test gets a fresh session scoped to tmpDir
    _resetSession();
  });

  it('plan-start node is recorded with correct prompt', async () => {
    const captured: RecordDecisionParams[] = [];
    const mockRecorder = async (params: RecordDecisionParams) => {
      captured.push(params);
      return recordDecision(params);
    };

    const plan = makePlan({ scenario: 'cold-start', goal: 'build MVP' });

    await executeAutoForgePlan(plan, {
      cwd: tmpDir,
      _runStep: noopRunStep,
      _recordMemory: noopMemory,
      _runFailureAnalysis: noopFailure,
      _isStageComplete: alwaysComplete,
      _isLLMAvailable: llmUnavailable,
      _recordDecision: mockRecorder,
    });

    // The first captured call should be the plan-start node
    assert.ok(captured.length > 0, 'at least one recording should have been captured');
    const planStart = captured[0];
    assert.ok(
      planStart.prompt.includes('autoforge:'),
      `plan-start prompt should include "autoforge:", got: ${planStart.prompt}`,
    );
    assert.ok(
      planStart.prompt.includes(plan.scenario),
      `plan-start prompt should include scenario "${plan.scenario}", got: ${planStart.prompt}`,
    );
  });

  it('successful step creates a child node with success: true', async () => {
    const captured: RecordDecisionParams[] = [];
    const mockRecorder = async (params: RecordDecisionParams) => {
      captured.push(params);
      return recordDecision(params);
    };

    const plan = makePlan({
      scenario: 'mid-project',
      steps: [{ command: 'plan', reason: 'need a plan' }],
    });

    await executeAutoForgePlan(plan, {
      cwd: tmpDir,
      _runStep: noopRunStep,
      _recordMemory: noopMemory,
      _runFailureAnalysis: noopFailure,
      _isStageComplete: alwaysComplete,
      _isLLMAvailable: llmUnavailable,
      _recordDecision: mockRecorder,
    });

    const stepNode = captured.find((c) => c.prompt === 'plan');
    assert.ok(stepNode !== undefined, 'should have a node with prompt === step.command ("plan")');
    assert.strictEqual(stepNode!.success, true, 'step node success should be true');
  });

  it('failed step creates a node with success: false', async () => {
    const captured: RecordDecisionParams[] = [];
    const mockRecorder = async (params: RecordDecisionParams) => {
      captured.push(params);
      return recordDecision(params);
    };

    const throwingStep = async (_command: string): Promise<void> => {
      throw new Error('simulated step failure');
    };

    const plan = makePlan({
      scenario: 'stalled',
      steps: [{ command: 'forge', reason: 'try to forge' }],
    });

    await executeAutoForgePlan(plan, {
      cwd: tmpDir,
      _runStep: throwingStep,
      _recordMemory: noopMemory,
      _runFailureAnalysis: noopFailure,
      _isStageComplete: alwaysComplete,
      _isLLMAvailable: llmUnavailable,
      _recordDecision: mockRecorder,
    });

    const failNode = captured.find((c) => c.prompt === 'forge' && c.success === false);
    assert.ok(failNode !== undefined, 'should have a node with prompt === "forge" and success === false');
  });

  it('pre-execution prediction node recorded when _predictFn is provided', async () => {
    const captured: RecordDecisionParams[] = [];
    const mockRecorder = async (params: RecordDecisionParams) => {
      captured.push(params);
      return recordDecision(params);
    };

    const plan = makePlan({
      scenario: 'mid-project',
      steps: [{ command: 'forge', reason: 'build it' }],
    });

    await executeAutoForgePlan(plan, {
      cwd: tmpDir,
      _runStep: noopRunStep,
      _recordMemory: noopMemory,
      _runFailureAnalysis: noopFailure,
      _isStageComplete: alwaysComplete,
      _isLLMAvailable: llmUnavailable,
      _recordDecision: mockRecorder,
      _predictFn: async () => ({ delta: 0.3, confidence: 0.8 }),
    });

    const predNode = captured.find((c) => c.prompt === 'predict: forge');
    assert.ok(predNode !== undefined, 'should have a prediction node with prompt "predict: forge"');
    const predResult = predNode!.result as Record<string, unknown>;
    assert.ok('predicted' in predResult, 'prediction node result should have "predicted" field');

    // Execution node should chain from prediction node
    const execNode = captured.find((c) => c.prompt === 'forge' && c.success === true);
    assert.ok(execNode !== undefined, 'should have an execution node for the step');
    assert.ok(execNode!.parentNodeId !== undefined, 'execution node should have a parentNodeId');
  });

  it('completion node is recorded after all steps', async () => {
    const captured: RecordDecisionParams[] = [];
    const mockRecorder = async (params: RecordDecisionParams) => {
      captured.push(params);
      return recordDecision(params);
    };

    const plan = makePlan({ scenario: 'frontend' });

    await executeAutoForgePlan(plan, {
      cwd: tmpDir,
      _runStep: noopRunStep,
      _recordMemory: noopMemory,
      _runFailureAnalysis: noopFailure,
      _isStageComplete: alwaysComplete,
      _isLLMAvailable: llmUnavailable,
      _recordDecision: mockRecorder,
    });

    const completionNode = captured.find((c) => c.prompt.startsWith('autoforge-complete:'));
    assert.ok(
      completionNode !== undefined,
      'should have a completion node with prompt starting "autoforge-complete:"',
    );
    assert.ok(
      completionNode!.prompt.includes(plan.scenario),
      `completion node prompt should include scenario "${plan.scenario}", got: ${completionNode!.prompt}`,
    );
  });
});
