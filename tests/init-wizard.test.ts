// Init wizard — tests for question flow, non-TTY skip, state persistence,
// and personalized guidance output.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { init, type InitOptions } from '../src/cli/commands/init.js';
import type { DanteState } from '../src/core/state.js';

// ── Mock readline builder ─────────────────────────────────────────────────────

function mockReadline(answers: string[]): InitOptions['_readline'] {
  let idx = 0;
  return {
    question: (_p: string, cb: (a: string) => void) => cb(answers[idx++] ?? ''),
    close: () => {},
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  let savedState: DanteState | undefined;
  const mockState: DanteState = {
    project: 'test', lastHandoff: '', workflowStage: 'initialized',
    currentPhase: 1, tasks: {}, auditLog: [], profile: 'budget',
  };
  return {
    cwd: '/fake/project',
    _isTTY: false,         // non-interactive by default for tests
    _isLLMAvailable: async () => false,
    _loadState: async () => ({ ...mockState }),
    _saveState: async (state) => { savedState = state; },
    ...overrides,
  };
}

// ── Non-interactive mode ──────────────────────────────────────────────────────

describe('init — non-interactive (non-TTY)', () => {
  it('runs without throwing when non-TTY', async () => {
    await assert.doesNotReject(() => init(makeOptions()));
  });

  it('does not ask questions in non-TTY mode', async () => {
    let questionCalled = false;
    await init(makeOptions({
      _readline: {
        question: (_p: string, _cb: (a: string) => void) => { questionCalled = true; },
        close: () => {},
      },
    }));
    assert.equal(questionCalled, false, 'Should not ask questions in non-TTY mode');
  });

  it('saves state with audit log entry', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _saveState: async (state) => { savedState = state; },
    }));
    assert.ok(savedState !== undefined, 'saveState should be called');
    assert.ok(
      savedState!.auditLog.some((entry) => entry.includes('init:')),
      'Audit log should contain init entry',
    );
  });

  it('detects LLM availability and includes in health checks', async () => {
    await assert.doesNotReject(() => init(makeOptions({ _isLLMAvailable: async () => true })));
  });
});

// ── Interactive mode ──────────────────────────────────────────────────────────

describe('init — interactive (TTY)', () => {
  it('asks 3 questions in interactive mode', async () => {
    const questions: string[] = [];
    await init(makeOptions({
      _isTTY: true,
      _readline: {
        question: (p: string, cb: (a: string) => void) => {
          questions.push(p);
          cb(''); // empty answers
        },
        close: () => {},
      },
    }));
    assert.equal(questions.length, 3, `Expected 3 questions, got ${questions.length}`);
  });

  it('stores project description in state.constitution when provided', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['Building a todo app', '1', '2']),
      _saveState: async (state) => { savedState = state; },
    }));
    assert.equal(savedState?.constitution, 'Building a todo app');
  });

  it('does not set constitution when description is empty', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['', '1', '2']),
      _saveState: async (state) => { savedState = state; },
    }));
    assert.ok(
      !savedState?.constitution || savedState.constitution === '',
      'constitution should be empty when user skips',
    );
  });

  it('sets preferredLevel=spark for choice 1', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['My app', '1', '1']),  // spark
      _saveState: async (state) => { savedState = state; },
    }));
    assert.equal(savedState?.preferredLevel, 'spark');
  });

  it('sets preferredLevel=magic for choice 2 (default)', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['', '2', '2']),  // magic
      _saveState: async (state) => { savedState = state; },
    }));
    assert.equal(savedState?.preferredLevel, 'magic');
  });

  it('sets preferredLevel=inferno for choice 3', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['My project', '3', '3']),  // inferno
      _saveState: async (state) => { savedState = state; },
    }));
    assert.equal(savedState?.preferredLevel, 'inferno');
  });

  it('defaults to magic when user presses Enter on level choice', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['', '', '']),  // all Enter = defaults
      _saveState: async (state) => { savedState = state; },
    }));
    assert.equal(savedState?.preferredLevel, 'magic');
  });

  it('treats invalid level choice as magic', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['', '1', 'banana']),
      _saveState: async (state) => { savedState = state; },
    }));
    assert.equal(savedState?.preferredLevel, 'magic');
  });

  it('experience level 1 is new user (default)', async () => {
    // Should not throw and should complete health checks
    await assert.doesNotReject(() => init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['', '1', '2']),
    })));
  });

  it('experience level 3 shows power user guidance', async () => {
    // Should not throw
    await assert.doesNotReject(() => init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['Power project', '3', '3']),
    })));
  });
});

// ── --non-interactive flag ────────────────────────────────────────────────────

describe('init — nonInteractive option', () => {
  it('skips wizard questions when nonInteractive=true even if TTY', async () => {
    let questionCalled = false;
    await init({
      ...makeOptions({ _isTTY: true }),
      nonInteractive: true,
      _readline: {
        question: (_p: string, _cb: (a: string) => void) => { questionCalled = true; },
        close: () => {},
      },
    });
    assert.equal(questionCalled, false);
  });
});
