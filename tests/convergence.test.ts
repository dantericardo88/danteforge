// Convergence — unit tests for tracking, plateau detection, and chart rendering.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  initConvergence,
  updateDimension,
  isFullyConverged,
  detectPlateau,
  renderConvergenceChart,
  loadConvergence,
  saveConvergence,
  type ConvergenceState,
  type CycleRecord,
} from '../src/core/convergence.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-convergence-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function makeCycleRecord(cycle: number, before: Record<string, number>, after: Record<string, number>): CycleRecord {
  return {
    cycle,
    timestamp: new Date().toISOString(),
    adoptionsAttempted: 3,
    adoptionsSucceeded: 2,
    scoresBefore: before,
    scoresAfter: after,
    costUsd: 0.5,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Convergence — initConvergence', () => {

  it('T1: initConvergence sets targetScore and empty dimensions', () => {
    const state = initConvergence(9.0);
    assert.strictEqual(state.targetScore, 9.0);
    assert.deepStrictEqual(state.dimensions, []);
    assert.deepStrictEqual(state.cycleHistory, []);
    assert.strictEqual(state.lastCycle, 0);
    assert.strictEqual(state.version, '1.0.0');
  });

  it('initConvergence with custom target score', () => {
    const state = initConvergence(8.5);
    assert.strictEqual(state.targetScore, 8.5);
  });

});

describe('Convergence — updateDimension', () => {

  it('T2: updateDimension adds new dimension with scoreHistory=[score]', () => {
    const state = initConvergence(9.0);
    const result = updateDimension(state, 'circuit-breaker', 5.0);

    assert.strictEqual(result.dimensions.length, 1);
    assert.strictEqual(result.dimensions[0]!.dimension, 'circuit-breaker');
    assert.strictEqual(result.dimensions[0]!.score, 5.0);
    assert.deepStrictEqual(result.dimensions[0]!.scoreHistory, [5.0]);
  });

  it('T3: updateDimension appends to scoreHistory on second call', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'testing', 4.0);
    state = updateDimension(state, 'testing', 6.5);

    const dim = state.dimensions[0]!;
    assert.deepStrictEqual(dim.scoreHistory, [4.0, 6.5]);
    assert.strictEqual(dim.score, 6.5);
  });

  it('updateDimension preserves evidence list', () => {
    const state = initConvergence(9.0);
    const result = updateDimension(state, 'security', 7.0, ['src/core/encryption.ts', 'tests/security.test.ts']);
    assert.deepStrictEqual(result.dimensions[0]!.evidence, ['src/core/encryption.ts', 'tests/security.test.ts']);
  });

  it('updateDimension handles multiple dimensions independently', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'security', 5.0);
    state = updateDimension(state, 'performance', 7.0);
    state = updateDimension(state, 'security', 6.5);

    const security = state.dimensions.find(d => d.dimension === 'security')!;
    const perf = state.dimensions.find(d => d.dimension === 'performance')!;
    assert.deepStrictEqual(security.scoreHistory, [5.0, 6.5]);
    assert.deepStrictEqual(perf.scoreHistory, [7.0]);
  });

});

describe('Convergence — isFullyConverged', () => {

  it('T4: isFullyConverged returns false when any dimension < targetScore', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'security', 9.2);
    state = updateDimension(state, 'security', 9.2); // 2nd score for stability
    state = updateDimension(state, 'performance', 7.0);
    state = updateDimension(state, 'performance', 7.0);

    assert.strictEqual(isFullyConverged(state), false);
  });

  it('T5: isFullyConverged returns true when all dimensions >= target AND stable', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'security', 9.1);
    state = updateDimension(state, 'security', 9.1); // stable (diff = 0)
    state = updateDimension(state, 'performance', 9.2);
    state = updateDimension(state, 'performance', 9.2); // stable (diff = 0)

    assert.strictEqual(isFullyConverged(state), true);
  });

  it('T6: isFullyConverged returns false when stable but only 1 score in history', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'security', 9.5);
    // Only 1 entry in scoreHistory — not enough to confirm stability

    assert.strictEqual(isFullyConverged(state), false);
  });

  it('isFullyConverged returns false with empty dimensions', () => {
    const state = initConvergence(9.0);
    assert.strictEqual(isFullyConverged(state), false);
  });

});

describe('Convergence — detectPlateau', () => {

  it('T7: detectPlateau returns false when improvement > 0.5 in window', () => {
    let state = initConvergence(9.0);
    state = {
      ...state,
      cycleHistory: [
        makeCycleRecord(1, { dim: 4.0 }, { dim: 5.5 }),  // +1.5 improvement
        makeCycleRecord(2, { dim: 5.5 }, { dim: 7.0 }),  // +1.5 improvement
        makeCycleRecord(3, { dim: 7.0 }, { dim: 8.2 }),  // +1.2 improvement
      ],
    };
    assert.strictEqual(detectPlateau(state), false);
  });

  it('T8: detectPlateau returns true when 3 consecutive cycles produce < 0.5 total improvement', () => {
    let state = initConvergence(9.0);
    state = {
      ...state,
      cycleHistory: [
        makeCycleRecord(1, { dim: 7.0 }, { dim: 7.1 }),  // +0.1
        makeCycleRecord(2, { dim: 7.1 }, { dim: 7.2 }),  // +0.1
        makeCycleRecord(3, { dim: 7.2 }, { dim: 7.3 }),  // +0.1 → total 0.3 < 0.5
      ],
    };
    assert.strictEqual(detectPlateau(state), true);
  });

  it('T9: detectPlateau returns false when fewer than windowSize (3) cycles', () => {
    let state = initConvergence(9.0);
    state = {
      ...state,
      cycleHistory: [
        makeCycleRecord(1, { dim: 7.0 }, { dim: 7.1 }),
        makeCycleRecord(2, { dim: 7.1 }, { dim: 7.2 }),
      ],
    };
    assert.strictEqual(detectPlateau(state), false);
  });

  it('detectPlateau uses only the last windowSize cycles', () => {
    let state = initConvergence(9.0);
    // First 3 cycles: big improvements; last 3: plateau
    state = {
      ...state,
      cycleHistory: [
        makeCycleRecord(1, { dim: 3.0 }, { dim: 5.0 }),  // old: +2.0
        makeCycleRecord(2, { dim: 5.0 }, { dim: 7.0 }),  // old: +2.0
        makeCycleRecord(3, { dim: 7.0 }, { dim: 7.1 }),  // recent: +0.1
        makeCycleRecord(4, { dim: 7.1 }, { dim: 7.2 }),  // recent: +0.1
        makeCycleRecord(5, { dim: 7.2 }, { dim: 7.3 }),  // recent: +0.1 → plateau
      ],
    };
    assert.strictEqual(detectPlateau(state), true);
  });

});

describe('Convergence — renderConvergenceChart', () => {

  it('T10: renderConvergenceChart produces ASCII bars for each dimension', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'circuit-breaker', 7.5);
    state = updateDimension(state, 'streaming', 3.0);

    const chart = renderConvergenceChart(state);
    assert.ok(chart.includes('circuit-breaker'), 'chart must include dimension name');
    assert.ok(chart.includes('7.5'), 'chart must include score');
    assert.ok(chart.includes('█'), 'chart must have filled bars');
    assert.ok(chart.includes('░'), 'chart must have empty bars');
  });

  it('T11: renderConvergenceChart marks converged dimensions with ✓', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'security', 9.2);
    state = updateDimension(state, 'security', 9.2);  // converged: stable >= 9.0

    const chart = renderConvergenceChart(state);
    assert.ok(chart.includes('✓ CONVERGED'), 'converged dimension must be marked');
  });

  it('renderConvergenceChart shows arrow for unconverged dimension', () => {
    let state = initConvergence(9.0);
    state = updateDimension(state, 'testing', 5.0);

    const chart = renderConvergenceChart(state);
    assert.ok(chart.includes('→ 9.0'), 'unconverged dimension must show target arrow');
  });

  it('renderConvergenceChart returns placeholder for empty dimensions', () => {
    const state = initConvergence(9.0);
    const chart = renderConvergenceChart(state);
    assert.ok(chart.includes('no dimensions'), 'empty state must show placeholder');
  });

});

describe('Convergence — persistence', () => {

  it('T12: loadConvergence + saveConvergence round-trip preserves all fields', async () => {
    const dir = await makeTempDir();
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });

    let state = initConvergence(9.0);
    state = updateDimension(state, 'testing', 6.5, ['tests/foo.test.ts']);
    state = { ...state, lastCycle: 3, totalCostUsd: 12.50 };

    await saveConvergence(state, dir);
    const loaded = await loadConvergence(dir);

    assert.strictEqual(loaded.targetScore, 9.0);
    assert.strictEqual(loaded.lastCycle, 3);
    assert.strictEqual(loaded.totalCostUsd, 12.50);
    assert.strictEqual(loaded.dimensions.length, 1);
    assert.strictEqual(loaded.dimensions[0]!.dimension, 'testing');
    assert.strictEqual(loaded.dimensions[0]!.score, 6.5);
  });

  it('loadConvergence returns fresh state when file not found', async () => {
    const dir = await makeTempDir();
    const state = await loadConvergence(dir);
    assert.strictEqual(state.dimensions.length, 0);
    assert.strictEqual(state.lastCycle, 0);
  });

});
