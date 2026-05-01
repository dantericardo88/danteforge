// causal-status — Show per-dimension prediction accuracy from the causal weight matrix
// Displays how well the convergence loop's forward model predicted actual outcomes.
// Data source: .danteforge/causal-weight-matrix.json (updated after each forge wave).

import { logger } from '../../core/logger.js';
import {
  loadCausalWeightMatrix,
  type CausalWeightMatrix,
  type DimensionAccuracy,
} from '../../core/causal-weight-matrix.js';

// ---------------------------------------------------------------------------
// Calibration narrative
// ---------------------------------------------------------------------------

const WELL_CALIBRATED_DIR = 0.75;
const WELL_CALIBRATED_MAG = 0.60;
const MAGNITUDE_OFF_MAG = 0.50;
const WEAK_DIRECTION = 0.50;
const MIN_SAMPLES = 3;

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Generate a human-readable calibration narrative from the causal weight matrix.
 * Returns an array of display lines (empty if no sufficient data exists).
 */
export function computeCalibrationNarrative(matrix: CausalWeightMatrix): string[] {
  const dimEntries = Object.entries(matrix.perDimensionAccuracy)
    .filter((e): e is [string, DimensionAccuracy] => e[1] !== undefined && e[1].sampleCount >= MIN_SAMPLES);

  if (dimEntries.length === 0) return [];

  const wellCalibrated = dimEntries
    .filter(([, a]) => a.directionAccuracy >= WELL_CALIBRATED_DIR && a.magnitudeCalibration >= WELL_CALIBRATED_MAG)
    .map(([n]) => n);

  const magnitudeOff = dimEntries
    .filter(([, a]) => a.directionAccuracy >= WELL_CALIBRATED_DIR && a.magnitudeCalibration < MAGNITUDE_OFF_MAG)
    .map(([n]) => n);

  const directionWeak = dimEntries
    .filter(([, a]) => a.directionAccuracy < WEAK_DIRECTION)
    .map(([n]) => n);

  const collectingData = Object.entries(matrix.perDimensionAccuracy)
    .filter((e): e is [string, DimensionAccuracy] =>
      e[1] !== undefined && e[1].sampleCount > 0 && e[1].sampleCount < MIN_SAMPLES)
    .map(([n, a]) => `${n} (n=${a.sampleCount})`);

  const lines: string[] = [];

  if (wellCalibrated.length > 0) {
    lines.push(`  Calibration: predictor is well-calibrated on ${formatList(wellCalibrated)}.`);
  }
  if (magnitudeOff.length > 0) {
    lines.push(`  Magnitude miscalibrated on: ${formatList(magnitudeOff)} — direction correct but size off.`);
  }
  if (directionWeak.length > 0) {
    lines.push(`  Directional misses on: ${formatList(directionWeak)}.`);
  }
  const needsTraining = [...directionWeak, ...magnitudeOff];
  if (needsTraining.length > 0) {
    lines.push(`  Recommendation: predictor needs more training data on ${formatList(needsTraining)}.`);
    lines.push(`  Run 'danteforge dojo train --dimension <name>' if Dojo is configured.`);
  }
  if (collectingData.length > 0) {
    lines.push(`  Still collecting data on: ${collectingData.join(', ')}.`);
  }

  return lines;
}

// ---------------------------------------------------------------------------

export interface CausalStatusOptions {
  cwd?: string;
  json?: boolean;
  /** Injection seam: override matrix load for testing */
  _loadMatrix?: (cwd?: string) => Promise<CausalWeightMatrix>;
}

function renderAccuracyBar(value: number, width = 20): string {
  const filled = Math.round(value * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function renderDimensionRow(
  name: string,
  acc: DimensionAccuracy,
): string {
  const pct = (v: number) => `${(v * 100).toFixed(0).padStart(3)}%`;
  const bar = renderAccuracyBar(acc.directionAccuracy);
  const samples = `n=${acc.sampleCount}`;
  return `  ${name.padEnd(26)} ${bar} dir:${pct(acc.directionAccuracy)} mag:${pct(acc.magnitudeCalibration)} conf:${pct(acc.confidenceCalibration)} ${samples}`;
}

export async function causalStatus(options: CausalStatusOptions = {}): Promise<void> {
  const loadFn = options._loadMatrix ?? loadCausalWeightMatrix;
  const matrix = await loadFn(options.cwd);

  if (options.json) {
    process.stdout.write(JSON.stringify(matrix, null, 2) + '\n');
    return;
  }

  const totalAttributions = matrix.totalAttributions;
  const coherence = matrix.globalCausalCoherence;

  logger.info('');
  logger.success('══════════════════════════════════════════════════════════');
  logger.success('  DanteForge Causal Coherence Status');
  logger.success('══════════════════════════════════════════════════════════');
  logger.info('');

  if (totalAttributions === 0) {
    logger.warn('  No attribution data yet. Run autoforge to accumulate prediction evidence.');
    logger.info('');
    logger.info('  How it works:');
    logger.info('    1. Before each forge wave, the predictor estimates expected score delta');
    logger.info('    2. After the wave, the actual delta is measured');
    logger.info('    3. Prediction-outcome pairs are classified: causally-aligned / correlation-driven / noise');
    logger.info('    4. This matrix accumulates over time, improving forward model accuracy');
    logger.info('');
    return;
  }

  logger.info(`  Total attributions:    ${totalAttributions}`);
  logger.info(`  Global causal coherence: ${renderAccuracyBar(coherence)} ${(coherence * 100).toFixed(1)}%`);
  logger.info('');

  const dimEntries = Object.entries(matrix.perDimensionAccuracy)
    .filter((e): e is [string, DimensionAccuracy] => e[1] !== undefined)
    .sort((a, b) => (b[1]?.directionAccuracy ?? 0) - (a[1]?.directionAccuracy ?? 0));

  if (dimEntries.length > 0) {
    logger.info('  Per-dimension accuracy (sorted by direction accuracy):');
    logger.info('');
    for (const [name, acc] of dimEntries) {
      logger.info(renderDimensionRow(name, acc));
    }
    logger.info('');
  }

  const actionEntries = Object.entries(matrix.perActionTypeAccuracy)
    .filter((e): e is [string, DimensionAccuracy] => e[1] !== undefined && (e[1]?.sampleCount ?? 0) >= 2)
    .sort((a, b) => (b[1]?.sampleCount ?? 0) - (a[1]?.sampleCount ?? 0))
    .slice(0, 10);

  if (actionEntries.length > 0) {
    logger.info('  Top action types (≥2 samples, sorted by sample count):');
    logger.info('');
    for (const [name, acc] of actionEntries) {
      logger.info(renderDimensionRow(name, acc));
    }
    logger.info('');
  }

  logger.info(`  Last updated: ${matrix.lastUpdated}`);
  logger.info('');

  const narrative = computeCalibrationNarrative(matrix);
  if (narrative.length > 0) {
    for (const line of narrative) logger.info(line);
    logger.info('');
  }

  if (coherence < 0.5) {
    logger.warn('  Low coherence — the forward model is not yet reliably predicting outcomes.');
    logger.warn('  Run more autoforge cycles to accumulate calibration data.');
  } else if (coherence < 0.7) {
    logger.info('  Moderate coherence — predictions are directionally correct ~half the time.');
  } else {
    logger.success(`  Good coherence — forward model is directionally accurate ${(coherence * 100).toFixed(0)}% of the time.`);
  }
  logger.info('');
}
