import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAutonomousLoop, type LoopRunnerDeps } from '../src/core/autonomous-loop-runner.ts';

// Build fake deps. groundingSeq feeds successive measureGrounding() calls (1 at start + 1 per cycle);
// quorum is a constant or a per-call sequence; tokens is constant. Tracks how many build cycles actually ran.
function fakes(opts: {
  groundingSeq: number[];
  quorum?: boolean | boolean[];
  tokens?: number;
}): { deps: LoopRunnerDeps; runs: () => number } {
  let gi = 0, qi = 0, cycleRuns = 0;
  const last = <T>(a: T[], i: number) => a[Math.min(i, a.length - 1)]!;
  const deps: LoopRunnerDeps = {
    measureGrounding: async () => last(opts.groundingSeq, gi++),
    checkQuorum: async () => Array.isArray(opts.quorum) ? last(opts.quorum, qi++) : (opts.quorum ?? true),
    runCycle: async () => { cycleRuns++; },
    tokensSpent: () => opts.tokens ?? 0,
  };
  return { deps, runs: () => cycleRuns };
}

test('steady external progress → runs to the cycle cap, stops on cap (not a ceiling)', async () => {
  const { deps, runs } = fakes({ groundingSeq: [0.1, 0.2, 0.3, 0.4] }); // grounding moves every cycle
  const s = await runAutonomousLoop(deps, { maxCycles: 3, ceilingPatience: 3 });
  assert.equal(s.status, 'stopped');
  assert.equal(s.ceilingHit, false, 'reaching the cap is not a capability ceiling');
  assert.equal(runs(), 3);
  assert.equal(s.groundingStart, 0.1);
});

test('grounding never moves → STOPS at the capability ceiling (ceilingHit) after patience', async () => {
  const { deps, runs } = fakes({ groundingSeq: [0.2] }); // always 0.2 — no movement ever
  const s = await runAutonomousLoop(deps, { maxCycles: 20, ceilingPatience: 3 });
  assert.equal(s.status, 'stopped');
  assert.equal(s.ceilingHit, true);
  assert.equal(runs(), 3, 'runs exactly patience cycles before the honest stall');
  assert.match(s.finalReason, /capability ceiling/i);
});

test('degraded panel up front → PAUSE, zero build cycles spent', async () => {
  const { deps, runs } = fakes({ groundingSeq: [0.2], quorum: false });
  const s = await runAutonomousLoop(deps, { maxCycles: 10 });
  assert.equal(s.status, 'paused');
  assert.equal(runs(), 0, 'never spends a build cycle on a panel that cannot cross-check itself');
  assert.match(s.finalReason, /quorum/i);
});

test('budget exhausted up front → STOP (not a ceiling), zero cycles', async () => {
  const { deps, runs } = fakes({ groundingSeq: [0.2], tokens: 1_000_000 });
  const s = await runAutonomousLoop(deps, { maxCycles: 10, tokenBudget: 1_000_000 });
  assert.equal(s.status, 'stopped');
  assert.equal(s.ceilingHit, false);
  assert.equal(runs(), 0);
  assert.match(s.finalReason, /budget/i);
});

test('progress THEN stall → climbs while it can, then stops honestly at the ceiling', async () => {
  // start 0.1; c1→0.3 (progress, stale 0); c2,c3,c4 stay 0.3 (stale 1,2,3 → ceiling at c4)
  const { deps, runs } = fakes({ groundingSeq: [0.1, 0.3, 0.3, 0.3, 0.3] });
  const s = await runAutonomousLoop(deps, { maxCycles: 20, ceilingPatience: 3 });
  assert.equal(s.status, 'stopped');
  assert.equal(s.ceilingHit, true);
  assert.equal(s.groundingStart, 0.1);
  assert.equal(s.groundingEnd, 0.3, 'kept the real progress it made before stalling');
  assert.equal(runs(), 4);
});

test('panel drops MID-run → pauses at that cycle, keeps the cycles already run', async () => {
  const { deps, runs } = fakes({ groundingSeq: [0.1, 0.2, 0.3], quorum: [true, true, false] });
  const s = await runAutonomousLoop(deps, { maxCycles: 10, ceilingPatience: 5 });
  assert.equal(s.status, 'paused');
  assert.equal(runs(), 2, 'ran cycles 1 and 2, paused before cycle 3 when the panel dropped');
});
