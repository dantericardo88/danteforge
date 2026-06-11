// LAW L8 — EVIDENCE-BOUND ROUTING: never dispatch a builder against an already-passing
// capability metric.
//
// Live finding, fleet run 3 (DanteForge-on-DanteForge): documentation's capability test already
// passed, so the exit-code metric baselined at 0 — structurally unimprovable — and autoresearch
// burned 11 straight agent experiments on guaranteed discards. A passing capability with a
// sub-target score means the gap is EVIDENCE (missing/stale outcomes), not capability: the loop
// must run the depth pass and, if the score holds, stop with the honest evidence-bound verdict.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runHardenCrusade } from '../../src/cli/commands/harden-crusade.js';
import type { CompeteMatrix } from '../../src/core/compete-matrix.js';

function matrixWith(dimId: string): CompeteMatrix {
  return {
    project: 'law-l8', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: new Date().toISOString(), overallSelfScore: 5,
    dimensions: [{
      id: dimId, label: dimId, weight: 1, category: 'quality', frequency: 'high',
      scores: { self: 5.0 }, gap_to_leader: 2, leader: 'x',
      gap_to_closed_source_leader: 2, closed_source_leader: 'x', gap_to_oss_leader: 0, oss_leader: '',
      status: 'in-progress', sprint_history: [], next_sprint_target: 7,
      capability_test: { command: 'node -e "process.exit(0)"', description: 'real probe' },
    }],
  } as unknown as CompeteMatrix;
}

function baseOpts(dimId: string, recorded: { dispatches: string[] }, capExit: number, scores: number[]) {
  const scoreQueue = [...scores];
  return {
    goal: 'law l8', parallel: 1, target: 7, maxDimCycles: 6, timeMinutes: 18, skipLLMCheck: true, skipCIP: true,
    _loadMatrix: async () => matrixWith(dimId),
    _runCapTest: async () => capExit,
    _runAutoResearch: async (id: string) => { recorded.dispatches.push(id); },
    _runOutcomesForDim: async () => {},
    _getScore: async () => scoreQueue.length > 1 ? scoreQueue.shift()! : scoreQueue[0]!,
    _runHardenForDim: async () => ({ allowed: false, scoreCap: 7, failedChecks: [] }),
    _writeFile: async () => {},
    _loadState: null,
  };
}

describe('L8 — a passing capability metric NEVER receives a builder dispatch', () => {
  test('cap-test exit 0 → autoresearch skipped, depth pass runs, honest evidence-bound stop', async () => {
    const recorded = { dispatches: [] as string[] };
    const result = await runHardenCrusade(baseOpts('docs_dim', recorded, 0, [5.0, 5.0]) as never);
    assert.equal(recorded.dispatches.length, 0, 'no builder may be dispatched against exit-0 (unimprovable) metric');
    const report = JSON.stringify(result);
    assert.match(report, /evidence-bound/, 'the stop names the real remaining work');
    assert.match(report, /AT_CEILING|CHECKPOINT/, 'the dim stops honestly instead of grinding cycles');
  });

  test('NEGATIVE control — a FAILING capability test (the real build case) still dispatches the builder', async () => {
    const recorded = { dispatches: [] as string[] };
    await runHardenCrusade(baseOpts('build_dim', recorded, 1, [5.0, 5.0]) as never);
    assert.ok(recorded.dispatches.length >= 1, 'a failing capability is exactly what builders are for — the law must not block it');
  });

  test('evidence-bound depth pass that MOVES the score is not stopped (progress continues)', async () => {
    const recorded = { dispatches: [] as string[] };
    // First in-cycle refresh returns 7.2 (the depth pass lifted the score from the 5.0 self).
    const result = await runHardenCrusade(baseOpts('moving_dim', recorded, 0, [7.2, 7.2]) as never);
    assert.equal(recorded.dispatches.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /evidence-bound:/, 'a depth pass that lifts the score continues the loop, no premature ceiling');
  });
});
