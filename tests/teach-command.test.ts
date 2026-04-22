import { describe, it } from 'node:test';
import assert from 'node:assert';
import { teach, categorizeCorrection } from '../src/cli/commands/teach.js';
import type { TeachOptions } from '../src/cli/commands/teach.js';

function makeOpts(overrides: Partial<TeachOptions> = {}): TeachOptions {
  return {
    correction: 'Claude used readline instead of @inquirer/prompts',
    cwd: '/tmp/teach-test',
    _appendLesson: async () => {},
    _runPrime: async () => {},
    _stdout: () => {},
    ...overrides,
  };
}

describe('categorizeCorrection', () => {
  it('returns code for readline (no other keyword match)', () => {
    assert.strictEqual(categorizeCorrection('readline'), 'code');
  });

  it('returns performance for slow query', () => {
    assert.strictEqual(categorizeCorrection('slow query causes timeout'), 'performance');
  });

  it('returns test for mock usage', () => {
    assert.strictEqual(categorizeCorrection('Do not mock the database in tests'), 'test');
  });

  it('returns security for xss', () => {
    assert.strictEqual(categorizeCorrection('XSS vulnerability in form input'), 'security');
  });

  it('returns deploy for ci pipeline', () => {
    assert.strictEqual(categorizeCorrection('CI pipeline must run before deploy'), 'deploy');
  });
});

describe('teach command', () => {
  it('_appendLesson called with formatted lesson entry', async () => {
    let capturedEntry = '';
    await teach(makeOpts({
      _appendLesson: async (entry) => { capturedEntry = entry; },
    }));
    assert.ok(capturedEntry.includes('Claude used readline'), 'entry should contain the correction text');
    assert.ok(capturedEntry.includes('teach'), 'entry should contain teach tag');
    assert.ok(capturedEntry.includes('ai-correction'), 'entry should contain ai-correction tag');
  });

  it('_runPrime called after lesson captured', async () => {
    let primeCalled = false;
    await teach(makeOpts({
      _runPrime: async () => { primeCalled = true; },
    }));
    assert.ok(primeCalled, '_runPrime should be called');
  });

  it('_stdout captures confirmation lines', async () => {
    const lines: string[] = [];
    await teach(makeOpts({
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('Captured'), 'should contain Captured line');
    assert.ok(combined.includes('Category'), 'should contain Category line');
    assert.ok(combined.includes('Lesson added'), 'should contain Lesson added line');
  });

  it('_appendLesson receives cwd when provided', async () => {
    let capturedCwd: string | undefined;
    await teach(makeOpts({
      cwd: '/my/project',
      _appendLesson: async (_entry, cwd) => { capturedCwd = cwd; },
    }));
    assert.strictEqual(capturedCwd, '/my/project');
  });

  it('category is embedded in stdout output', async () => {
    const lines: string[] = [];
    await teach(makeOpts({
      correction: 'slow query takes 5 seconds',
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('performance'), 'category should appear in output');
  });
});
