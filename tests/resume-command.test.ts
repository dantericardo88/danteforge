import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resumeAutoforge } from '../src/cli/commands/resume.js';

describe('resumeAutoforge', () => {
  it('does not throw when no pause file exists', async () => {
    await assert.doesNotReject(() =>
      resumeAutoforge({
        cwd: '/tmp/fake-project',
        _readFile: async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
        _unlink: async () => {},
        _runLoop: async (ctx) => ctx,
        _runAscend: async () => ({ finalScore: 8.5, cyclesRun: 3, improvements: [], report: '' }),
      })
    );
  });

  it('resumes ascend when ascend checkpoint exists', async () => {
    let ascendCalled = false;
    const checkpoint = {
      cyclesRun: 2,
      maxCycles: 5,
      currentDimension: 'testing',
      target: 9.0,
    };
    await resumeAutoforge({
      cwd: '/tmp/fake',
      _readFile: async (p) => {
        if (p.includes('ASCEND_PAUSED')) return JSON.stringify(checkpoint);
        throw new Error('ENOENT');
      },
      _unlink: async () => {},
      _runLoop: async (ctx) => ctx,
      _runAscend: async () => { ascendCalled = true; return { finalScore: 9.0, cyclesRun: 5, improvements: [], report: '' }; },
    });
    assert.ok(ascendCalled);
  });

  it('resumes autoforge loop when autoforge pause file exists', async () => {
    let loopCalled = false;
    const snapshot = {
      avgScore: 8.2,
      cycleCount: 4,
      goal: 'reach 9.5',
      state: {},
      loopState: {},
    };
    await resumeAutoforge({
      cwd: '/tmp/fake',
      _readFile: async (p) => {
        if (p.includes('AUTOFORGE_PAUSED')) return JSON.stringify(snapshot);
        throw new Error('ENOENT');
      },
      _unlink: async () => {},
      _runLoop: async (ctx) => { loopCalled = true; return ctx; },
      _runAscend: async () => ({ finalScore: 9.0, cyclesRun: 1, improvements: [], report: '' }),
    });
    assert.ok(loopCalled);
  });

  it('does not throw on unlink failure', async () => {
    const snapshot = {
      avgScore: 8.0,
      cycleCount: 1,
      goal: 'test',
      state: {},
      loopState: {},
    };
    await assert.doesNotReject(() =>
      resumeAutoforge({
        cwd: '/tmp/fake',
        _readFile: async (p) => {
          if (p.includes('AUTOFORGE_PAUSED')) return JSON.stringify(snapshot);
          throw new Error('ENOENT');
        },
        _unlink: async () => { throw new Error('cannot unlink'); },
        _runLoop: async (ctx) => ctx,
        _runAscend: async () => ({ finalScore: 9.0, cyclesRun: 1, improvements: [], report: '' }),
      })
    );
  });
});
