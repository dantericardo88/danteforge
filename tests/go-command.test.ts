import { describe, it } from 'node:test';
import assert from 'node:assert';
import { go } from '../src/cli/commands/go.js';
import type { GoOptions } from '../src/cli/commands/go.js';
import type { SelfImproveOptions, SelfImproveResult } from '../src/cli/commands/self-improve.js';

function makeResult(overrides: Partial<SelfImproveResult> = {}): SelfImproveResult {
  return {
    cyclesRun: 3,
    initialScore: 7.0,
    finalScore: 8.5,
    achieved: false,
    plateauDetected: false,
    stopReason: 'max-cycles',
    ...overrides,
  };
}

function makeOpts(overrides: Partial<GoOptions> = {}): GoOptions {
  return {
    cwd: '/tmp/go-test',
    _runSelfImprove: async () => makeResult(),
    _stdout: () => {},
    ...overrides,
  };
}

describe('go command', () => {
  it('_runSelfImprove called with maxCycles: 5 default', async () => {
    let capturedOpts: SelfImproveOptions | null = null;
    await go(makeOpts({
      _runSelfImprove: async (opts) => { capturedOpts = opts; return makeResult(); },
    }));
    assert.ok(capturedOpts !== null, '_runSelfImprove should be called');
    assert.strictEqual(capturedOpts!.maxCycles, 5);
  });

  it('_runSelfImprove called with minScore: 9.0 default', async () => {
    let capturedOpts: SelfImproveOptions | null = null;
    await go(makeOpts({
      _runSelfImprove: async (opts) => { capturedOpts = opts; return makeResult(); },
    }));
    assert.strictEqual(capturedOpts!.minScore, 9.0);
  });

  it('before and after scores are logged', async () => {
    const lines: string[] = [];
    await go(makeOpts({
      _runSelfImprove: async () => makeResult({ initialScore: 6.5, finalScore: 8.2, cyclesRun: 2 }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('6.5'), 'before score should appear');
    assert.ok(combined.includes('8.2'), 'after score should appear');
  });

  it('optional goal forwarded to selfImprove', async () => {
    let capturedOpts: SelfImproveOptions | null = null;
    await go(makeOpts({
      goal: 'improve security dimension',
      _runSelfImprove: async (opts) => { capturedOpts = opts; return makeResult(); },
    }));
    assert.strictEqual(capturedOpts!.goal, 'improve security dimension');
  });

  it('graceful message when achieved: false', async () => {
    const lines: string[] = [];
    await go(makeOpts({
      _runSelfImprove: async () => makeResult({ achieved: false, stopReason: 'max-cycles' }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('Stopped') || combined.includes('Run again') || combined.includes('cycle'), 'should have graceful non-achieved message');
  });
});
