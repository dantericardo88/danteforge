/**
 * causal-weight-matrix.ts
 *
 * Persistence layer for the CausalWeightMatrix — accumulates evidence about
 * which predictions were causally accurate vs. correlation-driven vs. noise.
 *
 * Stored at .danteforge/causal-weight-matrix.json
 * Updated after each prediction-attribution cycle.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DimensionName =
  | 'functionality' | 'testing' | 'errorHandling' | 'security'
  | 'uxPolish' | 'documentation' | 'performance' | 'maintainability'
  | 'developerExperience' | 'autonomy' | 'planningQuality' | 'selfImprovement'
  | 'specDrivenPipeline' | 'convergenceSelfHealing' | 'tokenEconomy'
  | 'contextEconomy' | 'ecosystemMcp' | 'enterpriseReadiness' | 'communityAdoption'
  | 'causalCoherence';

export type ActionType = string;

export interface DimensionAccuracy {
  sampleCount: number;
  /** 0-1: fraction of predictions where predicted and measured direction matched */
  directionAccuracy: number;
  /** 0-1: fraction of predictions within 50% magnitude band */
  magnitudeCalibration: number;
  /** 0-1: fraction of confidence scores that matched empirical accuracy */
  confidenceCalibration: number;
  /** Running mean of (predictedDelta - measuredDelta). Positive = overestimates; negative = underestimates. */
  avgSignedError: number;
  lastUpdated: string;
}

export interface CausalWeightMatrix {
  schemaVersion: '1.0.0';
  perDimensionAccuracy: Partial<Record<DimensionName, DimensionAccuracy>>;
  perActionTypeAccuracy: Record<ActionType, DimensionAccuracy>;
  /** Weighted average across all dimensions with sufficient samples */
  globalCausalCoherence: number;
  totalAttributions: number;
  lastUpdated: string;
  evidenceRef?: string;
  /** Rolling window of the last RECENT_ATTRIBUTIONS_LIMIT individual outcomes — used as predictor context */
  recentAttributions?: AttributionOutcome[];
}

export interface AttributionOutcome {
  dimension: DimensionName;
  actionType: ActionType;
  predictedDelta: number;
  measuredDelta: number;
  predictedConfidence: number;
  classification: 'causally-aligned' | 'correlation-driven' | 'noise';
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const MATRIX_FILENAME = 'causal-weight-matrix.json';
const RECENT_ATTRIBUTIONS_LIMIT = 20;

function getMatrixPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', MATRIX_FILENAME);
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

export function initCausalWeightMatrix(): CausalWeightMatrix {
  return {
    schemaVersion: '1.0.0',
    perDimensionAccuracy: {},
    perActionTypeAccuracy: {},
    globalCausalCoherence: 0,
    totalAttributions: 0,
    lastUpdated: new Date().toISOString(),
  };
}

export async function loadCausalWeightMatrix(cwd?: string): Promise<CausalWeightMatrix> {
  try {
    const raw = await fs.readFile(getMatrixPath(cwd), 'utf8');
    return JSON.parse(raw) as CausalWeightMatrix;
  } catch {
    return initCausalWeightMatrix();
  }
}

export async function saveCausalWeightMatrix(
  matrix: CausalWeightMatrix,
  cwd?: string,
): Promise<void> {
  const matrixPath = getMatrixPath(cwd);
  await fs.mkdir(path.dirname(matrixPath), { recursive: true });
  await fs.writeFile(matrixPath, JSON.stringify({ ...matrix, lastUpdated: new Date().toISOString() }, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Update logic
// ---------------------------------------------------------------------------

function updateDimensionAccuracy(
  existing: DimensionAccuracy | undefined,
  outcome: AttributionOutcome,
): DimensionAccuracy {
  const prev = existing ?? {
    sampleCount: 0,
    directionAccuracy: 0,
    magnitudeCalibration: 0,
    confidenceCalibration: 0,
    avgSignedError: 0,
    lastUpdated: new Date().toISOString(),
  };

  const n = prev.sampleCount;
  const newN = n + 1;

  const directionMatch = Math.sign(outcome.predictedDelta) === Math.sign(outcome.measuredDelta) ? 1 : 0;
  const withinMagnitudeBand = outcome.measuredDelta !== 0
    ? Math.abs((outcome.predictedDelta - outcome.measuredDelta) / outcome.measuredDelta) <= 0.5
    : Math.abs(outcome.predictedDelta) < 0.1;
  const magnitudeMatch = withinMagnitudeBand ? 1 : 0;

  const empiricalAccuracy = outcome.classification === 'causally-aligned' ? 1 : 0;
  const confidenceMatch = Math.abs(outcome.predictedConfidence - empiricalAccuracy) <= 0.3 ? 1 : 0;

  const signedError = outcome.predictedDelta - outcome.measuredDelta;
  return {
    sampleCount: newN,
    directionAccuracy: (prev.directionAccuracy * n + directionMatch) / newN,
    magnitudeCalibration: (prev.magnitudeCalibration * n + magnitudeMatch) / newN,
    confidenceCalibration: (prev.confidenceCalibration * n + confidenceMatch) / newN,
    avgSignedError: ((prev.avgSignedError ?? 0) * n + signedError) / newN,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Compute overall causal coherence from all dimensions with ≥5 samples.
 * Weighted by sample count so well-evidenced dimensions matter more.
 */
export function computeGlobalCausalCoherence(
  matrix: CausalWeightMatrix,
): number {
  const entries = Object.values(matrix.perDimensionAccuracy).filter(
    (d): d is DimensionAccuracy => d !== undefined && d.sampleCount >= 5,
  );
  if (entries.length === 0) return 0;

  const totalSamples = entries.reduce((s, d) => s + d.sampleCount, 0);
  const weightedSum = entries.reduce(
    (s, d) => s + d.directionAccuracy * d.sampleCount,
    0,
  );
  return weightedSum / totalSamples;
}

/**
 * Apply a batch of attribution outcomes to the matrix and recompute coherence.
 * Returns the updated matrix without mutating the input.
 */
export function applyAttributionOutcomes(
  matrix: CausalWeightMatrix,
  outcomes: AttributionOutcome[],
): CausalWeightMatrix {
  const updated = { ...matrix };
  updated.perDimensionAccuracy = { ...matrix.perDimensionAccuracy };
  updated.perActionTypeAccuracy = { ...matrix.perActionTypeAccuracy };

  for (const outcome of outcomes) {
    updated.perDimensionAccuracy[outcome.dimension] = updateDimensionAccuracy(
      updated.perDimensionAccuracy[outcome.dimension],
      outcome,
    );
    updated.perActionTypeAccuracy[outcome.actionType] = updateDimensionAccuracy(
      updated.perActionTypeAccuracy[outcome.actionType],
      outcome,
    );
  }

  updated.totalAttributions += outcomes.length;
  updated.globalCausalCoherence = computeGlobalCausalCoherence(updated);
  updated.lastUpdated = new Date().toISOString();

  const existing = matrix.recentAttributions ?? [];
  const appended = [...existing, ...outcomes];
  updated.recentAttributions = appended.slice(-RECENT_ATTRIBUTIONS_LIMIT);

  return updated;
}
