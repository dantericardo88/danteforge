// Plateau Detector — statistical detection of convergence stalls.
// Determines when quality scores have stopped improving and recommends a strategy change.
//
// Inspired by:
//   - bencherdev/bencher: threshold-based alerting with statistical confidence
//   - optuna/optuna: MedianPruner interface — should_prune(trial, step) contract
//     adapted to should_switch_strategy(cycleHistory) for quality score cycles
//
// The key improvement over naive delta-check:
//   Instead of "delta < 0.1 for N consecutive cycles" (brittle to variance),
//   we compute the mean and std dev of score changes over the last window,
//   then test whether the upper bound of improvement (mean + 1σ) is below the threshold.
//   This separates genuine stalls from noisy-but-progressing runs.

import type { CycleRecord } from './convergence.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlateauRecommendation = 'continue' | 'cross-synthesize' | 'respec';

export interface PlateauAnalysis {
  /** Whether the system is currently in a plateau state. */
  isPlateaued: boolean;
  /** How many of the last `windowSize` cycles showed improvement below threshold. */
  cyclesAtPlateau: number;
  /** Mean score delta over the analysis window. */
  avgDeltaLastN: number;
  /** Standard deviation of deltas over the window. */
  stdDevDelta: number;
  /** Upper bound of plausible improvement: avgDelta + 1σ (bencher statistical pattern). */
  upperBoundDelta: number;
  /** The threshold used for plateau detection. */
  plateauThreshold: number;
  /** How many cycles were analysed. */
  windowSize: number;
  recommendation: PlateauRecommendation;
}

export interface PlateauDetectorOptions {
  /** Number of recent cycles to examine. Default: 5. */
  windowSize?: number;
  /** Score improvement below this per cycle is considered stalled. Default: 0.1. */
  threshold?: number;
  /** Number of consecutive stalled cycles required before recommending respec. Default: 3. */
  respecAfterCycles?: number;
}

// ── Core logic ────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Extract per-cycle average score improvements from cycle history.
 * Each CycleRecord has scoresBefore and scoresAfter; we compute the mean
 * delta across all dimensions for that cycle.
 */
function extractCycleDeltas(cycles: CycleRecord[]): number[] {
  return cycles.map(cycle => {
    const dims = Object.keys(cycle.scoresAfter);
    if (dims.length === 0) return 0;
    const deltas = dims.map(d => (cycle.scoresAfter[d] ?? 0) - (cycle.scoresBefore[d] ?? 0));
    return mean(deltas);
  });
}

/**
 * Detect whether the autoforge loop has plateaued.
 *
 * Uses the optuna MedianPruner approach adapted for score cycles:
 *   - Compute mean + stdDev of score improvements over the last N cycles
 *   - If upperBound (mean + 1σ) < threshold: plateau is statistically confirmed
 *   - This avoids false positives from noisy-but-progressing runs
 *
 * Recommendation logic:
 *   - 'continue': not plateaued yet
 *   - 'cross-synthesize': plateaued but OSS pool may have unexplored combinations
 *   - 'respec': plateaued for respecAfterCycles+ — current spec has no remaining signal
 */
export function detectPlateau(
  cycleHistory: CycleRecord[],
  opts: PlateauDetectorOptions = {},
): PlateauAnalysis {
  const windowSize = opts.windowSize ?? 5;
  const threshold = opts.threshold ?? 0.1;
  const respecAfterCycles = opts.respecAfterCycles ?? 3;

  if (cycleHistory.length === 0) {
    return {
      isPlateaued: false,
      cyclesAtPlateau: 0,
      avgDeltaLastN: 0,
      stdDevDelta: 0,
      upperBoundDelta: 0,
      plateauThreshold: threshold,
      windowSize,
      recommendation: 'continue',
    };
  }

  const window = cycleHistory.slice(-windowSize);
  const deltas = extractCycleDeltas(window);

  const avgDelta = mean(deltas);
  const sd = stdDev(deltas, avgDelta);
  // Upper bound: if even the optimistic estimate is below threshold, we're stalled
  const upperBoundDelta = avgDelta + sd;

  const cyclesAtPlateau = deltas.filter(d => d < threshold).length;
  const isPlateaued = upperBoundDelta < threshold && window.length >= Math.min(windowSize, 3);

  let recommendation: PlateauRecommendation = 'continue';
  if (isPlateaued) {
    recommendation = cyclesAtPlateau >= respecAfterCycles ? 'respec' : 'cross-synthesize';
  }

  return {
    isPlateaued,
    cyclesAtPlateau,
    avgDeltaLastN: Math.round(avgDelta * 1000) / 1000,
    stdDevDelta: Math.round(sd * 1000) / 1000,
    upperBoundDelta: Math.round(upperBoundDelta * 1000) / 1000,
    plateauThreshold: threshold,
    windowSize,
    recommendation,
  };
}

/**
 * Format a plateau analysis as a human-readable summary line.
 */
export function formatPlateauAnalysis(analysis: PlateauAnalysis): string {
  if (!analysis.isPlateaued) {
    return `Convergence active — avg delta +${analysis.avgDeltaLastN.toFixed(2)}/cycle over last ${analysis.windowSize} cycles`;
  }
  const rec = analysis.recommendation === 'cross-synthesize'
    ? 'switching to cross-synthesis mode'
    : 'recommending goal respec — current target exhausted';
  return `PLATEAU DETECTED — avg delta +${analysis.avgDeltaLastN.toFixed(2)}/cycle (upper bound ${analysis.upperBoundDelta.toFixed(2)} < threshold ${analysis.plateauThreshold}); ${rec}`;
}
