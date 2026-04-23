// autoforge --auto flag wiring — tests that runAutoforgeLoop is called when --auto is set,
// normal flow runs without --auto, and ctx fields are correctly populated.

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { autoforge } from '../src/cli/commands/autoforge.js';
import {
  AutoforgeLoopState,
  type AutoforgeLoopContext,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    lastHandoff: '',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    profile: 'balanced',
    auditLog: [],
    ...overrides,
  };
}

const tempDirs: string[] = [];

beforeEach(() => { process.exitCode = undefined; });

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-autoforge-auto-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  await fs.writeFile(path.join(dir, '.danteforge', 'STATE.yaml'), [
    'project: test-project',
    'lastHandoff: initialized',
    'workflowStage: initialized',
    'currentPhase: 0',
    'tasks: {}',
    'profile: balanced',
    'auditLog: []',
  ].join('\n'));
  return dir;
}

after(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

// ── --auto flag tests ─────────────────────────────────────────────────────────

describe('autoforge --auto flag', () => {
  it('calls _runLoop when options.auto is true', async () => {
    let loopCalled = false;
    let capturedCtx: AutoforgeLoopContext | undefined;
    const cwd = await makeWorkspace();

    await autoforge('My goal', {
      auto: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => {
        loopCalled = true;
        capturedCtx = ctx;
        return ctx;
      },
    });

    assert.equal(loopCalled, true, 'runAutoforgeLoop should be called with --auto');
    assert.ok(capturedCtx !== undefined, 'ctx should be passed');
  });

  it('populates ctx.goal from the goal argument', async () => {
    let capturedCtx: AutoforgeLoopContext | undefined;
    const cwd = await makeWorkspace();

    await autoforge('Build auth module', {
      auto: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => { capturedCtx = ctx; return ctx; },
    });

    assert.equal(capturedCtx?.goal, 'Build auth module');
  });

  it('uses default goal when no goal argument provided', async () => {
    let capturedCtx: AutoforgeLoopContext | undefined;
    const cwd = await makeWorkspace();

    await autoforge(undefined, {
      auto: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => { capturedCtx = ctx; return ctx; },
    });

    assert.ok(capturedCtx?.goal.length > 0, 'Default goal should be set');
  });

  it('initializes ctx with IDLE loop state', async () => {
    let capturedCtx: AutoforgeLoopContext | undefined;
    const cwd = await makeWorkspace();

    await autoforge('goal', {
      auto: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => { capturedCtx = ctx; return ctx; },
    });

    assert.equal(capturedCtx?.loopState, AutoforgeLoopState.IDLE);
  });

  it('initializes ctx.cycleCount at 0', async () => {
    let capturedCtx: AutoforgeLoopContext | undefined;
    const cwd = await makeWorkspace();

    await autoforge('goal', {
      auto: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => { capturedCtx = ctx; return ctx; },
    });

    assert.equal(capturedCtx?.cycleCount, 0);
  });

  it('passes force=true when options.force is set', async () => {
    let capturedCtx: AutoforgeLoopContext | undefined;
    const cwd = await makeWorkspace();

    await autoforge('goal', {
      auto: true,
      force: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => { capturedCtx = ctx; return ctx; },
    });

    assert.equal(capturedCtx?.force, true);
  });

  it('passes force=false by default', async () => {
    let capturedCtx: AutoforgeLoopContext | undefined;
    const cwd = await makeWorkspace();

    await autoforge('goal', {
      auto: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => { capturedCtx = ctx; return ctx; },
    });

    assert.equal(capturedCtx?.force, false);
  });

  it('does NOT call _runLoop when --auto is false', async () => {
    let loopCalled = false;

    // Without --auto, it goes through normal flow. The normal flow will fail
    // because there's no real project state — but that's ok, we just check
    // the loop wasn't called.
    try {
      await autoforge('goal', {
        auto: false,
        dryRun: true, // dry-run to avoid real execution
        _runLoop: async (ctx) => { loopCalled = true; return ctx; },
      });
    } catch { /* ignore normal-flow errors in test environment */ }

    assert.equal(loopCalled, false, 'Loop should NOT be called without --auto');
  });

  it('returns immediately after loop completes', async () => {
    let afterLoopCode = false;
    const cwd = await makeWorkspace();

    await autoforge('goal', {
      auto: true,
      _computeRetroScore: false,
      cwd,
      _runLoop: async (ctx) => ctx, // immediate return
    });

    // If we get here, the function returned after the loop
    afterLoopCode = true;
    assert.equal(afterLoopCode, true);
  });
});
