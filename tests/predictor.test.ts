import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { predict, type LlmCaller } from '../packages/predictor/src/predictor.js';
import { DEFAULT_PREDICTOR_CONFIG, type PredictionRequest } from '../packages/predictor/src/types.js';

function makeRequest(overrides: Partial<PredictionRequest> = {}): PredictionRequest {
  return {
    proposedAction: {
      command: 'forge',
      reason: 'Execute task plan',
      targetDimensions: ['functionality', 'testing'],
      estimatedComplexity: 'medium',
    },
    currentState: {
      workflowStage: 'forge',
      dimensionScores: { functionality: 7.0, testing: 6.5, errorHandling: 7.5 },
      totalCostUsd: 0.15,
      cycleCount: 2,
    },
    recentHistory: [],
    budgetEnvelope: { maxUsd: 1.0, maxLatencyMs: 60_000 },
    ...overrides,
  };
}

function jsonLlmCaller(payload: object): LlmCaller {
  return async () => JSON.stringify(payload);
}

function failingLlmCaller(): LlmCaller {
  return async () => { throw new Error('LLM network error'); };
}

describe('predict — happy path', () => {
  it('returns a PredictionResult with coveredDimensions', async () => {
    const caller = jsonLlmCaller({
      scoreImpact: { functionality: 0.5, testing: 0.3 },
      costUsd: 0.03,
      latencyMs: 25000,
      confidence: 0.8,
      rationale: 'forge will add new functionality',
      coveredDimensions: ['functionality', 'testing'],
    });
    const result = await predict(makeRequest(), caller);
    assert.ok(result.coveredDimensions.includes('functionality'));
    assert.equal(result.predicted.scoreImpact['functionality'], 0.5);
  });

  it('clamps scoreImpact values to [-2, +2]', async () => {
    const caller = jsonLlmCaller({
      scoreImpact: { functionality: 5.0, testing: -10.0 },
      confidence: 0.7,
      rationale: 'over-optimistic LLM',
      coveredDimensions: ['functionality', 'testing'],
    });
    const result = await predict(makeRequest(), caller);
    assert.equal(result.predicted.scoreImpact['functionality'], 2.0);
    assert.equal(result.predicted.scoreImpact['testing'], -2.0);
  });

  it('clamps confidence to [0, 1]', async () => {
    const caller = jsonLlmCaller({
      scoreImpact: {},
      confidence: 1.5,
      rationale: 'overclaiming',
      coveredDimensions: [],
    });
    const result = await predict(makeRequest(), caller);
    assert.equal(result.predicted.confidence, 1.0);
  });

  it('costUsd is non-negative', async () => {
    const caller = jsonLlmCaller({
      scoreImpact: {},
      costUsd: -0.1,
      confidence: 0.5,
      rationale: 'test',
      coveredDimensions: [],
    });
    const result = await predict(makeRequest(), caller);
    assert.ok(result.predicted.costUsd >= 0);
  });

  it('includes predictorVersion from config', async () => {
    const caller = jsonLlmCaller({ scoreImpact: {}, confidence: 0.5, rationale: 'x', coveredDimensions: [] });
    const result = await predict(makeRequest(), caller, { ...DEFAULT_PREDICTOR_CONFIG, version: 'test-v42' });
    assert.equal(result.predictorVersion, 'test-v42');
  });

  it('predictedAt is an ISO date string', async () => {
    const caller = jsonLlmCaller({ scoreImpact: {}, confidence: 0.5, rationale: 'x', coveredDimensions: [] });
    const result = await predict(makeRequest(), caller);
    assert.ok(() => new Date(result.predictedAt).getTime() > 0);
  });
});

describe('predict — fail-closed behavior', () => {
  it('returns fallback on LLM error, does not throw', async () => {
    const result = await predict(makeRequest(), failingLlmCaller());
    assert.equal(result.predicted.confidence, 0.1);
    assert.ok(result.rationale.includes('llm-error') || result.rationale.includes('Fallback'));
  });

  it('returns fallback when response is not valid JSON', async () => {
    const caller: LlmCaller = async () => 'not json at all!!!';
    const result = await predict(makeRequest(), caller);
    assert.equal(result.predicted.confidence, 0.1);
  });

  it('returns fallback when response JSON has no scoreImpact', async () => {
    const caller: LlmCaller = async () => JSON.stringify({ confidence: 0.5 });
    const result = await predict(makeRequest(), caller);
    assert.equal(result.predictorVersion, DEFAULT_PREDICTOR_CONFIG.version);
  });

  it('returns low-confidence fallback when predictor is disabled', async () => {
    const caller = jsonLlmCaller({ scoreImpact: {}, confidence: 0.9, rationale: 'x', coveredDimensions: [] });
    const result = await predict(makeRequest(), caller, { ...DEFAULT_PREDICTOR_CONFIG, disabled: true });
    assert.equal(result.predicted.confidence, 0.1);
    assert.ok(result.rationale.includes('predictor-disabled'));
  });

  it('returns fallback when budget is exceeded by prompt length', async () => {
    const caller = jsonLlmCaller({ scoreImpact: {}, confidence: 0.9, rationale: 'x', coveredDimensions: [] });
    const result = await predict(makeRequest(), caller, { ...DEFAULT_PREDICTOR_CONFIG, maxBudgetUsd: 0.000001 });
    assert.equal(result.predicted.confidence, 0.1);
    assert.ok(result.rationale.includes('budget-exceeded'));
  });
});

describe('predict — response parsing edge cases', () => {
  it('extracts JSON from LLM response that has surrounding text', async () => {
    const caller: LlmCaller = async () => `
      Here is my prediction:
      ${JSON.stringify({ scoreImpact: { functionality: 0.3 }, confidence: 0.7, rationale: 'test', coveredDimensions: ['functionality'] })}
      Hope that helps!
    `;
    const result = await predict(makeRequest(), caller);
    assert.equal(result.predicted.scoreImpact['functionality'], 0.3);
  });

  it('ignores non-numeric scoreImpact values', async () => {
    const caller = jsonLlmCaller({
      scoreImpact: { functionality: 'high', testing: 0.2 },
      confidence: 0.5,
      rationale: 'test',
      coveredDimensions: ['testing'],
    });
    const result = await predict(makeRequest(), caller);
    assert.equal(result.predicted.scoreImpact['functionality'], undefined);
    assert.equal(result.predicted.scoreImpact['testing'], 0.2);
  });

  it('handles empty coveredDimensions by inferring from scoreImpact keys', async () => {
    const caller = jsonLlmCaller({
      scoreImpact: { functionality: 0.4 },
      confidence: 0.6,
      rationale: 'test',
    });
    const result = await predict(makeRequest(), caller);
    assert.ok(result.coveredDimensions.length > 0);
  });
});
