// depth-wave.test.ts — run validate, derive the higher-tier score, promote through the gate (5→7).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDepthWave, type DepthWaveDeps } from '../src/core/depth-wave.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function matrixWith(scores: Record<string, number>): CompeteMatrix {
  return { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0,
    dimensions: [{ id: 'd', label: 'd', weight: 1, scores }] } as unknown as CompeteMatrix;
}

function deps(over: Partial<DepthWaveDeps> = {}): DepthWaveDeps & { validated: boolean; saved: CompeteMatrix | null } {
  const state = { validated: false, saved: null as CompeteMatrix | null };
  return Object.assign(state, {
    runValidate: async () => { state.validated = true; },
    loadMatrix: async () => matrixWith({ self: 5, derived: 7 }), // validate produced a T4 receipt → derived 7
    saveMatrix: async (m: CompeteMatrix) => { state.saved = m; },
    capabilityTestPassed: async () => true,
    ...over,
  });
}

describe('runDepthWave', () => {
  it('runs validate, then promotes self up to the freshly-derived score (5→7)', async () => {
    const d = deps();
    const r = await runDepthWave('/proj', 'd', d);
    assert.equal(d.validated, true, 'validate ran first');
    assert.equal(r.after, 7);
    assert.equal(r.promoted, true);
    assert.ok(d.saved, 'matrix saved after a promote');
  });

  it('does not promote when validate produced no derived gain', async () => {
    const d = deps({ loadMatrix: async () => matrixWith({ self: 5 }) }); // no derived → nothing to promote
    const r = await runDepthWave('/proj', 'd', d);
    assert.equal(r.promoted, false);
    assert.equal(d.saved, null);
  });

  it('the gate caps self at 5 when the capability_test no longer passes (even if derived says 7)', async () => {
    const d = deps({ capabilityTestPassed: async () => false });
    const r = await runDepthWave('/proj', 'd', d);
    assert.equal(r.after, 5, 'unproven >5 is gate-clamped to 5');
  });
});
