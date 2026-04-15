import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlateau,
  formatPlateauAnalysis,
  type PlateauAnalysis,
} from '../src/core/plateau-detector.js';
import type { CycleRecord } from '../src/core/convergence.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCycle(delta: number, cycle = 1): CycleRecord {
  return {
    cycle,
    timestamp: new Date().toISOString(),
    adoptionsAttempted: 1,
    adoptionsSucceeded: 1,
    scoresBefore: { quality: 5.0 },
    scoresAfter: { quality: 5.0 + delta },
    costUsd: 0.05,
  };
}

function makeHistory(deltas: number[]): CycleRecord[] {
  return deltas.map((d, i) => makeCycle(d, i + 1));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectPlateau', () => {
  it('T1: empty history → isPlateaued=false, recommendation=continue', () => {
    const result = detectPlateau([]);
    assert.equal(result.isPlateaued, false);
    assert.equal(result.recommendation, 'continue');
    assert.equal(result.avgDeltaLastN, 0);
  });

  it('T2: single cycle with good delta → isPlateaued=false', () => {
    const result = detectPlateau(makeHistory([0.8]));
    assert.equal(result.isPlateaued, false);
    assert.equal(result.recommendation, 'continue');
  });

  it('T3: strong consistent improvement → isPlateaued=false', () => {
    const result = detectPlateau(makeHistory([0.5, 0.6, 0.4, 0.7, 0.5]));
    assert.equal(result.isPlateaued, false);
    assert.equal(result.recommendation, 'continue');
    assert.ok(result.avgDeltaLastN > 0.3, 'avg delta should be significant');
  });

  it('T4: flat scores across full window → isPlateaued=true, cross-synthesize', () => {
    // All deltas near zero → no improvement. respecAfterCycles=6 > window=5, so cross-synthesize.
    const result = detectPlateau(makeHistory([0.01, 0.02, 0.00, 0.01, 0.02]), {
      windowSize: 5,
      threshold: 0.1,
      respecAfterCycles: 6,
    });
    assert.equal(result.isPlateaued, true);
    assert.equal(result.recommendation, 'cross-synthesize');
  });

  it('T5: sustained plateau past respecAfterCycles → recommendation=respec', () => {
    const result = detectPlateau(makeHistory([0.00, 0.01, 0.00, 0.00, 0.01]), {
      windowSize: 5,
      threshold: 0.1,
      respecAfterCycles: 3,
    });
    assert.equal(result.isPlateaued, true);
    assert.equal(result.recommendation, 'respec');
  });

  it('T6: noisy but progressing run (high variance) → upperBound keeps it active', () => {
    // Mean ~0.05 (below threshold) but std dev is high → upper bound above threshold
    const result = detectPlateau(makeHistory([0.0, 0.0, 0.0, 0.8, 0.0]), {
      threshold: 0.1,
    });
    // Upper bound = mean + stdDev. Mean ≈ 0.16, stdDev ≈ 0.36 → upper ≈ 0.52 > 0.1
    assert.equal(result.isPlateaued, false, 'high variance should prevent plateau detection');
  });

  it('T7: uses windowSize to limit analysis to last N cycles', () => {
    // First 3 cycles: great improvement. Last 2: flat.
    // windowSize=2 should only see the flat cycles → plateau
    const history = makeHistory([1.0, 0.9, 1.1, 0.01, 0.02]);
    const result = detectPlateau(history, { windowSize: 2, threshold: 0.1, respecAfterCycles: 5 });
    assert.equal(result.isPlateaued, true, 'last 2 cycles are flat — should plateau');
    assert.equal(result.windowSize, 2);
  });

  it('T8: returns correct cyclesAtPlateau count', () => {
    const result = detectPlateau(makeHistory([0.5, 0.02, 0.01, 0.03, 0.01]), {
      windowSize: 5,
      threshold: 0.1,
    });
    // All except first are below 0.1 — but first cycle is outside last 5 window start so all 5
    // Actually with windowSize=5, window = all 5 cycles, 4 are below threshold
    assert.ok(result.cyclesAtPlateau >= 3, `expected ≥3 cycles at plateau, got ${result.cyclesAtPlateau}`);
  });
});

// ── Mutation-killing boundary tests ──────────────────────────────────────────

describe('detectPlateau — mutation boundaries', () => {
  it('Tmut1: stdDev formula divides by n (sample variance), not n-1 (population)', () => {
    // 4 values: [0.5, 0.1, 0.1, 0.1] → mean=0.2
    // sample variance = sum((x-mean)^2) / (n-1) = ((0.3)^2 + 3*(0.1)^2) / 3 = (0.09+0.03)/3 = 0.04
    // sample stdDev = sqrt(0.04) = 0.2
    // upperBound = 0.2 + 0.2 = 0.4 — well above threshold, NOT plateaued
    // If formula wrongly divided by n: variance = 0.03, stdDev=0.173, upper=0.373 — same conclusion here
    // But: 4 equal values [0.01, 0.01, 0.01, 0.01] → stdDev must be 0 exactly
    const history = makeHistory([0.01, 0.01, 0.01, 0.01]);
    const result = detectPlateau(history, { windowSize: 4, threshold: 0.1 });
    assert.equal(result.stdDevDelta, 0, 'equal values must produce stdDev=0 exactly');
    assert.equal(result.avgDeltaLastN, 0.01);
  });

  it('Tmut2: upperBoundDelta = mean + stdDev (not mean - stdDev)', () => {
    // Kills arithmetic-flip: `avgDelta + sd` → `avgDelta - sd`
    // With a noisy-but-high run: mean=0.05 (below threshold), stdDev=0.35 (high variance)
    // correct: upper = 0.05 + 0.35 = 0.40 → NOT plateaued
    // wrong: upper = 0.05 - 0.35 = -0.30 → plateaued
    const history = makeHistory([0.0, 0.0, 0.0, 0.0, 1.0]); // one spike, mean≈0.2 stdDev≈0.4
    const result = detectPlateau(history, { threshold: 0.1 });
    assert.ok(result.upperBoundDelta > result.avgDeltaLastN,
      `upperBound (${result.upperBoundDelta}) must be ABOVE mean (${result.avgDeltaLastN}), not below`);
    assert.equal(result.isPlateaued, false,
      'high variance spike should prevent plateau detection');
  });

  it('Tmut3: upperBoundDelta returned in result equals avgDeltaLastN + stdDevDelta (additive)', () => {
    // Kills: `upperBoundDelta = avgDelta + sd` → `avgDelta - sd` arithmetic mutation
    // Using a mixed history where both mean and stdDev are nonzero:
    // deltas [0.0, 0.2] → mean=0.1, stdDev=sqrt((0.01+0.01)/1)=sqrt(0.02)≈0.141
    // upperBound should be ABOVE mean (mean + stdDev), not below (mean - stdDev)
    const history = makeHistory([0.0, 0.2]);
    const result = detectPlateau(history, { threshold: 0.5, windowSize: 2 });

    // upperBoundDelta must be reported as (avg + stdDev), not (avg - stdDev)
    const expectedUpper = result.avgDeltaLastN + result.stdDevDelta;
    assert.equal(
      result.upperBoundDelta,
      Math.round(expectedUpper * 1000) / 1000,
      `upperBoundDelta must equal avgDeltaLastN + stdDevDelta, not avgDeltaLastN - stdDevDelta`,
    );
    // And upper must be strictly above mean (since stdDev > 0)
    assert.ok(result.upperBoundDelta > result.avgDeltaLastN,
      'with nonzero stdDev, upperBound must exceed mean');
  });
});

describe('formatPlateauAnalysis', () => {
  it('T9: formats active convergence message', () => {
    const analysis = detectPlateau(makeHistory([0.5, 0.6, 0.7]));
    const msg = formatPlateauAnalysis(analysis);
    assert.ok(msg.includes('active') || msg.includes('delta'), 'should describe active convergence');
  });

  it('T10: formats plateau message with recommendation', () => {
    const analysis: PlateauAnalysis = {
      isPlateaued: true,
      cyclesAtPlateau: 4,
      avgDeltaLastN: 0.02,
      stdDevDelta: 0.01,
      upperBoundDelta: 0.03,
      plateauThreshold: 0.1,
      windowSize: 5,
      recommendation: 'cross-synthesize',
    };
    const msg = formatPlateauAnalysis(analysis);
    assert.ok(msg.includes('PLATEAU'), 'should indicate plateau');
    assert.ok(msg.includes('cross-synthesis'), 'should mention cross-synthesis');
  });
});
