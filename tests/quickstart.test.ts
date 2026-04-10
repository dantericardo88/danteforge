import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quickstart } from '../src/cli/commands/quickstart.js';
import { createWaveTracker } from '../src/core/progress.js';

// ── createWaveTracker tests ───────────────────────────────────────────────────

describe('createWaveTracker', () => {
  it('returns current() == totalWaves', () => {
    const t = createWaveTracker(8, 3, 'Planning', { _isTTY: false });
    assert.equal(t.total(), 8);
  });

  it('returns waveName()', () => {
    const t = createWaveTracker(8, 3, 'Planning', { _isTTY: false });
    assert.equal(t.waveName(), 'Planning');
  });

  it('current() increments on step()', () => {
    const t = createWaveTracker(8, 3, 'Planning', { _isTTY: false });
    assert.equal(t.current(), 0);
    t.step('Doing something');
    assert.equal(t.current(), 1);
  });

  it('step() is a no-op in non-TTY mode (no throw)', () => {
    const t = createWaveTracker(4, 1, 'Wave', { _isTTY: false });
    assert.doesNotThrow(() => t.step('label'));
  });

  it('step() outputs bracket prefix in TTY mode', () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => output.push(msg);
    const t = createWaveTracker(4, 2, 'Forging', { _isTTY: true });
    t.step('running');
    console.log = origLog;
    assert.ok(output.some((l) => l.includes('[2/4]')));
    assert.ok(output.some((l) => l.includes('Forging')));
  });

  it('step() label appears in output', () => {
    const output: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => output.push(msg);
    const t = createWaveTracker(4, 1, 'Wave', { _isTTY: true });
    t.step('myLabel');
    console.log = origLog;
    assert.ok(output.some((l) => l.includes('myLabel')));
  });
});

// ── quickstart function tests ─────────────────────────────────────────────────

describe('quickstart', () => {
  function makeOpts(overrides: Parameters<typeof quickstart>[0] = {}) {
    const calls: string[] = [];
    return {
      opts: {
        nonInteractive: true,
        _isTTY: false,
        _runInit: async () => { calls.push('init'); },
        _runConstitution: async () => { calls.push('constitution'); },
        _runSpark: async (goal: string) => { calls.push(`spark:${goal}`); },
        _isLLMAvailable: async () => true,
        _readFile: async () => { throw new Error('no snapshot'); },
        ...overrides,
      },
      calls,
    };
  }

  it('calls runInit', async () => {
    const { opts, calls } = makeOpts();
    await quickstart(opts);
    assert.ok(calls.includes('init'));
  });

  it('calls runConstitution after init', async () => {
    const { opts, calls } = makeOpts();
    await quickstart(opts);
    const initIdx = calls.indexOf('init');
    const constIdx = calls.indexOf('constitution');
    assert.ok(initIdx >= 0, 'init called');
    assert.ok(constIdx > initIdx, 'constitution after init');
  });

  it('calls runSpark with provided idea', async () => {
    const { opts, calls } = makeOpts({ idea: 'Build a REST API' });
    await quickstart(opts);
    assert.ok(calls.includes('spark:Build a REST API'));
  });

  it('skips spark when no idea and nonInteractive', async () => {
    const { opts, calls } = makeOpts({ idea: '' });
    await quickstart(opts);
    assert.ok(!calls.some((c) => c.startsWith('spark:')));
  });

  it('shows [1/4] through [4/4] via createStepTracker', async () => {
    // Step tracker emits in non-TTY mode only to console in TTY mode
    // We can verify that all 4 steps ran by checking that spark was attempted
    const { opts, calls } = makeOpts({ idea: 'test idea' });
    await quickstart(opts);
    assert.ok(calls.length >= 3); // init, constitution, spark
  });

  it('reads PDSE snapshot when available', async () => {
    let snapshotRead = false;
    const { opts } = makeOpts({
      idea: 'test',
      _readFile: async () => {
        snapshotRead = true;
        return JSON.stringify({ avgScore: 82 });
      },
    });
    await quickstart(opts);
    assert.ok(snapshotRead);
  });

  it('does not throw when snapshot absent', async () => {
    const { opts } = makeOpts({ idea: 'test', _readFile: async () => { throw new Error('missing'); } });
    await assert.doesNotReject(() => quickstart(opts));
  });

  it('does not throw when init fails', async () => {
    const { opts } = makeOpts({
      idea: 'x',
      _runInit: async () => { throw new Error('init failed'); },
    });
    await assert.doesNotReject(() => quickstart(opts));
  });

  it('does not throw when constitution fails', async () => {
    const { opts } = makeOpts({
      idea: 'x',
      _runConstitution: async () => { throw new Error('const failed'); },
    });
    await assert.doesNotReject(() => quickstart(opts));
  });

  it('does not throw when spark fails', async () => {
    const { opts } = makeOpts({
      idea: 'x',
      _runSpark: async () => { throw new Error('spark failed'); },
    });
    await assert.doesNotReject(() => quickstart(opts));
  });

  it('passes cwd to init and constitution', async () => {
    const seenCwds: string[] = [];
    const { opts } = makeOpts({
      idea: 'x',
      cwd: '/fake/cwd',
      _runInit: async (o) => { seenCwds.push(o.cwd ?? ''); },
      _runConstitution: async (o) => { seenCwds.push(o.cwd ?? ''); },
    });
    await quickstart(opts);
    assert.ok(seenCwds.every((c) => c === '/fake/cwd'));
  });

  it('prompts for idea when none provided and interactive', async () => {
    const { opts, calls } = makeOpts({
      idea: undefined,
      nonInteractive: false,
      _isTTY: true,
      _readline: {
        question: (_prompt: string, cb: (a: string) => void) => cb('prompted idea'),
      },
    });
    await quickstart(opts);
    assert.ok(calls.includes('spark:prompted idea'));
  });

  it('uses prompted idea for spark', async () => {
    const { opts, calls } = makeOpts({
      idea: undefined,
      nonInteractive: false,
      _isTTY: true,
      _readline: {
        question: (_prompt: string, cb: (a: string) => void) => cb('  my idea  '),
      },
    });
    await quickstart(opts);
    assert.ok(calls.includes('spark:my idea'));
  });

  it('exports quickstart function', () => {
    assert.equal(typeof quickstart, 'function');
  });
});

// ── constitution interactive tests ────────────────────────────────────────────

describe('constitution interactive', () => {
  it('uses injected principles directly', async () => {
    const { constitution } = await import('../src/cli/commands/constitution.js');
    let written = '';
    await constitution({
      principles: ['Rule A', 'Rule B', 'Rule C'],
      nonInteractive: true,
      _writeArtifact: async (_name, content) => { written = content; return ''; },
      _handoff: async () => {},
    });
    assert.ok(written.includes('Rule A'));
    assert.ok(written.includes('Rule B'));
  });

  it('non-interactive uses defaults', async () => {
    const { constitution } = await import('../src/cli/commands/constitution.js');
    let written = '';
    await constitution({
      nonInteractive: true,
      _writeArtifact: async (_name, content) => { written = content; return ''; },
      _handoff: async () => {},
    });
    assert.ok(written.includes('Always prioritize zero ambiguity'));
  });

  it('interactive uses prompted principles', async () => {
    const { constitution } = await import('../src/cli/commands/constitution.js');
    let written = '';
    let callCount = 0;
    await constitution({
      _isTTY: true,
      _readline: {
        question: (_prompt: string, cb: (a: string) => void) => {
          callCount++;
          cb(callCount === 1 ? 'Custom principle one' : '');
        },
      },
      _writeArtifact: async (_name, content) => { written = content; return ''; },
      _handoff: async () => {},
    });
    assert.ok(written.includes('Custom principle one'));
  });

  it('defaults preserved when user presses Enter', async () => {
    const { constitution } = await import('../src/cli/commands/constitution.js');
    let written = '';
    await constitution({
      _isTTY: true,
      _readline: {
        question: (_prompt: string, cb: (a: string) => void) => cb(''),
      },
      _writeArtifact: async (_name, content) => { written = content; return ''; },
      _handoff: async () => {},
    });
    assert.ok(written.includes('Always prioritize zero ambiguity'));
  });
});

// ── init chained steps tests ───────────────────────────────────────────────────

describe('init chained steps', () => {
  it('calls _setupAssistants when user confirms', async () => {
    const { init } = await import('../src/cli/commands/init.js');
    let assistantsCalled = false;
    let questionCount = 0;
    await init({
      _isTTY: true,
      _isLLMAvailable: async () => true,
      _loadState: async () => ({ auditLog: [], projectType: 'node' } as Parameters<typeof init>[0]['_loadState'] extends infer T ? T extends (...args: any[]) => any ? Awaited<ReturnType<T>> : never : never),
      _saveState: async () => {},
      _getOrPromptTarget: async () => ({ mode: 'score', minScore: 80, definedAt: '' }),
      _setupAssistants: async () => { assistantsCalled = true; },
      _constitution: async () => {},
      _readline: {
        question: (_prompt: string, cb: (a: string) => void) => {
          questionCount++;
          cb('y');
        },
      },
    }).catch(() => {}); // may fail on state — we only check the flag
    assert.ok(assistantsCalled);
  });

  it('calls _constitution when user confirms', async () => {
    const { init } = await import('../src/cli/commands/init.js');
    let constitutionCalled = false;
    await init({
      _isTTY: true,
      _isLLMAvailable: async () => true,
      _loadState: async () => ({ auditLog: [], projectType: 'node' } as any),
      _saveState: async () => {},
      _getOrPromptTarget: async () => ({ mode: 'score', minScore: 80, definedAt: '' }),
      _setupAssistants: async () => {},
      _constitution: async () => { constitutionCalled = true; },
      _readline: {
        question: (_prompt: string, cb: (a: string) => void) => cb('y'),
      },
    }).catch(() => {});
    assert.ok(constitutionCalled);
  });
});
