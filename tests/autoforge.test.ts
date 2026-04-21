// AutoForge tests — all 6 scenarios, circuit breaker, dry-run, maxWaves, frontend detection
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { planAutoForge, executeAutoForgePlan, displayPlan, type AutoForgeInput, type AutoForgePlan } from '../src/core/autoforge.js';
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

  describe('goal propagation', () => {
    it('includes goal in plan when provided', () => {
      const plan = planAutoForge(makeInput(), 3, 'Build a SaaS product');
      assert.strictEqual(plan.goal, 'Build a SaaS product');
    });

    it('includes goal in cold-start reasoning', () => {
      const plan = planAutoForge(makeInput(), 3, 'Build API');
      assert.ok(plan.reasoning.includes('Build API'));
    });

    it('includes goal in mid-project reasoning', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'tasks', constitution: 'x' }),
      }), 3, 'Ship v2');
      assert.ok(plan.reasoning.includes('Ship v2'));
    });
  });

  describe('getMidProjectSteps via planAutoForge', () => {
    it('constitution -> specify', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'constitution', constitution: 'x' }),
      }));
      assert.ok(plan.steps.some(s => s.command === 'specify'));
    });

    it('specify -> clarify', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'specify', constitution: 'x' }),
      }));
      assert.ok(plan.steps.some(s => s.command === 'clarify'));
    });

    it('clarify -> plan', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'clarify', constitution: 'x' }),
      }));
      assert.ok(plan.steps.some(s => s.command === 'plan'));
    });

    it('plan -> tasks', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'plan', constitution: 'x' }),
      }));
      assert.ok(plan.steps.some(s => s.command === 'tasks'));
    });

    it('design -> forge', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'design', constitution: 'x' }),
      }));
      assert.ok(plan.steps.some(s => s.command === 'forge'));
    });

    it('ux-refine -> verify', () => {
      const plan = planAutoForge(makeInput({
        state: makeState({ workflowStage: 'ux-refine', constitution: 'x' }),
      }));
      assert.ok(plan.steps.some(s => s.command === 'verify'));
    });

    it('forge with design violations -> includes ux-refine then verify', () => {
      const plan = planAutoForge(makeInput({
        hasDesignOp: true,
        designViolationCount: 2,
        state: makeState({ workflowStage: 'forge', constitution: 'x' }),
      }));
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('ux-refine'));
      assert.ok(commands.includes('verify'));
    });

    it('tasks with hasUI and no design -> includes design step', () => {
      const plan = planAutoForge(makeInput({
        hasUI: true,
        hasDesignOp: false,
        state: makeState({ workflowStage: 'tasks', constitution: 'x' }),
      }));
      const commands = plan.steps.map(s => s.command);
      assert.ok(commands.includes('design'));
    });
  });
});

// ── displayPlan ────────────────────────────────────────────────────────────

describe('displayPlan', () => {
  it('runs without throwing for a valid plan', () => {
    const plan: AutoForgePlan = {
      scenario: 'cold-start',
      reasoning: 'Fresh project',
      steps: [
        { command: 'review', reason: 'Scan codebase' },
        { command: 'forge', reason: 'Build features' },
      ],
      maxWaves: 3,
    };
    assert.doesNotThrow(() => displayPlan(plan));
  });

  it('runs without throwing for plan with goal', () => {
    const plan: AutoForgePlan = {
      scenario: 'mid-project',
      reasoning: 'Advancing',
      steps: [],
      maxWaves: 2,
      goal: 'Build v2',
    };
    assert.doesNotThrow(() => displayPlan(plan));
  });

  it('runs without throwing for plan with no steps', () => {
    const plan: AutoForgePlan = {
      scenario: 'mid-project',
      reasoning: 'Complete',
      steps: [],
      maxWaves: 3,
    };
    assert.doesNotThrow(() => displayPlan(plan));
  });
});

// ── executeAutoForgePlan ──────────────────────────────────────────────────────

const tempAutoforgeDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempAutoforgeDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTmpProjectDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-autoforge-'));
  tempAutoforgeDirs.push(dir);
  const dfDir = path.join(dir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });

  const stateContent = `project: test-autoforge
workflowStage: initialized
currentPhase: 0
profile: balanced
lastHandoff: none
auditLog: []
tasks: {}
gateResults: {}
autoforgeFailedAttempts: 0
`;
  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), stateContent);
  return dir;
}

function makePlan(overrides?: Partial<AutoForgePlan>): AutoForgePlan {
  return {
    scenario: 'mid-project',
    reasoning: 'Test plan',
    steps: [{ command: 'forge', reason: 'Execute tasks' }],
    maxWaves: 3,
    ...overrides,
  };
}

function makeExecuteDeps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _isLLMAvailable: async () => false,
    _recordMemory: async () => {},
    _runFailureAnalysis: async () => {},
    ...overrides,
  };
}

describe('executeAutoForgePlan', () => {
  it('uses the injected LLM availability seam instead of probing providers', async () => {
    const cwd = await makeTmpProjectDir();
    let llmProbeCalls = 0;

    await executeAutoForgePlan(makePlan({
      steps: [{ command: 'forge', reason: 'Build' }],
      maxWaves: 5,
    }), {
      cwd,
      ...makeExecuteDeps({
        _isLLMAvailable: async () => {
          llmProbeCalls += 1;
          return true;
        },
        _runStep: async () => { /* success */ },
        _isStageComplete: async () => true,
      }),
    });

    assert.strictEqual(llmProbeCalls, 1);
  });

  it('dryRun returns empty completed/failed without executing steps', async () => {
    const cwd = await makeTmpProjectDir();
    const stepsExecuted: string[] = [];

    const result = await executeAutoForgePlan(makePlan(), {
      dryRun: true,
      cwd,
      ...makeExecuteDeps({
        _runStep: async (cmd: string) => { stepsExecuted.push(cmd); },
        _isStageComplete: async () => true,
      }),
    });

    assert.deepStrictEqual(result, { completed: [], failed: [], paused: false });
    assert.strictEqual(stepsExecuted.length, 0, 'no steps should run in dryRun');
  });

  it('executes injected step and records in completed', async () => {
    const cwd = await makeTmpProjectDir();
    const stepsExecuted: string[] = [];

    const result = await executeAutoForgePlan(makePlan({
      steps: [{ command: 'forge', reason: 'Build' }],
      maxWaves: 5,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async (cmd: string) => { stepsExecuted.push(cmd); },
        _isStageComplete: async () => true,
      }),
    });

    assert.deepStrictEqual(stepsExecuted, ['forge']);
    assert.deepStrictEqual(result.completed, ['forge']);
    assert.deepStrictEqual(result.failed, []);
    assert.strictEqual(result.paused, false);
  });

  it('pauses when wavesExecuted reaches maxWaves', async () => {
    const cwd = await makeTmpProjectDir();
    const stepsExecuted: string[] = [];

    const result = await executeAutoForgePlan(makePlan({
      steps: [
        { command: 'forge', reason: 'Build' },
        { command: 'verify', reason: 'Check' },
        { command: 'synthesize', reason: 'Wrap up' },
      ],
      maxWaves: 1,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async (cmd: string) => { stepsExecuted.push(cmd); },
        _isStageComplete: async () => true,
      }),
    });

    assert.strictEqual(stepsExecuted.length, 1, 'only 1 step should run before pause');
    assert.strictEqual(result.paused, true);
  });

  it('records failure and stops when step throws', async () => {
    const cwd = await makeTmpProjectDir();
    const stepsExecuted: string[] = [];

    const result = await executeAutoForgePlan(makePlan({
      steps: [
        { command: 'forge', reason: 'Build' },
        { command: 'verify', reason: 'Check' },
      ],
      maxWaves: 5,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async (cmd: string) => {
          stepsExecuted.push(cmd);
          if (cmd === 'forge') throw new Error('Build failed');
        },
        _isStageComplete: async () => true,
      }),
    });

    assert.deepStrictEqual(result.failed, ['forge']);
    assert.deepStrictEqual(result.completed, []);
    assert.strictEqual(stepsExecuted.length, 1, 'should stop after failure');
  });

  it('increments autoforgeFailedAttempts in state on failure', async () => {
    const cwd = await makeTmpProjectDir();

    await executeAutoForgePlan(makePlan({
      steps: [{ command: 'forge', reason: 'Build' }],
      maxWaves: 5,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async () => { throw new Error('forced failure'); },
        _isStageComplete: async () => true,
      }),
    });

    const stateContent = await fs.readFile(path.join(cwd, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.ok(stateContent.includes('autoforgeFailedAttempts: 1'));
  });

  it('resets autoforgeFailedAttempts on success', async () => {
    const cwd = await makeTmpProjectDir();
    // Set initial failedAttempts to 2
    const dfDir = path.join(cwd, '.danteforge');
    const stateFile = path.join(dfDir, 'STATE.yaml');
    let content = await fs.readFile(stateFile, 'utf8');
    content = content.replace('autoforgeFailedAttempts: 0', 'autoforgeFailedAttempts: 2');
    await fs.writeFile(stateFile, content);

    await executeAutoForgePlan(makePlan({
      steps: [{ command: 'forge', reason: 'Build' }],
      maxWaves: 5,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async () => { /* success */ },
        _isStageComplete: async () => true,
      }),
    });

    const finalContent = await fs.readFile(stateFile, 'utf8');
    assert.ok(finalContent.includes('autoforgeFailedAttempts: 0'));
  });

  it('fails step when artifact check returns false', async () => {
    const cwd = await makeTmpProjectDir();

    const result = await executeAutoForgePlan(makePlan({
      steps: [{ command: 'forge', reason: 'Build' }],
      maxWaves: 5,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async () => { /* no-op */ },
        _isStageComplete: async () => false,
      }),
    });

    assert.deepStrictEqual(result.failed, ['forge']);
    assert.deepStrictEqual(result.completed, []);
  });

  it('executes all steps when maxWaves is large enough', async () => {
    const cwd = await makeTmpProjectDir();
    const stepsExecuted: string[] = [];

    const result = await executeAutoForgePlan(makePlan({
      steps: [
        { command: 'forge', reason: 'Build' },
        { command: 'verify', reason: 'Check' },
      ],
      maxWaves: 10,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async (cmd: string) => { stepsExecuted.push(cmd); },
        _isStageComplete: async () => true,
      }),
    });

    assert.deepStrictEqual(stepsExecuted, ['forge', 'verify']);
    assert.deepStrictEqual(result.completed, ['forge', 'verify']);
    assert.strictEqual(result.paused, false);
  });

  it('empty steps returns immediately with no completed/failed', async () => {
    const cwd = await makeTmpProjectDir();

    const result = await executeAutoForgePlan(makePlan({ steps: [], maxWaves: 5 }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async () => { throw new Error('should not be called'); },
        _isStageComplete: async () => true,
      }),
    });

    assert.deepStrictEqual(result.completed, []);
    assert.deepStrictEqual(result.failed, []);
    assert.strictEqual(result.paused, false);
  });

  it('complexity calibration runs after successful step (best-effort)', async () => {
    const cwd = await makeTmpProjectDir();
    // Write state with tasks so the calibration code has something to assess
    const dfDir = path.join(cwd, '.danteforge');
    const stateWithTasks = `project: test-autoforge
workflowStage: planned
currentPhase: phase-1
profile: balanced
lastHandoff: none
auditLog: []
tasks:
  phase-1:
    - name: "Add auth module with new architecture"
      files: ["src/auth.ts", "src/middleware.ts", "src/routes/login.ts"]
      verify: "npm test"
gateResults: {}
autoforgeFailedAttempts: 0
`;
    await fs.writeFile(path.join(dfDir, 'STATE.yaml'), stateWithTasks);

    const result = await executeAutoForgePlan(makePlan({
      steps: [{ command: 'forge', reason: 'Build' }],
      maxWaves: 5,
    }), {
      cwd,
      ...makeExecuteDeps({
        _runStep: async () => { /* success */ },
        _isStageComplete: async () => true,
      }),
    });

    assert.deepStrictEqual(result.completed, ['forge']);
    assert.deepStrictEqual(result.failed, []);
    // The complexity calibration should have run without errors
    // (it's best-effort, so even if it did nothing visible, no crash)
  });
});
