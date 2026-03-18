// AutoForge tests — all 6 scenarios, circuit breaker, dry-run, maxWaves, frontend detection
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { planAutoForge, type AutoForgeInput } from '../src/core/autoforge.js';
import type { DanteState } from '../src/core/state.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    created: new Date().toISOString(),
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    gateResults: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<AutoForgeInput> = {}): AutoForgeInput {
  return {
    state: makeState(),
    hasDesignOp: false,
    hasUI: false,
    memoryEntryCount: 0,
    lastMemoryAge: null,
    failedAttempts: 0,
    designViolationCount: 0,
    ...overrides,
  };
}

describe('planAutoForge', () => {
  describe('Scenario 1: Circuit Breaker', () => {
    it('triggers doctor after 3 failed attempts', () => {
      const plan = planAutoForge(makeInput({ failedAttempts: 3 }));
      assert.strictEqual(plan.scenario, 'stuck-looping');
      assert.strictEqual(plan.steps.length, 1);
      assert.strictEqual(plan.steps[0].command, 'doctor');
    });

    it('triggers at exactly 3 failures', () => {
      const plan = planAutoForge(makeInput({ failedAttempts: 3 }));
      assert.strictEqual(plan.scenario, 'stuck-looping');
    });

    it('does not trigger at 2 failures', () => {
      const plan = planAutoForge(makeInput({ failedAttempts: 2 }));
      assert.notStrictEqual(plan.scenario, 'stuck-looping');
    });
  });

  describe('Scenario 2: Cold Start', () => {
    it('generates full pipeline for fresh project without UI', () => {
      const plan = planAutoForge(makeInput());
      assert.strictEqual(plan.scenario, 'cold-start');
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('review'));
      assert.ok(commands.includes('constitution'));
      assert.ok(commands.includes('specify'));
      assert.ok(commands.includes('plan'));
      assert.ok(commands.includes('tasks'));
      assert.ok(commands.includes('forge'));
      assert.ok(commands.includes('verify'));
      assert.ok(!commands.includes('design'), 'No design for non-UI project');
    });

    it('includes design + ux-refine for UI projects', () => {
      const plan = planAutoForge(makeInput({ hasUI: true }));
      assert.strictEqual(plan.scenario, 'cold-start');
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('design'));
      assert.ok(commands.includes('ux-refine'));
    });
  });

  describe('Scenario 3: Multi-Session Resume', () => {
    it('starts with review when last session was > 24h ago', () => {
      const plan = planAutoForge(makeInput({
        memoryEntryCount: 5,
        lastMemoryAge: 48, // 48 hours
        state: makeState({ workflowStage: 'tasks' }),
      }));
      assert.strictEqual(plan.scenario, 'multi-session-resume');
      assert.strictEqual(plan.steps[0].command, 'review');
    });
  });

  describe('Scenario 4: Stalled', () => {
    it('triggers doctor when no next steps available', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'unknown-stage' as DanteState['workflowStage'] }),
      }));
      assert.strictEqual(plan.steps.length, 1);
      assert.strictEqual(plan.steps[0].command, 'doctor');
    });
  });

  describe('Scenario 5: Frontend', () => {
    it('prepends ux-refine when design violations exist', () => {
      const plan = planAutoForge(makeInput({
        hasDesignOp: true,
        hasUI: true,
        designViolationCount: 5,
        state: makeState({ workflowStage: 'forge' }),
      }));
      assert.strictEqual(plan.scenario, 'frontend');
      assert.strictEqual(plan.steps[0].command, 'ux-refine');
    });
  });

  describe('Scenario 6: Mid-Project', () => {
    it('advances from tasks to forge', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'tasks', constitution: 'test' }),
      }));
      assert.strictEqual(plan.scenario, 'mid-project');
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('forge'));
    });

    it('advances from forge to verify', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'forge', constitution: 'test' }),
      }));
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('verify'));
    });

    it('advances from verify to synthesize', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'verify', constitution: 'test' }),
      }));
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('synthesize'));
    });

    it('treats synthesize as terminal with no further steps', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'synthesize', constitution: 'test' }),
      }));
      assert.strictEqual(plan.steps.length, 0);
      assert.match(plan.reasoning, /complete/i);
    });

    it('adds design step for UI project at tasks stage', () => {
      const plan = planAutoForge(makeInput({
        hasUI: true,
        state: makeState({ workflowStage: 'tasks', constitution: 'test' }),
      }));
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('design'));
    });
  });

  describe('maxWaves', () => {
    it('respects custom maxWaves', () => {
      const plan = planAutoForge(makeInput(), 5);
      assert.strictEqual(plan.maxWaves, 5);
    });

    it('defaults to 3 waves', () => {
      const plan = planAutoForge(makeInput());
      assert.strictEqual(plan.maxWaves, 3);
    });
  });
});
