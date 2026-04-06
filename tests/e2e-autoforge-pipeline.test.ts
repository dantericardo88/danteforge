// End-to-end autoforge pipeline tests — exercises the full plan→execute flow
// using injected runners (_runStep, _isStageComplete) for deterministic testing.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  analyzeProjectState,
  planAutoForge,
  executeAutoForgePlan,
} from '../src/core/autoforge.js';
import type { AutoForgeInput, AutoForgePlan } from '../src/core/autoforge.js';
import { loadState, saveState } from '../src/core/state.js';
import type { DanteState } from '../src/core/state.js';
import { assessComplexity, formatAssessment } from '../src/core/complexity-classifier.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempProject(overrides?: Partial<DanteState>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-'));
  tempDirs.push(dir);
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports'), { recursive: true });
  await fs.mkdir(path.join(stateDir, 'scores'), { recursive: true });

  const state: DanteState = {
    project: 'e2e-test',
    created: new Date().toISOString(),
    workflowStage: 'initialized' as DanteState['workflowStage'],
    currentPhase: 'phase-1',
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    gateResults: {},
    auditLog: [],
    ...overrides,
  } as DanteState;

  await saveState(state, { cwd: dir });
  return dir;
}

function makeInput(state: DanteState): AutoForgeInput {
  return {
    state,
    hasDesignOp: false,
    hasUI: false,
    memoryEntryCount: 0,
    lastMemoryAge: null,
    failedAttempts: 0,
    designViolationCount: 0,
  };
}

after(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('e2e autoforge pipeline', () => {
  it('cold-start scenario → planAutoForge → correct steps', async () => {
    const dir = await createTempProject();
    const state = await loadState({ cwd: dir });
    const input = makeInput(state);
    const plan = planAutoForge(input);

    assert.equal(plan.scenario, 'cold-start');
    assert.ok(plan.steps.length > 0, 'plan should have steps');
    assert.ok(plan.reasoning.length > 0, 'plan should have reasoning');
    assert.equal(plan.maxWaves, 3);
  });

  it('mid-project → plan → execute 2 steps → state updated', async () => {
    const dir = await createTempProject({
      workflowStage: 'specified' as DanteState['workflowStage'],
      currentPhase: 'phase-1',
      tasks: {
        'phase-1': [
          { name: 'Build auth module', files: ['src/auth.ts'], verify: 'npm test' },
        ],
      },
    });

    const state = await loadState({ cwd: dir });
    const input = makeInput(state);
    const plan = planAutoForge(input);

    // Execute with injected step runner
    const executedCommands: string[] = [];
    const result = await executeAutoForgePlan(plan, {
      cwd: dir,
      _runStep: async (command) => { executedCommands.push(command); },
      _isStageComplete: async () => true,
    });

    assert.ok(result.completed.length > 0, 'should complete at least one step');
    assert.equal(result.failed.length, 0, 'no steps should fail');

    // Verify state was updated
    const postState = await loadState({ cwd: dir });
    assert.equal(postState.autoforgeFailedAttempts, 0);
    assert.ok(postState.autoforgeLastRunAt, 'lastRunAt should be set');
  });

  it('execute step failure → autoforgeFailedAttempts incremented', async () => {
    const dir = await createTempProject({
      workflowStage: 'specified' as DanteState['workflowStage'],
    });

    const plan: AutoForgePlan = {
      scenario: 'pre-forge',
      reasoning: 'Test failure handling',
      steps: [
        { command: 'forge', reason: 'Build the feature' },
        { command: 'verify', reason: 'Verify the result' },
      ],
      maxWaves: 3,
    };

    const result = await executeAutoForgePlan(plan, {
      cwd: dir,
      _runStep: async (command) => {
        if (command === 'forge') throw new Error('Simulated forge failure');
      },
      _isStageComplete: async () => true,
    });

    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0], 'forge');
    assert.equal(result.completed.length, 0);

    const postState = await loadState({ cwd: dir });
    assert.equal(postState.autoforgeFailedAttempts, 1);
  });

  it('execute 3 steps with maxWaves=2 → pauses correctly', async () => {
    const dir = await createTempProject({
      workflowStage: 'specified' as DanteState['workflowStage'],
    });

    const plan: AutoForgePlan = {
      scenario: 'pre-forge',
      reasoning: 'Test checkpoint behavior',
      steps: [
        { command: 'plan', reason: 'Plan work' },
        { command: 'forge', reason: 'Build it' },
        { command: 'verify', reason: 'Check it' },
      ],
      maxWaves: 2,
    };

    const result = await executeAutoForgePlan(plan, {
      cwd: dir,
      _runStep: async () => {},
      _isStageComplete: async () => true,
    });

    assert.equal(result.paused, true, 'should pause after maxWaves');
    assert.equal(result.completed.length, 2, 'should complete exactly maxWaves steps');
    assert.equal(result.failed.length, 0);
  });

  it('circuit breaker fires after 3+ failed attempts', async () => {
    const dir = await createTempProject({
      autoforgeFailedAttempts: 3,
    } as Partial<DanteState>);

    const state = await loadState({ cwd: dir });
    const input = makeInput(state);
    input.failedAttempts = 3;

    const plan = planAutoForge(input);
    assert.equal(plan.scenario, 'stuck-looping');
    assert.ok(plan.reasoning.includes('Manual intervention'));
    assert.ok(plan.steps.some(s => s.command === 'doctor'));
  });

  it('dryRun executes no steps', async () => {
    const dir = await createTempProject();

    const plan: AutoForgePlan = {
      scenario: 'cold-start',
      reasoning: 'Dry run test',
      steps: [
        { command: 'constitution', reason: 'Set up' },
        { command: 'specify', reason: 'Spec it' },
      ],
      maxWaves: 3,
    };

    let stepCalled = false;
    const result = await executeAutoForgePlan(plan, {
      cwd: dir,
      dryRun: true,
      _runStep: async () => { stepCalled = true; },
      _isStageComplete: async () => true,
    });

    assert.equal(stepCalled, false, 'no step should be executed in dryRun');
    assert.equal(result.completed.length, 0);
    assert.equal(result.failed.length, 0);
    assert.equal(result.paused, false);
  });

  it('complexity assessment integrates with state tasks', async () => {
    const dir = await createTempProject({
      tasks: {
        'phase-1': [
          { name: 'Add API endpoint', files: ['src/api/routes.ts', 'src/db/schema.ts'], verify: 'npm test' },
          { name: 'Create module for authentication', files: ['src/auth/index.ts', 'src/auth/middleware.ts', 'src/auth/tokens.ts'], verify: 'npm test' },
        ],
      },
    });

    const state = await loadState({ cwd: dir });
    const tasks = state.tasks['phase-1']!;
    const assessment = assessComplexity(tasks, state);

    assert.ok(assessment.score > 0, 'score should be positive for multi-file tasks');
    assert.ok(assessment.signals.hasAPIChange, 'should detect API change');
    assert.ok(assessment.signals.hasNewModule, 'should detect new module');
    assert.ok(assessment.signals.hasTestRequirement, 'should detect test requirement');

    const formatted = formatAssessment(assessment);
    assert.ok(formatted.includes('Score:'), 'formatted output should include Score');
    assert.ok(formatted.includes('Preset:'), 'formatted output should include Preset');
  });

  it('full pipeline: plan → execute → verify state + audit + memory', async () => {
    const dir = await createTempProject({
      workflowStage: 'initialized' as DanteState['workflowStage'],
    });

    // Step 1: Plan
    const state = await loadState({ cwd: dir });
    const input = makeInput(state);
    const plan = planAutoForge(input);
    assert.ok(plan.steps.length > 0);

    // Step 2: Execute with injected runners
    const executedCommands: string[] = [];
    const result = await executeAutoForgePlan(plan, {
      cwd: dir,
      _runStep: async (command) => { executedCommands.push(command); },
      _isStageComplete: async () => true,
    });

    assert.ok(result.completed.length > 0, 'pipeline should complete steps');
    assert.equal(result.failed.length, 0, 'pipeline should have no failures');

    // Step 3: Verify state changes
    const postState = await loadState({ cwd: dir });
    // When paused=true, the reset block doesn't run, so only check when not paused
    if (!result.paused) {
      assert.equal(postState.autoforgeFailedAttempts, 0);
      assert.ok(postState.autoforgeLastRunAt, 'should have lastRunAt timestamp');
    }
    assert.ok(postState.auditLog.length > 0, 'audit log should have entries');

    // Verify executed commands match plan
    assert.deepEqual(
      executedCommands.slice(0, result.completed.length),
      result.completed,
      'executed commands should match completed list',
    );
  });
});
