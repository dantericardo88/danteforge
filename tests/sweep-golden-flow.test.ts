// sweep-golden-flow.test.ts — Stage 13: the assembled chain end-to-end. The orchestrator drives the
// REAL depth-wave, which promotes through the REAL writeVerifiedScore gate, over one shared in-memory
// matrix. Proves a dim climbs band-by-band AND the gate's integrity caps hold across the whole chain.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runFullSweep, type SweepDeps } from '../src/core/sweep-orchestrator.js';
import { runDepthWave } from '../src/core/depth-wave.js';
import { promoteVerifiedScore } from '../src/core/promote-score.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function makeMatrix(): CompeteMatrix {
  return {
    project: 'golden', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0,
    dimensions: [
      { id: 'low', label: 'low', weight: 1, scores: { self: 3 }, gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '', gap_to_oss_leader: 0, oss_leader: '', status: 'in-progress', sprint_history: [], next_sprint_target: 9 },
      { id: 'mid', label: 'mid', weight: 1, scores: { self: 5.5 }, gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '', gap_to_oss_leader: 0, oss_leader: '', status: 'in-progress', sprint_history: [], next_sprint_target: 9 },
      { id: 'high', label: 'high', weight: 1, scores: { self: 7.5 }, gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '', gap_to_oss_leader: 0, oss_leader: '', status: 'in-progress', sprint_history: [], next_sprint_target: 9 },
    ],
  } as unknown as CompeteMatrix;
}
const score = (m: CompeteMatrix, id: string) => m.dimensions.find(d => d.id === id)!.scores.self;
const setDerived = (m: CompeteMatrix, id: string, v: number) => { (m.dimensions.find(d => d.id === id)!.scores as Record<string, number>).derived = v; };

describe('sweep golden flow (real depth-wave + real promote gate)', () => {
  it('climbs low→5, mid→7, delegates high; and the gate holds when capability passes', async () => {
    const matrix = makeMatrix();
    let delegated = false;
    const deps: SweepDeps = {
      loadMatrix: async () => matrix,
      // Phase 1: simulate dim-dispatch promoting the below-5 dim to 5 through the REAL gate.
      runDispatch: async () => { setDerived(matrix, 'low', 5); promoteVerifiedScore(matrix, 'low', { capabilityTestPassed: true, agent: 'dispatch' }); },
      // Phase 2/3: the REAL depth-wave — validate produces a T4 receipt (derived 7), capability passes → promote.
      runDepthWave: async (cwd, dimId) => runDepthWave(cwd, dimId, {
        runValidate: async () => { setDerived(matrix, dimId, 7); },
        loadMatrix: async () => matrix,
        saveMatrix: async () => {},
        capabilityTestPassed: async () => true,
      }),
      runAscendFrontier: async () => { delegated = true; },
    };

    const r = await runFullSweep('/p', { target: 9 }, deps);

    assert.equal(score(matrix, 'low'), 7, 'below-5 dim climbed two bands: 3→5 (dispatch) then 5→7 (depth-wave)');
    assert.equal(score(matrix, 'mid'), 7, 'mid dim climbed 5.5→7 via real depth-wave + promote');
    assert.equal(delegated, true, 'the ≥7 dim was delegated to ascend-frontier (not depth-waved)');
    assert.deepEqual(r.phasesRun, ['to-5', 'pilot-7', 'sweep-7', 'depth-9']);
    // No score was written without provenance — every raise produced an audit entry.
    assert.ok((matrix.scoreProvenance ?? []).length >= 2);
  });

  it('the gate caps mid at 5 when validate runs but the capability_test does NOT pass (no fake 7)', async () => {
    const matrix = makeMatrix();
    const deps: SweepDeps = {
      loadMatrix: async () => matrix,
      runDispatch: async () => {},
      runDepthWave: async (cwd, dimId) => runDepthWave(cwd, dimId, {
        runValidate: async () => { setDerived(matrix, dimId, 7); }, // derived claims 7…
        loadMatrix: async () => matrix,
        saveMatrix: async () => {},
        capabilityTestPassed: async () => false,                    // …but the capability_test fails
      }),
      runAscendFrontier: async () => {},
    };
    await runFullSweep('/p', { target: 7 }, deps);
    assert.equal(score(matrix, 'mid'), 5, 'unproven >5 is gate-clamped to 5 across the whole chain');
  });
});
