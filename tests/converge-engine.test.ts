import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runConverge } from '../src/core/converge-engine.js';
import type { ConvergeOptions, ConvergeScoreSnapshot } from '../src/core/converge-engine-types.js';
import type { ScoringDimension } from '../src/core/harsh-scorer.js';

const DIMS: ScoringDimension[] = ['functionality', 'testing', 'errorHandling'];

function makeSnap(scores: Partial<Record<ScoringDimension, number>>, overall = 8.0): ConvergeScoreSnapshot {
  const displayDimensions: Record<string, number> = {
    functionality: 9.5, testing: 9.5, errorHandling: 9.5,
    ...scores,
  };
  return { displayScore: overall, displayDimensions };
}

function silentOpts(extra: Partial<ConvergeOptions> = {}): ConvergeOptions {
  return { dims: DIMS, _stdout: () => {}, ...extra };
}

describe('converge-engine — check-only', () => {
  test('returns exitCode 0 when all dims at target', async () => {
    const result = await runConverge(silentOpts({
      checkOnly: true,
      target: 9.0,
      _computeScore: async () => makeSnap({ functionality: 9.5, testing: 9.2, errorHandling: 9.1 }),
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.success, true);
    assert.equal(result.dimsFailing.length, 0);
  });

  test('returns exitCode 1 when a dim is below target', async () => {
    const result = await runConverge(silentOpts({
      checkOnly: true,
      target: 9.0,
      _computeScore: async () => makeSnap({ functionality: 8.5, testing: 9.2, errorHandling: 9.1 }),
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(result.success, false);
    assert.ok(result.dimsFailing.includes('functionality'));
  });

  test('cyclesRun is 0 in check-only mode', async () => {
    const result = await runConverge(silentOpts({
      checkOnly: true,
      target: 9.0,
      _computeScore: async () => makeSnap({}),
    }));
    assert.equal(result.cyclesRun, 0);
  });
});

describe('converge-engine — loop pass', () => {
  test('exits immediately when all dims already at target', async () => {
    let computeCalls = 0;
    const result = await runConverge(silentOpts({
      target: 9.0,
      maxCycles: 10,
      _computeScore: async () => { computeCalls++; return makeSnap({ functionality: 9.5, testing: 9.5, errorHandling: 9.5 }); },
      _runForge: async () => { throw new Error('should not forge'); },
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.success, true);
    assert.equal(result.cyclesRun, 0);
    assert.equal(computeCalls, 1);
  });

  test('runs forge wave when a dim is below target and converges', async () => {
    let cycle = 0;
    const scores = [7.0, 9.5];
    const result = await runConverge(silentOpts({
      target: 9.0,
      maxCycles: 10,
      _computeScore: async () => makeSnap({ functionality: scores[Math.min(cycle, scores.length - 1)] }),
      _runForge: async () => { cycle++; return { success: true }; },
    }));
    assert.equal(result.exitCode, 0);
    assert.equal(result.success, true);
    assert.equal(result.cyclesRun, 1);
  });

  test('returns exitCode 1 when maxCycles exhausted', async () => {
    const result = await runConverge(silentOpts({
      target: 9.0,
      maxCycles: 2,
      _computeScore: async () => makeSnap({ functionality: 6.0, testing: 6.0, errorHandling: 6.0 }),
      _runForge: async () => ({ success: true }),
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(result.success, false);
    assert.equal(result.cyclesRun, 2);
  });
});

describe('converge-engine — escalation to party mode', () => {
  test('calls _runParty when a dim is stuck for escalateAfter cycles', async () => {
    let partyCalled = 0;
    let cycle = 0;
    // Score never improves for `functionality` until party mode resets stuckCount
    // After escalateAfter=2 stuck cycles → party → then score jumps
    const snapScores = [7.0, 7.0, 7.0, 9.5]; // 3 identical → escalate; then pass
    const result = await runConverge(silentOpts({
      target: 9.0,
      maxCycles: 10,
      escalateAfter: 2,
      _computeScore: async () => makeSnap({ functionality: snapScores[Math.min(cycle, snapScores.length - 1)] }),
      _runForge: async () => { cycle++; return { success: true }; },
      _runParty: async () => { partyCalled++; cycle++; return { success: true }; },
    }));
    assert.ok(partyCalled >= 1, `expected party called at least once, got ${partyCalled}`);
    assert.equal(result.exitCode, 0);
  });

  test('stuckCount resets after party escalation', async () => {
    let partyCalls = 0;
    let cycle = 0;
    // Stays stuck → party → jumps to passing
    const snapScores = [7.0, 7.0, 7.0, 9.5];
    const result = await runConverge(silentOpts({
      target: 9.0,
      maxCycles: 15,
      escalateAfter: 2,
      _computeScore: async () => makeSnap({ functionality: snapScores[Math.min(cycle, snapScores.length - 1)] }),
      _runForge: async () => { cycle++; return { success: true }; },
      _runParty: async () => { partyCalls++; cycle++; return { success: true }; },
    }));
    // Should have converged, not hit maxCycles
    assert.equal(result.exitCode, 0);
    assert.equal(partyCalls, 1);
  });
});

describe('converge-engine — dim subset', () => {
  test('only checks dims specified in opts.dims', async () => {
    // functionality is 6.0 but we only check testing — should pass
    const result = await runConverge({
      checkOnly: true,
      target: 9.0,
      dims: ['testing' as ScoringDimension],
      _computeScore: async () => makeSnap({ functionality: 6.0, testing: 9.5 }),
      _stdout: () => {},
    });
    assert.equal(result.exitCode, 0);
  });
});
