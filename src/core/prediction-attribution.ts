/**
 * prediction-attribution.ts
 *
 * Classifies prediction-outcome pairs from convergence runs as:
 *   - causally-aligned: direction + magnitude within 50% + above noise band
 *   - correlation-driven: direction match but magnitude off, or within noise
 *   - noise: direction mismatch or no statistical signal
 *
 * Distinct from time-machine-causal-attribution.ts (which classifies decision
 * nodes in counterfactual timelines). This module operates on prediction-outcome
 * pairs from the convergence loop.
 *
 * Fail-closed: errors return 'noise' classification rather than spurious alignment.
 */

import type { DimensionName, AttributionOutcome } from './causal-weight-matrix.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributionClassification =
  | 'causally-aligned'
  | 'correlation-driven'
  | 'noise';

export interface PredictionOutcomePair {
  actionType: string;
  dimension: DimensionName;
  predictedDelta: number;
  measuredDelta: number;
  predictedConfidence: number;
}

export interface AttributionResult {
  classification: AttributionClassification;
  confidence: number;
  directionMatch: boolean;
  withinMagnitudeBand: boolean;
  aboveNoiseBand: boolean;
  contributingFactors: string[];
  outcome: AttributionOutcome;
}

export interface AttributionBatchResult {
  pairs: AttributionResult[];
  summary: {
    causallyAligned: number;
    correlationDriven: number;
    noise: number;
    totalPairs: number;
    overallAlignment: number;
  };
  /** SHA-256 hash of the evidence-chain receipt anchoring this attribution batch (best-effort, omitted if evidence-chain unavailable) */
  receiptHash?: string;
}

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

/**
 * Minimum absolute delta considered meaningful signal (not noise).
 * Deltas smaller than this in both predicted and measured are treated as noise.
 */
const NOISE_BAND_THRESHOLD = 0.05;

/**
 * Fraction tolerance for magnitude band classification.
 * Prediction within ±50% of measured = within band.
 */
const MAGNITUDE_BAND_FRACTION = 0.5;

function isAboveNoiseBand(predictedDelta: number, measuredDelta: number): boolean {
  return (
    Math.abs(predictedDelta) > NOISE_BAND_THRESHOLD ||
    Math.abs(measuredDelta) > NOISE_BAND_THRESHOLD
  );
}

function isDirectionMatch(predictedDelta: number, measuredDelta: number): boolean {
  if (!isAboveNoiseBand(predictedDelta, measuredDelta)) return false;
  return Math.sign(predictedDelta) === Math.sign(measuredDelta);
}

function isWithinMagnitudeBand(predictedDelta: number, measuredDelta: number): boolean {
  if (measuredDelta === 0) {
    return Math.abs(predictedDelta) <= NOISE_BAND_THRESHOLD;
  }
  const relativeError = Math.abs((predictedDelta - measuredDelta) / measuredDelta);
  return relativeError <= MAGNITUDE_BAND_FRACTION;
}

// ---------------------------------------------------------------------------
// Core attribution
// ---------------------------------------------------------------------------

/**
 * Classify a single prediction-outcome pair.
 */
export function attributePair(pair: PredictionOutcomePair): AttributionResult {
  const directionMatch = isDirectionMatch(pair.predictedDelta, pair.measuredDelta);
  const withinMagnitudeBand = isWithinMagnitudeBand(pair.predictedDelta, pair.measuredDelta);
  const aboveNoiseBand = isAboveNoiseBand(pair.predictedDelta, pair.measuredDelta);

  const contributingFactors: string[] = [];

  if (!aboveNoiseBand) {
    contributingFactors.push(`both deltas below noise threshold (${NOISE_BAND_THRESHOLD})`);
  }
  if (directionMatch) {
    contributingFactors.push(`direction matched (predicted ${pair.predictedDelta > 0 ? '+' : ''}${pair.predictedDelta.toFixed(3)}, measured ${pair.measuredDelta > 0 ? '+' : ''}${pair.measuredDelta.toFixed(3)})`);
  } else if (aboveNoiseBand) {
    contributingFactors.push(`direction mismatch (predicted ${pair.predictedDelta > 0 ? '+' : ''}${pair.predictedDelta.toFixed(3)}, measured ${pair.measuredDelta > 0 ? '+' : ''}${pair.measuredDelta.toFixed(3)})`);
  }
  if (withinMagnitudeBand && directionMatch) {
    contributingFactors.push(`magnitude within ±${(MAGNITUDE_BAND_FRACTION * 100).toFixed(0)}% band`);
  } else if (directionMatch) {
    contributingFactors.push(`magnitude outside ±${(MAGNITUDE_BAND_FRACTION * 100).toFixed(0)}% band`);
  }

  let classification: AttributionClassification;
  let confidence: number;

  if (!aboveNoiseBand) {
    classification = 'noise';
    confidence = 0.9;
  } else if (!directionMatch) {
    classification = 'noise';
    confidence = 0.85;
  } else if (directionMatch && withinMagnitudeBand) {
    classification = 'causally-aligned';
    confidence = pair.predictedConfidence * 0.9 + 0.1;
  } else {
    classification = 'correlation-driven';
    confidence = 0.65;
  }

  const attributionOutcome: AttributionOutcome = {
    dimension: pair.dimension,
    actionType: pair.actionType,
    predictedDelta: pair.predictedDelta,
    measuredDelta: pair.measuredDelta,
    predictedConfidence: pair.predictedConfidence,
    classification,
  };

  return {
    classification,
    confidence,
    directionMatch,
    withinMagnitudeBand,
    aboveNoiseBand,
    contributingFactors,
    outcome: attributionOutcome,
  };
}

/**
 * Classify a batch of prediction-outcome pairs and produce a summary.
 */
export function attributeBatch(pairs: PredictionOutcomePair[]): AttributionBatchResult {
  const results = pairs.map(attributePair);

  const causallyAligned = results.filter(r => r.classification === 'causally-aligned').length;
  const correlationDriven = results.filter(r => r.classification === 'correlation-driven').length;
  const noise = results.filter(r => r.classification === 'noise').length;

  return {
    pairs: results,
    summary: {
      causallyAligned,
      correlationDriven,
      noise,
      totalPairs: results.length,
      overallAlignment: results.length > 0 ? causallyAligned / results.length : 0,
    },
  };
}

/**
 * Extract attribution outcomes suitable for updating the causal weight matrix.
 */
export function extractOutcomes(batchResult: AttributionBatchResult): AttributionOutcome[] {
  return batchResult.pairs.map(r => r.outcome);
}
