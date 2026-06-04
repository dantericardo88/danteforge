// sweep-orchestrator.test.ts — pure phase scheduling over band-state; every action is delegated.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runFullSweep, type SweepDeps } from '../src/core/sweep-orchestrator.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

const mtx = (scores: number[]): CompeteMatrix => ({
  project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0,
  dimensions: scores.map((s, i) => ({ id: `d${i}`, label: `d${i}`, weight: 1, scores: { self: s } })),
} as unknown as CompeteMatrix);

function deps(states: CompeteMatrix[], over: Partial<SweepDeps> = {}): SweepDeps & { log: string[] } {
  let call = 0;
  const log: string[] = [];
  return Object.assign({ log }, {
    loadMatrix: async () => states[Math.min(call, states.length - 1)] ?? null,
    runDispatch: async (_c: string, t: number) => { log.push(`dispatch:${t}`); call++; },
    runDepthWave: async (_c: string, id: string) => { log.push(`depthwave:${id}`); return { promoted: true }; },
    runAscendFrontier: async () => { log.push('ascend'); },
    ...over,
  });
}

describe('runFullSweep', () => {
  it('Phase 1 dispatches when below-5 dims exist', async () => {
    const d = deps([mtx([2, 6])]);
    await runFullSweep('/p', { target: 5 }, d);
    assert.ok(d.log.includes('dispatch:5'));
  });

  it('runs phases in order: to-5 → pilot-7 → sweep-7 → depth-9', async () => {
    // snapshot 1: a below5 + a 5-7 + a 7-9; later snapshots keep the 5-7 and 7-9 around.
    const d = deps([mtx([2, 6, 8]), mtx([5, 6, 8]), mtx([5, 6, 8]), mtx([5, 6, 8]), mtx([5, 6, 8])]);
    const r = await runFullSweep('/p', { target: 9 }, d);
    assert.deepEqual(r.phasesRun, ['to-5', 'pilot-7', 'sweep-7', 'depth-9']);
    assert.ok(d.log.includes('ascend'), '7→9 delegated to ascend-frontier');
  });

  it('STOPS before the full sweep when the pilot moves nothing', async () => {
    const d = deps([mtx([6, 6]), mtx([6, 6])], { runDepthWave: async () => ({ promoted: false }) });
    const r = await runFullSweep('/p', { target: 9 }, d);
    assert.ok(r.phasesRun.includes('pilot-7'));
    assert.ok(!r.phasesRun.includes('sweep-7'), 'no full sweep after a dead pilot');
    assert.ok(!r.phasesRun.includes('depth-9'), 'no 7→9 after a dead pilot');
    assert.match(r.stoppedEarly ?? '', /pilot moved nothing/);
  });

  it('does not delegate to ascend-frontier when target ≤ 7', async () => {
    const d = deps([mtx([6, 8]), mtx([6, 8]), mtx([6, 8]), mtx([6, 8])]);
    const r = await runFullSweep('/p', { target: 7 }, d);
    assert.ok(!d.log.includes('ascend'));
    assert.ok(!r.phasesRun.includes('depth-9'));
  });
});
