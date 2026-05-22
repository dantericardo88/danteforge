import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDaemon, type DaemonPassResult, type DaemonStrategy } from '../src/cli/commands/daemon.js';

function makePass(score: number, outcome: DaemonPassResult['outcome'] = 'improved'): DaemonPassResult {
  return {
    strategy: 'crusade',
    pass: 1,
    scoreBeforePass: score - 0.1,
    scoreAfterPass: score,
    durationMs: 100,
    outcome,
  };
}

describe('runDaemon — dry-run', () => {
  it('returns immediately without running any passes', async () => {
    const result = await runDaemon({ dryRun: true });
    assert.equal(result.reason, 'dry-run');
    assert.equal(result.passes.length, 0);
    assert.equal(result.targetReached, false);
  });
});

describe('runDaemon — target reached', () => {
  it('stops when _runPass returns score >= target', async () => {
    let callCount = 0;
    const result = await runDaemon({
      target: 9.0,
      timeLimitMinutes: 60,
      intervalMinutes: 0,
      _runPass: async (_strategy: DaemonStrategy, _cwd: string): Promise<DaemonPassResult> => {
        callCount++;
        return makePass(9.0);
      },
      _getCurrentScore: async () => 9.0,
    });
    assert.equal(result.targetReached, true);
    assert.equal(result.reason, 'target-reached');
    assert.equal(callCount, 1);
  });

  it('runs multiple passes before reaching target', async () => {
    let callCount = 0;
    const scores = [7.0, 8.0, 9.0];
    const result = await runDaemon({
      target: 9.0,
      timeLimitMinutes: 60,
      intervalMinutes: 0,
      _runPass: async (): Promise<DaemonPassResult> => {
        const score = scores[callCount] ?? 9.0;
        callCount++;
        return makePass(score);
      },
    });
    assert.equal(result.targetReached, true);
    assert.equal(callCount, 3);
  });
});

describe('runDaemon — time limit', () => {
  it('stops when time limit is hit', async () => {
    let callCount = 0;
    const fakeNow = (() => {
      // First call: start. Each subsequent call advances 70 minutes.
      let t = 1_000_000;
      return () => { const val = t; t += 70 * 60 * 1000; return val; };
    })();

    const result = await runDaemon({
      target: 10.0,
      timeLimitMinutes: 60,
      intervalMinutes: 0,
      _now: fakeNow,
      _runPass: async (): Promise<DaemonPassResult> => {
        callCount++;
        return makePass(8.0);
      },
    });
    assert.equal(result.timeLimitReached, true);
    assert.equal(result.reason, 'time-limit');
    assert.equal(callCount, 0); // Time limit hit before any pass
  });
});

describe('runDaemon — consecutive errors', () => {
  it('stops after 3 consecutive errors', async () => {
    let callCount = 0;
    const result = await runDaemon({
      target: 9.0,
      timeLimitMinutes: 9999,
      intervalMinutes: 0,
      _runPass: async (): Promise<DaemonPassResult> => {
        callCount++;
        return { ...makePass(5.0, 'error'), error: 'llm timeout' };
      },
    });
    assert.equal(result.reason, 'consecutive-errors');
    assert.equal(callCount, 3);
  });
});

describe('runDaemon — plateau handling', () => {
  it('switches to autoresearch after 2 plateaus in adaptive mode', async () => {
    const strategies: DaemonStrategy[] = [];
    let callCount = 0;
    const scores = [8.0, 8.0, 8.0, 9.0];
    await runDaemon({
      strategy: 'adaptive',
      target: 9.0,
      timeLimitMinutes: 9999,
      intervalMinutes: 0,
      _runPass: async (strategy: DaemonStrategy): Promise<DaemonPassResult> => {
        strategies.push(strategy);
        const score = scores[callCount] ?? 9.0;
        callCount++;
        return makePass(score, score === 9.0 ? 'improved' : 'plateau');
      },
    });
    // After 2 plateaus, should switch to autoresearch
    assert.ok(strategies.includes('autoresearch'));
  });
});
