// magic-command.test.ts — tests for runMagicPreset step sequencing via _runStep injection
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { magic, spark, ember, canvas, blaze, nova, inferno } from '../src/cli/commands/magic.js';
import type { MagicExecutionStep, MagicLevel } from '../src/core/magic-presets.js';
import type { VerifyStatus, MagicPipelineCheckpoint } from '../src/cli/commands/magic.js';
import type { DanteState } from '../src/core/state.js';

// ── Test isolation setup ───────────────────────────────────────────────────────

const originalCwd = process.cwd();
const tempDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-magic-cmd-'));
  tempDirs.push(tmpDir);
  // Create a minimal STATE.yaml so loadState() doesn't fail
  const dfDir = path.join(tmpDir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  await fs.writeFile(
    path.join(dfDir, 'STATE.yaml'),
    'project: test\nworkflowStage: tasks\ncurrentPhase: 0\nprofile: budget\nlastHandoff: none\nauditLog: []\ntasks: {}\n',
  );
  return tmpDir;
}

// No-op convergence stubs — prevents real LLM calls during step-sequence tests
const noopConvergence = {
  getVerifyStatus: async (): Promise<VerifyStatus> => 'pass',
  runAutoforge: async () => {},
  runVerify: async () => {},
};

beforeEach(async () => {
  const tmpDir = await makeTmpDir();
  process.chdir(tmpDir);
  process.exitCode = 0;
});

afterEach(async () => {
  process.exitCode = 0;
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// Helper: run a preset and capture step kinds
async function captureSteps(
  fn: (goal?: string, opts?: Record<string, unknown>) => Promise<void>,
  goal: string,
  extraOpts: Record<string, unknown> = {},
): Promise<string[]> {
  const captured: string[] = [];
  await fn(goal, {
    prompt: false,
    _runStep: async (step: MagicExecutionStep) => { captured.push(step.kind); },
    _convergenceOpts: noopConvergence,
    ...extraOpts,
  });
  return captured;
}

// ─── spark ────────────────────────────────────────────────────────────────────

describe('magic-command: spark step sequence', () => {
  it('spark runs review → constitution → specify → clarify → tech-decide → plan → tasks', async () => {
    const steps = await captureSteps(spark, 'Start new project');
    assert.deepStrictEqual(steps, ['review', 'constitution', 'specify', 'clarify', 'tech-decide', 'plan', 'tasks']);
  });

  it('spark with skipTechDecide omits tech-decide', async () => {
    const steps = await captureSteps(spark, 'Start new project', { skipTechDecide: true });
    assert.deepStrictEqual(steps, ['review', 'constitution', 'specify', 'clarify', 'plan', 'tasks']);
    assert.ok(!steps.includes('tech-decide'), 'tech-decide should be absent');
  });
});

// ─── ember ────────────────────────────────────────────────────────────────────

describe('magic-command: ember step sequence', () => {
  it('ember runs autoforge → lessons-compact', async () => {
    const steps = await captureSteps(ember, 'Quick fix');
    assert.deepStrictEqual(steps, ['autoforge', 'lessons-compact']);
  });
});

// ─── canvas ───────────────────────────────────────────────────────────────────

describe('magic-command: canvas step sequence', () => {
  it('canvas runs design → autoforge → ux-refine → verify → lessons-compact', async () => {
    const steps = await captureSteps(canvas, 'Build dashboard UI');
    assert.deepStrictEqual(steps, ['design', 'autoforge', 'ux-refine', 'verify', 'lessons-compact']);
  });

  it('canvas has exactly 5 steps', async () => {
    const steps = await captureSteps(canvas, 'Build landing page');
    assert.strictEqual(steps.length, 5);
  });
});

// ─── magic ────────────────────────────────────────────────────────────────────

describe('magic-command: magic step sequence', () => {
  it('magic runs autoforge → verify → lessons-compact', async () => {
    const steps = await captureSteps(magic, 'Close PRD gap', { level: 'magic' });
    assert.deepStrictEqual(steps, ['autoforge', 'verify', 'lessons-compact']);
  });
});

// ─── blaze ────────────────────────────────────────────────────────────────────

describe('magic-command: blaze step sequence', () => {
  it('blaze runs autoforge → party → verify → synthesize → retro → lessons-compact', async () => {
    const steps = await captureSteps(blaze, 'Big feature');
    assert.deepStrictEqual(steps, ['autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact']);
  });

  it('blaze with withDesign prepends design and inserts ux-refine after autoforge', async () => {
    const steps = await captureSteps(blaze, 'UI feature', { withDesign: true });
    assert.deepStrictEqual(steps, ['design', 'autoforge', 'ux-refine', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact']);
  });

  it('blaze with withDesign and designPrompt passes designPrompt to design step', async () => {
    const capturedSteps: MagicExecutionStep[] = [];
    await blaze('UI feature', {
      prompt: false,
      withDesign: true,
      designPrompt: 'Modern card layout',
      _runStep: async (step: MagicExecutionStep) => { capturedSteps.push(step); },
      _convergenceOpts: noopConvergence,
    } as Parameters<typeof blaze>[1]);
    const designStep = capturedSteps.find(s => s.kind === 'design');
    assert.ok(designStep, 'should have design step');
    assert.ok(designStep!.kind === 'design' && designStep.designPrompt === 'Modern card layout', 'designPrompt should be forwarded');
  });
});

// ─── nova ─────────────────────────────────────────────────────────────────────

describe('magic-command: nova step sequence', () => {
  it('nova runs constitution → plan → tasks → autoforge → party → verify → synthesize → retro → lessons-compact', async () => {
    const steps = await captureSteps(nova, 'Feature sprint');
    assert.deepStrictEqual(steps, ['constitution', 'plan', 'tasks', 'autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact']);
  });

  it('nova with withTechDecide includes tech-decide', async () => {
    const steps = await captureSteps(nova, 'Feature sprint', { withTechDecide: true });
    assert.ok(steps.includes('tech-decide'), 'tech-decide should be present');
  });

  it('nova with withDesign includes design and ux-refine', async () => {
    const steps = await captureSteps(nova, 'UI sprint', { withDesign: true });
    assert.ok(steps.includes('design'), 'design step should be present');
    assert.ok(steps.includes('ux-refine'), 'ux-refine step should be present');
  });
});

// ─── inferno ──────────────────────────────────────────────────────────────────

describe('magic-command: inferno step sequence', () => {
  it('inferno runs oss → autoforge → party → verify → synthesize → retro → lessons-compact', async () => {
    const steps = await captureSteps(inferno, 'New dimension');
    assert.deepStrictEqual(steps, ['oss', 'autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact']);
  });

  it('inferno with withDesign includes design and ux-refine', async () => {
    const steps = await captureSteps(inferno, 'UI dimension', { withDesign: true });
    assert.ok(steps.includes('design'), 'design step should be present');
    assert.ok(steps.includes('ux-refine'), 'ux-refine step should be present');
  });
});

// ─── goal forwarding ─────────────────────────────────────────────────────────

describe('magic-command: goal forwarding', () => {
  it('_runStep receives the original goal string', async () => {
    const capturedGoals: string[] = [];
    await magic('My test goal', {
      level: 'magic' as MagicLevel,
      prompt: false,
      _runStep: async (_step: MagicExecutionStep, goal: string) => { capturedGoals.push(goal); },
      _convergenceOpts: noopConvergence,
    } as Parameters<typeof magic>[1]);
    assert.ok(capturedGoals.length > 0, 'should receive goal');
    assert.ok(capturedGoals.every(g => g === 'My test goal'), 'all steps should receive the same goal');
  });
});

// ─── prompt mode skips _runStep ───────────────────────────────────────────────

describe('magic-command: prompt mode', () => {
  it('prompt: true prints plan and does not call _runStep', async () => {
    let stepCalled = false;
    await magic('Test goal', {
      level: 'magic' as MagicLevel,
      prompt: true,
      _runStep: async () => { stepCalled = true; },
      _convergenceOpts: noopConvergence,
    } as Parameters<typeof magic>[1]);
    assert.strictEqual(stepCalled, false, '_runStep should not be called in prompt mode');
  });
});

// ─── _runStep override is used ────────────────────────────────────────────────

describe('magic-command: _runStep injection', () => {
  it('_runStep override replaces real step runner', async () => {
    let injectedCalled = false;
    await spark('test project', {
      prompt: false,
      _runStep: async (_step: MagicExecutionStep) => { injectedCalled = true; },
      _convergenceOpts: noopConvergence,
    } as Parameters<typeof spark>[1]);
    assert.strictEqual(injectedCalled, true, 'injected _runStep should have been called');
  });

  it('magic function with level override routes to correct preset steps', async () => {
    const blazeSteps = await captureSteps(magic, 'Big work', { level: 'blaze' });
    assert.deepStrictEqual(blazeSteps, ['autoforge', 'party', 'verify', 'synthesize', 'retro', 'lessons-compact']);
  });
});

// ── Checkpoint I/O injection ──────────────────────────────────────────────────

function makeCheckpointStubs() {
  const saves: MagicPipelineCheckpoint[] = [];
  let loadCalled = false;
  let clearCalled = false;
  return {
    _checkpointOps: {
      load: async (): Promise<MagicPipelineCheckpoint | null> => { loadCalled = true; return null; },
      save: async (cp: MagicPipelineCheckpoint) => { saves.push(JSON.parse(JSON.stringify(cp)) as MagicPipelineCheckpoint); },
      clear: async () => { clearCalled = true; },
    },
    saves,
    get loadCalled() { return loadCalled; },
    get clearCalled() { return clearCalled; },
  };
}

function makeStateStubs() {
  const savedStates: DanteState[] = [];
  const baseState: DanteState = {
    project: 'test', workflowStage: 'tasks', currentPhase: 0,
    profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {},
  } as unknown as DanteState;
  return {
    _stateOps: {
      load: async (): Promise<DanteState> => JSON.parse(JSON.stringify(baseState)) as DanteState,
      save: async (s: DanteState) => { savedStates.push(JSON.parse(JSON.stringify(s)) as DanteState); },
    },
    savedStates,
  };
}

describe('magic-command: checkpoint I/O', () => {
  it('checkpoint is saved before each step starts', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    await ember('test goal', {
      prompt: false,
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    // ember has 2 steps; before each step = 2 saves, after each step = 2 more saves = 4 total
    assert.ok(cp.saves.length >= 2, `expected at least 2 checkpoint saves, got ${cp.saves.length}`);
    // First save should have currentStepIndex: 0
    assert.strictEqual(cp.saves[0]!.currentStepIndex, 0);
  });

  it('checkpoint is cleared when pipeline completes', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    await ember('test', {
      prompt: false,
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    assert.strictEqual(cp.clearCalled, true, 'checkpoint should be cleared on completion');
  });

  it('checkpoint load is called when resume: true', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    await ember('test', {
      resume: true,
      prompt: false,
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    assert.strictEqual(cp.loadCalled, true, 'checkpoint load should be called on resume');
  });

  it('resume with existing checkpoint restores step index', async () => {
    const st = makeStateStubs();
    const capturedSteps: string[] = [];
    // ember has 2 steps: autoforge, lessons-compact
    // If checkpoint says currentStepIndex:1, only lessons-compact should run
    const existingCheckpoint: MagicPipelineCheckpoint = {
      pipelineId: 'test-id',
      level: 'ember',
      goal: 'test goal',
      steps: [
        { kind: 'autoforge', maxWaves: 5, profile: 'budget', parallel: true, worktree: false },
        { kind: 'lessons-compact' },
      ],
      currentStepIndex: 1,
      completedResults: [{ step: 'autoforge (5 waves, budget, parallel)', status: 'ok', durationMs: 100 }],
      startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      currentStepRetries: 0,
    };
    await ember('test', {
      resume: true,
      prompt: false,
      _runStep: async (step) => { capturedSteps.push(step.kind); },
      _convergenceOpts: noopConvergence,
      _checkpointOps: {
        load: async () => existingCheckpoint,
        save: async () => {},
        clear: async () => {},
      },
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    // Only lessons-compact should run (autoforge already done)
    assert.deepStrictEqual(capturedSteps, ['lessons-compact'], 'should only run steps from index 1 onward');
  });

  it('audit log entry is pushed to state on completion', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    await ember('My goal', {
      prompt: false,
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    assert.ok(st.savedStates.length > 0, 'state should be saved');
    const lastState = st.savedStates[st.savedStates.length - 1]!;
    assert.ok(lastState.auditLog.length > 0, 'audit log should have an entry');
    const entry = lastState.auditLog[lastState.auditLog.length - 1]!;
    assert.match(entry, /magic-preset:ember/, 'audit entry should include preset level');
    assert.match(entry, /complete/, 'audit entry should include completion status');
  });

  it('audit log entry includes "completed-with-failures" when any step fails', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    let callCount = 0;
    await ember('test', {
      prompt: false,
      _runStep: async () => { if (callCount++ < 10) throw new Error('always fails'); },
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    const lastState = st.savedStates[st.savedStates.length - 1]!;
    const entry = lastState.auditLog[lastState.auditLog.length - 1]!;
    assert.match(entry, /completed-with-failures/, 'should mark failures in audit log');
  });

  it('checkpoint currentStepIndex advances after each step', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    await ember('test', {
      prompt: false,
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    const stepIndices = cp.saves.map(s => s.currentStepIndex);
    // Should include 0 (before step 0), 1 (after step 0), 1 (before step 1), 2 (after step 1)
    assert.ok(stepIndices.includes(0), 'should have save with index 0');
    assert.ok(stepIndices.includes(2), 'should have save with index 2 (after last step)');
  });
});

// ── Retry logic ───────────────────────────────────────────────────────────────

describe('magic-command: retry behavior', () => {
  it('step fails once then passes — retried successfully', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    let calls = 0;
    await ember('test', {
      prompt: false,
      _runStep: async () => {
        if (calls++ === 0) throw new Error('transient failure');
      },
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    // pipeline should complete — no exit code set
    assert.strictEqual(process.exitCode, 0);
    // checkpoint should have had retries=1 at some point
    const retrySnap = cp.saves.find(s => s.currentStepRetries > 0);
    assert.ok(retrySnap, 'should have a checkpoint with currentStepRetries > 0 during retry');
    assert.strictEqual(retrySnap!.currentStepRetries, 1);
  });

  it('currentStepRetries resets to 0 after successful step following a retry', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    let calls = 0;
    await ember('test', {
      prompt: false,
      _runStep: async () => {
        if (calls++ === 0) throw new Error('transient');
      },
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    // After all steps complete, the last save should have retries reset to 0
    const lastSave = cp.saves[cp.saves.length - 1]!;
    assert.strictEqual(lastSave.currentStepRetries, 0, 'retries should be reset after success');
  });

  it('all 3 attempts fail — pipeline continues to next step (does not throw)', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    await assert.doesNotReject(async () => {
      await ember('test', {
        prompt: false,
        _runStep: async () => { throw new Error('always fails'); },
        _convergenceOpts: noopConvergence,
        _checkpointOps: cp._checkpointOps,
        _stateOps: st._stateOps,
      } as Parameters<typeof ember>[1]);
    }, 'pipeline should not throw even when all retries exhausted');
  });

  it('process.exitCode set to 1 when any step exhausts retries', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    process.exitCode = 0;
    await ember('test', {
      prompt: false,
      _runStep: async () => { throw new Error('always fails'); },
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    assert.strictEqual(process.exitCode, 1, 'exit code should be 1 on failure');
    process.exitCode = 0; // reset
  });

  it('process.exitCode non-zero from step triggers retry path', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    let calls = 0;
    process.exitCode = 0;
    await ember('test', {
      prompt: false,
      _runStep: async () => {
        // First call: set exitCode to 1 without throwing
        // Subsequent calls: succeed
        calls++;
        if (calls === 1) { process.exitCode = 1; }
      },
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    // retry should have been triggered — at least 2 calls for first step
    assert.ok(calls >= 2, `expected at least 2 calls due to exitCode=1 retry, got ${calls}`);
    process.exitCode = 0;
  });

  it('step results contain fail entry when all retries exhausted', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    await ember('test', {
      prompt: false,
      _runStep: async () => { throw new Error('boom'); },
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    const lastState = st.savedStates[st.savedStates.length - 1]!;
    const entry = lastState.auditLog[lastState.auditLog.length - 1]!;
    // ember has 2 pipeline steps + 1 convergence result = 3 results total
    assert.match(entry, /\d+ steps/, 'audit log should report step count');
    assert.match(entry, /completed-with-failures/, 'should be marked as failed');
  });

  it('pipeline runs all steps even after a failure (does not halt)', async () => {
    const cp = makeCheckpointStubs();
    const st = makeStateStubs();
    const ran: string[] = [];
    let calls = 0;
    await ember('test', {
      prompt: false,
      _runStep: async (step) => {
        calls++;
        ran.push(step.kind);
        // First step always fails all retries
        if (step.kind === 'autoforge') throw new Error('fail');
      },
      _convergenceOpts: noopConvergence,
      _checkpointOps: cp._checkpointOps,
      _stateOps: st._stateOps,
    } as Parameters<typeof ember>[1]);
    // ember: autoforge + lessons-compact
    // autoforge fails 3 times (attempts 0,1,2), then lessons-compact runs once
    assert.ok(ran.includes('lessons-compact'), 'should still run lessons-compact after autoforge failure');
    assert.ok(calls >= 4, `autoforge runs 3 times + lessons-compact once = 4 calls, got ${calls}`);
  });
});

// ─── post-inferno prime hook ──────────────────────────────────────────────────

describe('magic-command: inferno post-prime hook', () => {
  it('inferno level triggers _runPrime call after last step', async () => {
    let primeCalled = false;
    await inferno('test goal', {
      prompt: false,
      _runStep: async () => {},
      _runPrime: async () => { primeCalled = true; },
      _convergenceOpts: noopConvergence,
    } as Parameters<typeof inferno>[1]);
    assert.ok(primeCalled, '_runPrime should be called after inferno completes');
  });

  it('non-inferno level does NOT trigger _runPrime', async () => {
    let primeCalled = false;
    await ember('test goal', {
      prompt: false,
      _runStep: async () => {},
      _runPrime: async () => { primeCalled = true; },
      _convergenceOpts: noopConvergence,
    } as Parameters<typeof ember>[1]);
    assert.ok(!primeCalled, '_runPrime should NOT be called for ember level');
  });
});

describe('magic — confirmMatrix gate', () => {
  it('calls _confirmMatrix when no --yes flag and no resume', async () => {
    let confirmCalled = false;
    await magic('test goal', {
      yes: false,
      _confirmMatrix: async (_cwd) => { confirmCalled = true; return true; },
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
    });
    assert.ok(confirmCalled, '_confirmMatrix should be called when yes is false');
  });

  it('skips _confirmMatrix when yes: true', async () => {
    let confirmCalled = false;
    await magic('test goal', {
      yes: true,
      _confirmMatrix: async (_cwd) => { confirmCalled = true; return true; },
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
    });
    assert.ok(!confirmCalled, '_confirmMatrix should NOT be called when yes is true');
  });

  it('aborts pipeline when _confirmMatrix returns false', async () => {
    let stepsCalled = 0;
    await magic('test goal', {
      yes: false,
      _confirmMatrix: async (_cwd) => false,
      _runStep: async () => { stepsCalled++; },
      _convergenceOpts: noopConvergence,
    });
    assert.strictEqual(stepsCalled, 0, 'pipeline steps should not run when confirmMatrix returns false');
  });

  it('calls _computeStrictDims after pipeline completes', async () => {
    let strictCalled = false;
    await magic('test goal', {
      yes: true,
      _runStep: async () => {},
      _convergenceOpts: noopConvergence,
      _computeStrictDims: async (_cwd) => {
        strictCalled = true;
        return { autonomy: 80, selfImprovement: 70, tokenEconomy: 85 };
      },
    });
    assert.ok(strictCalled, '_computeStrictDims should be called after pipeline completes');
  });
});
