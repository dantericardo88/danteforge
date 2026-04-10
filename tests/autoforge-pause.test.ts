import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOFORGE_PAUSE_FILE,
  AutoforgeLoopState,
  type AutoforgeLoopContext,
  type AutoforgePauseSnapshot,
} from '../src/core/autoforge-loop.js';
import { resumeAutoforge } from '../src/cli/commands/resume.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePauseSnapshot(overrides: Partial<AutoforgePauseSnapshot> = {}): AutoforgePauseSnapshot {
  return {
    pausedAt: new Date().toISOString(),
    avgScore: 82,
    cycleCount: 5,
    goal: 'Build test project',
    retryCounters: {},
    blockedArtifacts: [],
    ...overrides,
  };
}

// ── AUTOFORGE_PAUSE_FILE constant ─────────────────────────────────────────────

describe('AUTOFORGE_PAUSE_FILE', () => {
  it('is a string under .danteforge/', () => {
    assert.ok(typeof AUTOFORGE_PAUSE_FILE === 'string');
    assert.ok(AUTOFORGE_PAUSE_FILE.includes('.danteforge'));
  });

  it('is named AUTOFORGE_PAUSED', () => {
    assert.ok(AUTOFORGE_PAUSE_FILE.endsWith('AUTOFORGE_PAUSED'));
  });
});

// ── AutoforgeLoopContext type ─────────────────────────────────────────────────

describe('AutoforgeLoopContext pauseAtScore field', () => {
  it('accepts pauseAtScore on the context object', () => {
    const ctx: Partial<AutoforgeLoopContext> = { pauseAtScore: 80 };
    assert.equal(ctx.pauseAtScore, 80);
  });

  it('accepts _writePauseFile injection seam', () => {
    const ctx: Partial<AutoforgeLoopContext> = {
      _writePauseFile: async () => {},
    };
    assert.ok(typeof ctx._writePauseFile === 'function');
  });
});

// ── resumeAutoforge ───────────────────────────────────────────────────────────

describe('resumeAutoforge', () => {
  it('logs error and returns when pause file missing', async () => {
    // Should not throw — just log and return
    await assert.doesNotReject(
      resumeAutoforge({
        cwd: '/fake',
        _readFile: async () => { throw new Error('ENOENT'); },
        _unlink: async () => {},
        _runLoop: async (ctx) => ctx,
      }),
    );
  });

  it('parses pause snapshot and reconstructs context', async () => {
    const snapshot = makePauseSnapshot({ avgScore: 85, cycleCount: 7, goal: 'Resume test' });
    let capturedCtx: AutoforgeLoopContext | null = null;

    await resumeAutoforge({
      cwd: '/fake',
      _readFile: async () => JSON.stringify(snapshot),
      _unlink: async () => {},
      _runLoop: async (ctx) => {
        capturedCtx = ctx;
        return ctx;
      },
    });

    assert.ok(capturedCtx !== null);
    assert.equal((capturedCtx as AutoforgeLoopContext).goal, 'Resume test');
    assert.equal((capturedCtx as AutoforgeLoopContext).cycleCount, 7);
  });

  it('deletes pause file before running loop', async () => {
    const deleted: string[] = [];
    const snapshot = makePauseSnapshot();

    await resumeAutoforge({
      cwd: '/fake',
      _readFile: async () => JSON.stringify(snapshot),
      _unlink: async (p) => { deleted.push(p); },
      _runLoop: async (ctx) => ctx,
    });

    assert.equal(deleted.length, 1);
    assert.ok(deleted[0]!.includes('AUTOFORGE_PAUSED'));
  });

  it('starts loop with IDLE state regardless of paused state', async () => {
    const snapshot = makePauseSnapshot();
    let capturedState: string | undefined;

    await resumeAutoforge({
      cwd: '/fake',
      _readFile: async () => JSON.stringify(snapshot),
      _unlink: async () => {},
      _runLoop: async (ctx) => {
        capturedState = ctx.loopState;
        return ctx;
      },
    });

    assert.equal(capturedState, AutoforgeLoopState.IDLE);
  });

  it('preserves retryCounters from snapshot', async () => {
    const snapshot = makePauseSnapshot({
      retryCounters: { SPEC: 2, FORGE: 1 },
    });
    let capturedCtx: AutoforgeLoopContext | null = null;

    await resumeAutoforge({
      cwd: '/fake',
      _readFile: async () => JSON.stringify(snapshot),
      _unlink: async () => {},
      _runLoop: async (ctx) => { capturedCtx = ctx; return ctx; },
    });

    assert.deepEqual((capturedCtx as AutoforgeLoopContext).retryCounters, { SPEC: 2, FORGE: 1 });
  });

  it('still runs loop even if unlink fails', async () => {
    const snapshot = makePauseSnapshot();
    let loopCalled = false;

    await resumeAutoforge({
      cwd: '/fake',
      _readFile: async () => JSON.stringify(snapshot),
      _unlink: async () => { throw new Error('Permission denied'); },
      _runLoop: async (ctx) => { loopCalled = true; return ctx; },
    });

    assert.ok(loopCalled);
  });

  it('does not run loop when pause file is corrupt JSON', async () => {
    let loopCalled = false;

    await resumeAutoforge({
      cwd: '/fake',
      _readFile: async () => '{bad json}',
      _unlink: async () => {},
      _runLoop: async (ctx) => { loopCalled = true; return ctx; },
    });

    assert.ok(!loopCalled);
  });
});
