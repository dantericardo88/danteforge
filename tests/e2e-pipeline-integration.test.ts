// E2E pipeline integration test — exercises artifact creation + state transitions
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadState, saveState, recordWorkflowStage } from '../src/core/state.js';
import { planAutoForge, executeAutoForgePlan } from '../src/core/autoforge.js';
import type { AutoForgeInput, AutoForgePlan } from '../src/core/autoforge.js';
import type { DanteState } from '../src/core/state.js';

const tempDirs: string[] = [];

async function createProject(stage: DanteState['workflowStage'] = 'initialized', artifacts: string[] = []): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-e2e-pipe-'));
  tempDirs.push(dir);
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports'), { recursive: true });
  await fs.mkdir(path.join(stateDir, 'scores'), { recursive: true });

  for (const artifact of artifacts) {
    await fs.writeFile(path.join(stateDir, artifact), `# ${artifact}\nGenerated for testing.\n`);
  }

  const state: DanteState = {
    project: 'e2e-pipeline',
    workflowStage: stage,
    currentPhase: 1,
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    auditLog: [],
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

describe('E2E pipeline integration', () => {
  after(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('write SPEC.md + recordWorkflowStage → state is specify', async () => {
    const dir = await createProject('initialized', ['CONSTITUTION.md']);
    await fs.writeFile(path.join(dir, '.danteforge', 'SPEC.md'), '# Spec\nBuild a widget.\n');

    const state = await loadState({ cwd: dir });
    recordWorkflowStage(state, 'specify');
    await saveState(state, { cwd: dir });

    const reloaded = await loadState({ cwd: dir });
    assert.equal(reloaded.workflowStage, 'specify');
  });

  it('write PLAN.md + recordWorkflowStage → state is plan', async () => {
    const dir = await createProject('specify', ['CONSTITUTION.md', 'SPEC.md', 'CLARIFY.md']);
    await fs.writeFile(path.join(dir, '.danteforge', 'PLAN.md'), '# Plan\nPhase 1: Build.\n');

    const state = await loadState({ cwd: dir });
    recordWorkflowStage(state, 'plan');
    await saveState(state, { cwd: dir });

    const reloaded = await loadState({ cwd: dir });
    assert.equal(reloaded.workflowStage, 'plan');
  });

  it('write TASKS.md + save tasks → state is tasks with task data', async () => {
    const dir = await createProject('plan', ['CONSTITUTION.md', 'SPEC.md', 'CLARIFY.md', 'PLAN.md']);
    await fs.writeFile(path.join(dir, '.danteforge', 'TASKS.md'), '# Tasks\n- Build login page\n');

    const state = await loadState({ cwd: dir });
    recordWorkflowStage(state, 'tasks');
    state.tasks = { 1: [{ name: 'build-login', verify: 'check login page exists' }] };
    await saveState(state, { cwd: dir });

    const reloaded = await loadState({ cwd: dir });
    assert.equal(reloaded.workflowStage, 'tasks');
    assert.ok(reloaded.tasks[1]);
    assert.equal(reloaded.tasks[1]!.length, 1);
  });

  it('planAutoForge produces steps matching cold-start state', async () => {
    const dir = await createProject('initialized');
    const state = await loadState({ cwd: dir });
    const input = makeInput(state);
    const plan = planAutoForge(input, 5, 'Build a widget');

    assert.equal(plan.scenario, 'cold-start');
    assert.ok(plan.steps.length >= 1, 'Cold-start should have at least one step');
    assert.ok(plan.steps.some(s => s.command === 'constitution' || s.command === 'review'),
      'Cold-start should include constitution or review');
  });

  it('executeAutoForgePlan with injected _runStep completes successfully', async () => {
    const dir = await createProject('tasks', ['CONSTITUTION.md', 'SPEC.md', 'CLARIFY.md', 'PLAN.md', 'TASKS.md']);

    // Create a plan that has one forge step
    const plan: AutoForgePlan = {
      scenario: 'mid-project',
      reasoning: 'Test execution',
      steps: [{ command: 'forge', reason: 'Execute build wave' }],
      maxWaves: 3,
      goal: 'Build the feature',
    };

    const executedCommands: string[] = [];
    const result = await executeAutoForgePlan(plan, {
      cwd: dir,
      light: true,
      _runStep: async (command) => { executedCommands.push(command); },
      _isStageComplete: async () => true,
    });

    assert.ok(result.completed.includes('forge'), 'forge should be in completed');
    assert.equal(result.failed.length, 0, 'No steps should fail');
    assert.deepEqual(executedCommands, ['forge']);
  });
});
