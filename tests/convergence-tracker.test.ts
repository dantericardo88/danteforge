// convergence-tracker.test.ts — Unit tests for pure convergence-tracker functions.
// Covers all exported functions with 12+ assertions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConvergenceState,
  recordConvergenceSnapshot,
  isConvergenceStuck,
  computeConvergenceVelocity,
  formatConvergenceReport,
  type ConvergenceState,
} from '../src/core/convergence-tracker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a state with N recorded snapshots of given scores. */
function buildState(
  scores: number[],
  start = 6.0,
  target = 9.0,
  dimension = 'test-dim',
): ConvergenceState {
  let state = createConvergenceState(dimension, start, target);
  for (const s of scores) {
    state = recordConvergenceSnapshot(state, s, '2026-05-14T00:00:00Z');
  }
  return state;
}

// ── createConvergenceState ────────────────────────────────────────────────────

describe('createConvergenceState', () => {
  it('sets startScore and currentScore to initial value', () => {
    const state = createConvergenceState('autonomy', 7.5, 9.0);
    assert.equal(state.startScore, 7.5);
    assert.equal(state.currentScore, 7.5);
  });

  it('sets targetScore correctly', () => {
    const state = createConvergenceState('autonomy', 7.5, 9.0);
    assert.equal(state.targetScore, 9.0);
  });

  it('starts with empty snapshots array', () => {
    const state = createConvergenceState('autonomy', 7.5, 9.0);
    assert.deepEqual(state.snapshots, []);
  });

  it('isConverged is true when startScore >= target', () => {
    const state = createConvergenceState('autonomy', 9.5, 9.0);
    assert.equal(state.isConverged, true);
  });

  it('isConverged is false when startScore < target', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    assert.equal(state.isConverged, false);
  });

  it('plateauCount starts at 0', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    assert.equal(state.plateauCount, 0);
  });
});

// ── recordConvergenceSnapshot ─────────────────────────────────────────────────

describe('recordConvergenceSnapshot', () => {
  it('appends a snapshot with correct cycle number', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    const next = recordConvergenceSnapshot(state, 7.5);
    assert.equal(next.snapshots.length, 1);
    assert.equal(next.snapshots[0]!.cycle, 1);
  });

  it('updates currentScore to new score', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    const next = recordConvergenceSnapshot(state, 8.0);
    assert.equal(next.currentScore, 8.0);
  });

  it('computes positive delta when score improves', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    const next = recordConvergenceSnapshot(state, 7.8);
    assert.ok(next.snapshots[0]!.delta > 0, 'delta should be positive');
    assert.ok(Math.abs(next.snapshots[0]!.delta - 0.8) < 0.0001);
  });

  it('marks improved=true when score goes up', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    const next = recordConvergenceSnapshot(state, 7.5);
    assert.equal(next.snapshots[0]!.improved, true);
  });

  it('marks improved=false when score drops', () => {
    const state = createConvergenceState('autonomy', 8.0, 9.0);
    const next = recordConvergenceSnapshot(state, 7.5);
    assert.equal(next.snapshots[0]!.improved, false);
  });

  it('sets isConverged=true when score reaches target', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    const next = recordConvergenceSnapshot(state, 9.0);
    assert.equal(next.isConverged, true);
  });

  it('increments plateauCount for consecutive tiny deltas', () => {
    const state = buildState([7.01, 7.02, 7.03], 7.0, 9.0);
    // All deltas < 0.1 → plateauCount should be 3
    assert.equal(state.plateauCount, 3);
    assert.equal(state.isPlateaued, true);
  });

  it('resets plateau streak after a significant improvement', () => {
    // 2 plateau cycles, then a big jump
    const state = buildState([7.01, 7.02, 8.5], 7.0, 9.0);
    // The last delta (8.5 - 7.02 = 1.48) breaks the plateau streak → count resets to 0
    assert.equal(state.plateauCount, 0, 'big improvement clears the plateau streak');
    assert.equal(state.isPlateaued, false);
  });

  it('does not mutate the original state', () => {
    const original = createConvergenceState('autonomy', 7.0, 9.0);
    recordConvergenceSnapshot(original, 8.0);
    assert.equal(original.snapshots.length, 0);
    assert.equal(original.currentScore, 7.0);
  });
});

// ── isConvergenceStuck ────────────────────────────────────────────────────────

describe('isConvergenceStuck', () => {
  it('returns false when isConverged=true', () => {
    const state = buildState([9.5], 7.0, 9.0);
    assert.equal(isConvergenceStuck(state), false);
  });

  it('returns true when plateaued and not converged', () => {
    const state = buildState([7.01, 7.02, 7.03], 7.0, 9.0);
    assert.equal(isConvergenceStuck(state), true);
  });

  it('respects custom maxPlateaus parameter', () => {
    // 2 plateau cycles but maxPlateaus=5 → not stuck yet
    const state = buildState([7.01, 7.02], 7.0, 9.0);
    assert.equal(isConvergenceStuck(state, 5), false);
    assert.equal(isConvergenceStuck(state, 2), true);
  });
});

// ── computeConvergenceVelocity ────────────────────────────────────────────────

describe('computeConvergenceVelocity', () => {
  it('returns 0 with no snapshots', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    assert.equal(computeConvergenceVelocity(state), 0);
  });

  it('returns 0 with only one snapshot', () => {
    const state = buildState([7.5], 7.0, 9.0);
    assert.equal(computeConvergenceVelocity(state), 0);
  });

  it('computes correct average delta per cycle', () => {
    // Start 6.0, scores [7.0, 8.0, 9.0]: total delta = 3.0, over 3 cycles → 1.0 avg
    const state = buildState([7.0, 8.0, 9.0], 6.0, 10.0);
    const velocity = computeConvergenceVelocity(state);
    assert.ok(Math.abs(velocity - 1.0) < 0.0001, `expected 1.0 got ${velocity}`);
  });

  it('returns negative velocity when score overall declined', () => {
    const state = buildState([5.5, 5.0], 6.0, 9.0);
    assert.ok(computeConvergenceVelocity(state) < 0);
  });
});

// ── formatConvergenceReport ───────────────────────────────────────────────────

describe('formatConvergenceReport', () => {
  it('includes dimension name in the report header', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    const report = formatConvergenceReport(state);
    assert.ok(report.includes('autonomy'), 'report should mention dimension name');
  });

  it('shows CONVERGED status when isConverged', () => {
    const state = buildState([9.5], 7.0, 9.0);
    const report = formatConvergenceReport(state);
    assert.ok(report.includes('CONVERGED'));
  });

  it('shows PLATEAUED status when isPlateaued and not converged', () => {
    const state = buildState([7.01, 7.02, 7.03], 7.0, 9.0);
    const report = formatConvergenceReport(state);
    assert.ok(report.includes('PLATEAUED'));
  });

  it('shows IN PROGRESS when neither converged nor plateaued', () => {
    const state = buildState([7.5], 7.0, 9.0);
    const report = formatConvergenceReport(state);
    assert.ok(report.includes('IN PROGRESS'));
  });

  it('includes a table row per snapshot', () => {
    const state = buildState([7.5, 8.0, 8.5], 7.0, 9.0);
    const report = formatConvergenceReport(state);
    // Each row starts with "| N |"
    assert.ok(report.includes('| 1 |'));
    assert.ok(report.includes('| 2 |'));
    assert.ok(report.includes('| 3 |'));
  });

  it('produces placeholder when no cycles recorded', () => {
    const state = createConvergenceState('autonomy', 7.0, 9.0);
    const report = formatConvergenceReport(state);
    assert.ok(report.includes('No cycles'));
  });
});
