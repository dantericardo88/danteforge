// causal-status — Show per-dimension prediction accuracy from the causal weight matrix
// Displays how well the convergence loop's forward model predicted actual outcomes.
// Data source: .danteforge/causal-weight-matrix.json (updated after each forge wave).

import { logger } from '../../core/logger.js';
import {
  loadCausalWeightMatrix,
  type CausalWeightMatrix,
  type DimensionAccuracy,
} from '../../core/causal-weight-matrix.js';

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
