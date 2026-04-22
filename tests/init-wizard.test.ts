import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { init, type InitOptions } from '../src/cli/commands/init.js';
import type { DanteState } from '../src/core/state.js';

function mockReadline(answers: string[]): InitOptions['_readline'] {
  let idx = 0;
  return {
    question: (_prompt: string, cb: (answer: string) => void) => cb(answers[idx++] ?? ''),
    close: () => {},
  };
}

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  const mockState: DanteState = {
    project: 'test',
    lastHandoff: '',
    workflowStage: 'initialized',
    currentPhase: 1,
    tasks: {},
    auditLog: [],
    profile: 'budget',
  };

  return {
    cwd: '/fake/project',
    _isTTY: false,
    _isLLMAvailable: async () => false,
    _loadState: async () => ({ ...mockState }),
    _saveState: async () => {},
    ...overrides,
  };
}

describe('init - non-interactive (non-TTY)', () => {
  it('runs without throwing when non-TTY', async () => {
    await assert.doesNotReject(() => init(makeOptions()));
  });

  it('does not ask questions in non-TTY mode', async () => {
    let questionCalled = false;
    await init(makeOptions({
      _readline: {
        question: () => {
          questionCalled = true;
        },
        close: () => {},
      },
    }));
    assert.equal(questionCalled, false);
  });

  it('saves state with audit log entry', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _saveState: async (state) => {
        savedState = state;
      },
    }));
    assert.ok(savedState);
    assert.ok(savedState?.auditLog.some((entry) => entry.includes('init:')));
  });
});

describe('init - interactive default path', () => {
  it('asks exactly 3 questions in interactive mode', async () => {
    const questions: string[] = [];
    await init(makeOptions({
      _isTTY: true,
      _readline: {
        question: (prompt: string, cb: (answer: string) => void) => {
          questions.push(prompt);
          cb('');
        },
        close: () => {},
      },
    }));
    assert.equal(questions.length, 3);
  });

  it('stores project description in constitution when provided', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['Building a todo app', '1', '2']),
      _saveState: async (state) => {
        savedState = state;
      },
    }));
    assert.equal(savedState?.constitution, 'Building a todo app');
  });

  it('maps work style choices to preferred levels', async () => {
    let sparkState: DanteState | undefined;
    let magicState: DanteState | undefined;
    let infernoState: DanteState | undefined;

    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['My app', '1', '1']),
      _saveState: async (state) => {
        sparkState = state;
      },
    }));
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['My app', '2', '1']),
      _saveState: async (state) => {
        magicState = state;
      },
    }));
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['My app', '3', '1']),
      _saveState: async (state) => {
        infernoState = state;
      },
    }));

    assert.equal(sparkState?.preferredLevel, 'spark');
    assert.equal(magicState?.preferredLevel, 'magic');
    assert.equal(infernoState?.preferredLevel, 'inferno');
  });

  it('treats invalid level choice as magic', async () => {
    let savedState: DanteState | undefined;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['', 'banana', '']),
      _saveState: async (state) => {
        savedState = state;
      },
    }));
    assert.equal(savedState?.preferredLevel, 'magic');
  });
});

describe('init - advanced path', () => {
  it('asks adversarial scoring question only with --advanced', async () => {
    const questions: string[] = [];
    let idx = 0;
    const answers = ['My app', '2', '1', 'n', 'n'];

    await init(makeOptions({
      _isTTY: true,
      advanced: true,
      _detectIDE: () => null,
      _readline: {
        question: (prompt: string, cb: (answer: string) => void) => {
          questions.push(prompt);
          cb(answers[idx++] ?? '');
        },
        close: () => {},
      },
      _loadConfig: async () => ({ defaultProvider: 'ollama', providers: {} } as never),
      _saveConfig: async () => {},
    }));

    assert.ok(questions.some((q) => /adversarial|scoring/i.test(q)));
  });

  it('does not ask adversarial scoring question without --advanced', async () => {
    const questions: string[] = [];
    await init(makeOptions({
      _isTTY: true,
      _readline: {
        question: (prompt: string, cb: (answer: string) => void) => {
          questions.push(prompt);
          cb('');
        },
        close: () => {},
      },
    }));
    assert.equal(questions.some((q) => /adversarial|scoring/i.test(q)), false);
  });

  it('saves adversary config when user answers yes with --advanced', async () => {
    let savedConfig: unknown;
    let idx = 0;
    const answers = ['', '2', '1', '1', 'Y', 'n'];

    await init(makeOptions({
      _isTTY: true,
      advanced: true,
      _detectIDE: () => null,
      _readline: {
        question: (_prompt: string, cb: (answer: string) => void) => cb(answers[idx++] ?? ''),
        close: () => {},
      },
      _loadConfig: async () => ({ defaultProvider: 'ollama', providers: {} } as never),
      _saveConfig: async (cfg) => {
        savedConfig = cfg;
      },
    }));

    assert.ok(savedConfig);
    const cfg = savedConfig as { adversary?: { enabled?: boolean } };
    assert.equal(cfg.adversary?.enabled, true);
  });

  it('calls defineUniverse when user answers yes in advanced mode', async () => {
    let universeCalled = false;
    let idx = 0;
    const answers = ['test project', '2', '1', '1', 'n', 'y'];

    await init(makeOptions({
      _isTTY: true,
      advanced: true,
      _detectIDE: () => null,
      _readline: {
        question: (_prompt: string, cb: (answer: string) => void) => cb(answers[idx++] ?? ''),
        close: () => {},
      },
      _loadConfig: async () => ({ defaultProvider: 'ollama', providers: {} } as never),
      _saveConfig: async () => {},
      _defineUniverse: async () => {
        universeCalled = true;
      },
    }));

    assert.equal(universeCalled, true);
  });

  it('does not call defineUniverse when advanced mode is off', async () => {
    let universeCalled = false;
    await init(makeOptions({
      _isTTY: true,
      _readline: mockReadline(['test project', '2', '1']),
      _defineUniverse: async () => {
        universeCalled = true;
      },
    }));
    assert.equal(universeCalled, false);
  });
});
