// autoforge CLI — tests for the --auto loop mode path
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { autoforge } from '../src/cli/commands/autoforge.js';
import {
  AutoforgeLoopState,
  type AutoforgeLoopContext,
} from '../src/core/autoforge-loop.js';

// Reset process.exitCode between tests so mutations don't leak
let _savedExitCode: number | undefined;
const tempDirs: string[] = [];
const originalCwd = process.cwd();
beforeEach(() => { _savedExitCode = process.exitCode as number | undefined; process.exitCode = undefined; });
afterEach(async () => {
  process.exitCode = _savedExitCode;
  process.chdir(originalCwd);
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-autoforge-cli-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  return dir;
}

function makeLoopCtx(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  return {
    goal: 'test-goal',
    cwd: process.cwd(),
    state: { project: 'test', workflowStage: 'initialized', currentPhase: 1, tasks: {}, lastHandoff: 'none', profile: 'balanced', auditLog: [] },
    loopState: AutoforgeLoopState.COMPLETE,
    cycleCount: 1,
    startedAt: new Date().toISOString(),
    retryCounters: {},
    blockedArtifacts: [],
    lastGuidance: null,
    isWebProject: false,
    force: false,
    maxRetries: 3,
    ...overrides,
  };
}

describe('autoforge CLI — --auto loop mode', () => {
  it('calls _runLoop when auto=true', async () => {
    let called = false;
    const cwd = await makeWorkspace();
    await autoforge('test-goal', {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx) => { called = true; return makeLoopCtx({ ...ctx, loopState: AutoforgeLoopState.COMPLETE }); },
    });
    assert.ok(called, '_runLoop should be invoked when auto=true');
  });

  it('does NOT call _runLoop when auto is absent (uses dry-run to exit early)', async () => {
    let called = false;
    await autoforge(undefined, {
      dryRun: true,
      _runLoop: async (ctx) => { called = true; return ctx; },
    });
    assert.strictEqual(called, false, '_runLoop should not be called without --auto flag');
  });

  it('sets exitCode=1 when loop returns BLOCKED state', async () => {
    const cwd = await makeWorkspace();
    await autoforge(undefined, {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx) => makeLoopCtx({
        ...ctx,
        loopState: AutoforgeLoopState.BLOCKED,
        blockedArtifacts: ['src/core/state.ts'],
      }),
    });
    assert.strictEqual(process.exitCode, 1, 'BLOCKED loop result should set exitCode=1');
  });

  it('passes the goal string into loop context', async () => {
    let receivedGoal = '';
    const cwd = await makeWorkspace();
    await autoforge('my-specific-goal', {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx) => { receivedGoal = ctx.goal; return makeLoopCtx(ctx); },
    });
    assert.strictEqual(receivedGoal, 'my-specific-goal', 'goal should be passed to loop context');
  });

  it('passes force flag into loop context', async () => {
    let receivedForce = false;
    const cwd = await makeWorkspace();
    await autoforge(undefined, {
      auto: true,
      force: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx) => { receivedForce = ctx.force; return makeLoopCtx(ctx); },
    });
    assert.ok(receivedForce, 'force flag should be passed to loop context');
  });

  it('delegates score-only mode to the injected score runner', async () => {
    let called = false;
    await autoforge(undefined, {
      scoreOnly: true,
      _runScoreOnlyMode: async () => { called = true; },
      _policyGate: async () => ({ command: 'autoforge', allowed: true, requiresApproval: false, reason: 'test', bypassActive: false, timestamp: '' }),
    });
    assert.ok(called, 'score-only mode should invoke the injected score runner');
  });

  it('uses injected analysis + planner in prompt mode without executing the plan', async () => {
    let executeCalled = false;
    let analyzed = false;
    let planned = false;

    await autoforge('ship it', {
      prompt: true,
      _policyGate: async () => ({ command: 'autoforge', allowed: true, requiresApproval: false, reason: 'test', bypassActive: false, timestamp: '' }),
      _analyzeProjectState: async () => {
        analyzed = true;
        return {
          state: makeLoopCtx().state,
          hasDesignOp: false,
          hasUI: false,
          memoryEntryCount: 0,
          lastMemoryAge: null,
          failedAttempts: 0,
          designViolationCount: 0,
        };
      },
      _planAutoForge: (input, maxWaves, goal) => {
        planned = true;
        assert.equal(goal, 'ship it');
        return {
          scenario: 'cold-start',
          reasoning: 'test',
          steps: [{ command: 'review', reason: 'scan' }],
          maxWaves,
          goal,
        };
      },
      _executeAutoForgePlan: async () => {
        executeCalled = true;
        return { completed: [], failed: [], paused: false };
      },
    });

    assert.ok(analyzed, 'prompt mode should analyze project state');
    assert.ok(planned, 'prompt mode should build a plan');
    assert.equal(executeCalled, false, 'prompt mode should not execute the plan');
  });

  it('uses injected displayPlan in dry-run mode', async () => {
    let displayed = false;

    await autoforge(undefined, {
      dryRun: true,
      _policyGate: async () => ({ command: 'autoforge', allowed: true, requiresApproval: false, reason: 'test', bypassActive: false, timestamp: '' }),
      _analyzeProjectState: async () => ({
        state: makeLoopCtx().state,
        hasDesignOp: false,
        hasUI: false,
        memoryEntryCount: 0,
        lastMemoryAge: null,
        failedAttempts: 0,
        designViolationCount: 0,
      }),
      _planAutoForge: () => ({
        scenario: 'cold-start',
        reasoning: 'test',
        steps: [{ command: 'review', reason: 'scan' }],
        maxWaves: 3,
      }),
      _displayPlan: () => { displayed = true; },
    });

    assert.ok(displayed, 'dry-run mode should display the generated plan');
  });

  it('uses injected executor in standard execution mode and marks failures via exitCode', async () => {
    await autoforge(undefined, {
      _analyzeProjectState: async () => ({
        state: makeLoopCtx().state,
        hasDesignOp: false,
        hasUI: false,
        memoryEntryCount: 0,
        lastMemoryAge: null,
        failedAttempts: 0,
        designViolationCount: 0,
      }),
      _planAutoForge: () => ({
        scenario: 'mid-project',
        reasoning: 'test',
        steps: [{ command: 'forge', reason: 'build' }],
        maxWaves: 3,
      }),
      _executeAutoForgePlan: async () => ({
        completed: [],
        failed: ['forge'],
        paused: false,
      }),
      _loadLatestVerdict: async () => null,
    });

    assert.strictEqual(process.exitCode, 1, 'failed execution should set exitCode=1');
  });

  it('writes AUTOFORGE_GUIDANCE.md in a real score-only workspace', async () => {
    const cwd = await makeWorkspace();
    process.chdir(cwd);

    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), [
      'project: autoforge-cli-real',
      `created: ${new Date().toISOString()}`,
      'workflowStage: initialized',
      'currentPhase: 0',
      'lastHandoff: none',
      'profile: balanced',
      'tasks: {}',
      'gateResults: {}',
      'auditLog: []',
    ].join('\n'));

    await autoforge(undefined, { scoreOnly: true });

    const guidance = await fs.readFile(path.join(cwd, '.danteforge', 'AUTOFORGE_GUIDANCE.md'), 'utf8');
    assert.match(guidance, /# Autoforge Guidance/);
    assert.match(guidance, /Overall Completion:/);
  });

  it('loads and reports reflection data when the verdict is available', async () => {
    let verdictLoaded = false;

    await autoforge(undefined, {
      _policyGate: async () => ({ command: 'autoforge', allowed: true, requiresApproval: false, reason: 'test', bypassActive: false, timestamp: '' }),
      _analyzeProjectState: async () => ({
        state: makeLoopCtx().state,
        hasDesignOp: false,
        hasUI: false,
        memoryEntryCount: 0,
        lastMemoryAge: null,
        failedAttempts: 0,
        designViolationCount: 0,
      }),
      _planAutoForge: () => ({
        scenario: 'mid-project',
        reasoning: 'test',
        steps: [{ command: 'forge', reason: 'build' }],
        maxWaves: 3,
      }),
      _executeAutoForgePlan: async () => ({
        completed: ['forge'],
        failed: [],
        paused: false,
      }),
      _loadLatestVerdict: async () => {
        verdictLoaded = true;
        return {
          confidence: 0.92,
          status: 'ready',
          stuck: false,
          remainingWork: ['final polish'],
        };
      },
    });

    assert.ok(verdictLoaded, 'execution mode should load the latest reflection verdict');
    assert.strictEqual(process.exitCode, undefined);
  });

  it('reports paused execution without marking the process as failed', async () => {
    await autoforge(undefined, {
      _policyGate: async () => ({ command: 'autoforge', allowed: true, requiresApproval: false, reason: 'test', bypassActive: false, timestamp: '' }),
      _analyzeProjectState: async () => ({
        state: makeLoopCtx().state,
        hasDesignOp: false,
        hasUI: false,
        memoryEntryCount: 0,
        lastMemoryAge: null,
        failedAttempts: 0,
        designViolationCount: 0,
      }),
      _planAutoForge: () => ({
        scenario: 'mid-project',
        reasoning: 'test',
        steps: [{ command: 'forge', reason: 'build' }],
        maxWaves: 1,
      }),
      _executeAutoForgePlan: async () => ({
        completed: ['forge'],
        failed: [],
        paused: true,
      }),
      _loadLatestVerdict: async () => null,
    });

    assert.strictEqual(process.exitCode, undefined, 'paused execution should not set exitCode=1');
  });

  it('swallows reflection lookup errors after a successful execution', async () => {
    let verdictAttempted = false;

    await autoforge(undefined, {
      _policyGate: async () => ({ command: 'autoforge', allowed: true, requiresApproval: false, reason: 'test', bypassActive: false, timestamp: '' }),
      _analyzeProjectState: async () => ({
        state: makeLoopCtx().state,
        hasDesignOp: false,
        hasUI: false,
        memoryEntryCount: 0,
        lastMemoryAge: null,
        failedAttempts: 0,
        designViolationCount: 0,
      }),
      _planAutoForge: () => ({
        scenario: 'mid-project',
        reasoning: 'test',
        steps: [{ command: 'forge', reason: 'build' }],
        maxWaves: 3,
      }),
      _executeAutoForgePlan: async () => ({
        completed: ['forge'],
        failed: [],
        paused: false,
      }),
      _loadLatestVerdict: async () => {
        verdictAttempted = true;
        throw new Error('reflection unavailable');
      },
    });

    assert.ok(verdictAttempted, 'reflection lookup should still be attempted');
    assert.strictEqual(process.exitCode, undefined);
  });
});
