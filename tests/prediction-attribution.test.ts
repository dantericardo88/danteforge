import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributePair,
  attributeBatch,
  extractOutcomes,
  type PredictionOutcomePair,
} from '../src/core/prediction-attribution.js';

function pair(overrides: Partial<PredictionOutcomePair> = {}): PredictionOutcomePair {
  return {
    actionType: 'forge',
    dimension: 'functionality',
    predictedDelta: 0.2,
    measuredDelta: 0.2,
    predictedConfidence: 0.8,
    ...overrides,
  };
}

describe('attributePair — classification', () => {
  it('causally-aligned when direction matches and magnitude within 50%', () => {
    const result = attributePair(pair({ predictedDelta: 0.2, measuredDelta: 0.2 }));
    assert.equal(result.classification, 'causally-aligned');
    assert.equal(result.directionMatch, true);
    assert.equal(result.withinMagnitudeBand, true);
    assert.equal(result.aboveNoiseBand, true);
  });

  it('causally-aligned when predicted is 49% below measured', () => {
    const result = attributePair(pair({ predictedDelta: 0.102, measuredDelta: 0.2 }));
    assert.equal(result.classification, 'causally-aligned');
  });

  it('correlation-driven when direction matches but magnitude is off by >50%', () => {
    const result = attributePair(pair({ predictedDelta: 0.05, measuredDelta: 0.5 }));
    assert.equal(result.classification, 'correlation-driven');
    assert.equal(result.directionMatch, true);
    assert.equal(result.withinMagnitudeBand, false);
  });

  it('noise when direction mismatches (predicted positive, measured negative)', () => {
    const result = attributePair(pair({ predictedDelta: 0.3, measuredDelta: -0.3 }));
    assert.equal(result.classification, 'noise');
    assert.equal(result.directionMatch, false);
  });

  it('noise when both deltas are below noise threshold (0.05)', () => {
    const result = attributePair(pair({ predictedDelta: 0.01, measuredDelta: 0.02 }));
    assert.equal(result.classification, 'noise');
    assert.equal(result.aboveNoiseBand, false);
  });

  it('noise when only predicted delta is below noise threshold and measured is also below', () => {
    const result = attributePair(pair({ predictedDelta: 0.04, measuredDelta: 0.04 }));
    assert.equal(result.classification, 'noise');
  });

  it('aboveNoiseBand when only one delta exceeds threshold', () => {
    const result = attributePair(pair({ predictedDelta: 0.01, measuredDelta: 0.3 }));
    assert.equal(result.aboveNoiseBand, true);
  });

  it('causally-aligned when both deltas are negative (direction match both negative)', () => {
    const result = attributePair(pair({ predictedDelta: -0.2, measuredDelta: -0.15 }));
    assert.equal(result.classification, 'causally-aligned');
    assert.equal(result.directionMatch, true);
  });

  it('confidence is scaled by predictedConfidence for causally-aligned', () => {
    const result = attributePair(pair({ predictedDelta: 0.2, measuredDelta: 0.2, predictedConfidence: 0.9 }));
    assert.equal(result.classification, 'causally-aligned');
    assert.ok(result.confidence > 0.8, `expected confidence > 0.8, got ${result.confidence}`);
  });

  it('confidence is fixed at 0.65 for correlation-driven', () => {
    const result = attributePair(pair({ predictedDelta: 0.05, measuredDelta: 0.5 }));
    assert.equal(result.classification, 'correlation-driven');
    assert.equal(result.confidence, 0.65);
  });

  it('contributingFactors includes direction mismatch message when applicable', () => {
    const result = attributePair(pair({ predictedDelta: 0.3, measuredDelta: -0.3 }));
    assert.ok(result.contributingFactors.some(f => f.includes('direction mismatch')));
  });

  it('contributingFactors includes noise threshold message when both below band', () => {
    const result = attributePair(pair({ predictedDelta: 0.01, measuredDelta: 0.02 }));
    assert.ok(result.contributingFactors.some(f => f.includes('noise threshold')));
  });

  it('outcome object includes all pair fields plus classification', () => {
    const p = pair({ actionType: 'verify', dimension: 'testing', predictedConfidence: 0.7 });
    const result = attributePair(p);
    assert.equal(result.outcome.actionType, 'verify');
    assert.equal(result.outcome.dimension, 'testing');
    assert.equal(result.outcome.predictedConfidence, 0.7);
    assert.ok(['causally-aligned', 'correlation-driven', 'noise'].includes(result.outcome.classification));
  });

  it('measuredDelta of 0 with tiny predicted is within magnitude band', () => {
    const result = attributePair(pair({ predictedDelta: 0.04, measuredDelta: 0 }));
    assert.equal(result.withinMagnitudeBand, true);
  });
});

describe('attributeBatch', () => {
  it('counts classifications correctly across mixed batch', () => {
    const pairs: PredictionOutcomePair[] = [
      pair({ predictedDelta: 0.2, measuredDelta: 0.2 }),   // causally-aligned
      pair({ predictedDelta: 0.05, measuredDelta: 0.5 }),  // correlation-driven
      pair({ predictedDelta: 0.3, measuredDelta: -0.3 }),  // noise
      pair({ predictedDelta: 0.01, measuredDelta: 0.02 }), // noise
    ];
    const result = attributeBatch(pairs);
    assert.equal(result.summary.causallyAligned, 1);
    assert.equal(result.summary.correlationDriven, 1);
    assert.equal(result.summary.noise, 2);
    assert.equal(result.summary.totalPairs, 4);
  });

  it('overallAlignment is causallyAligned / totalPairs', () => {
    const pairs: PredictionOutcomePair[] = [
      pair({ predictedDelta: 0.2, measuredDelta: 0.2 }),
      pair({ predictedDelta: 0.2, measuredDelta: 0.2 }),
      pair({ predictedDelta: 0.3, measuredDelta: -0.3 }),
    ];
    const result = attributeBatch(pairs);
    assert.ok(Math.abs(result.summary.overallAlignment - 2 / 3) < 0.001);
  });

  it('overallAlignment is 0 for empty batch', () => {
    const result = attributeBatch([]);
    assert.equal(result.summary.overallAlignment, 0);
    assert.equal(result.summary.totalPairs, 0);
  });
});

describe('extractOutcomes', () => {
  it('returns one AttributionOutcome per pair with correct fields', () => {
    const pairs: PredictionOutcomePair[] = [
      pair({ actionType: 'forge', dimension: 'testing' }),
      pair({ actionType: 'verify', dimension: 'security' }),
    ];
    const batch = attributeBatch(pairs);
    const outcomes = extractOutcomes(batch);
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0]?.actionType, 'forge');
    assert.equal(outcomes[0]?.dimension, 'testing');
    assert.equal(outcomes[1]?.actionType, 'verify');
    assert.equal(outcomes[1]?.dimension, 'security');
  });
});
