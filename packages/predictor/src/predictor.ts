/**
 * @danteforge/predictor — LLM-as-predictor implementation
 *
 * Takes a PredictionRequest and returns expected outcome predictions.
 * The LLM caller is injected — no direct dependency on danteforge LLM infra.
 *
 * Fail-closed: errors return a low-confidence prediction rather than throwing,
 * so predictor failures never block the convergence loop.
 */

import type {
  PredictionRequest,
  PredictionResult,
  PredictorConfig,
  DimensionName,
} from './types.js';
import { DEFAULT_PREDICTOR_CONFIG } from './types.js';

export type LlmCaller = (prompt: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPredictionPrompt(request: PredictionRequest): string {
  const { proposedAction, currentState, recentHistory, causalWeights } = request;

  const currentScores = Object.entries(currentState.dimensionScores)
    .map(([dim, score]) => `  ${dim}: ${score?.toFixed(1) ?? 'unknown'}/10`)
    .join('\n');

  const historyLines = recentHistory.slice(-10).map(h => {
    const predicted = Object.entries(h.predictedDelta)
      .map(([d, v]) => `${d}:${v && v > 0 ? '+' : ''}${v?.toFixed(2)}`)
      .join(', ');
    const measured = Object.entries(h.measuredDelta)
      .map(([d, v]) => `${d}:${v && v > 0 ? '+' : ''}${v?.toFixed(2)}`)
      .join(', ');
    return `  Action: ${h.action} | Predicted: [${predicted}] | Measured: [${measured}] | Aligned: ${h.aligned}`;
  }).join('\n') || '  (no prior history)';

  const weightLines = causalWeights
    ? Object.entries(causalWeights)
        .filter(([, w]) => w !== undefined)
        .map(([dim, w]) => `  ${dim}: ${((w ?? 0) * 100).toFixed(0)}% accuracy`)
        .join('\n')
    : '  (no weight data yet)';

  return `You are a DanteForge convergence predictor. Given the current project state and a proposed improvement action, predict the expected outcome.

## Current Project State
Workflow stage: ${currentState.workflowStage}
Cycle count: ${currentState.cycleCount}
Total cost so far: $${currentState.totalCostUsd.toFixed(3)}

Current dimension scores (0-10):
${currentScores}

## Proposed Action
Command: ${proposedAction.command}
Reason: ${proposedAction.reason}
Target dimensions: ${proposedAction.targetDimensions?.join(', ') ?? 'general'}
Complexity estimate: ${proposedAction.estimatedComplexity ?? 'unknown'}

## Recent Prediction History (learn from calibration)
${historyLines}

## Causal Weight Accuracy (how reliable predictions have been per dimension)
${weightLines}

## Your Task
Predict the expected score impact of running "${proposedAction.command}".

Respond ONLY with valid JSON in this exact format:
{
  "scoreImpact": {
    "functionality": 0.0,
    "testing": 0.0,
    "errorHandling": 0.0,
    "security": 0.0,
    "documentation": 0.0,
    "maintainability": 0.0
  },
  "costUsd": 0.05,
  "latencyMs": 30000,
  "confidence": 0.7,
  "rationale": "Brief explanation of why you expect these impacts",
  "coveredDimensions": ["functionality", "testing"]
}

Rules:
- scoreImpact values are deltas (positive = improvement, negative = regression), range -2.0 to +2.0
- confidence is 0.0 to 1.0 (be honest — low confidence if uncertain)
- Include only dimensions you have a meaningful prediction for in scoreImpact
- coveredDimensions lists which dimensions you're actively predicting
- Do not include dimensions you have no basis to predict`;
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

interface RawPrediction {
  scoreImpact?: Record<string, number>;
  costUsd?: number;
  latencyMs?: number;
  confidence?: number;
  rationale?: string;
  coveredDimensions?: string[];
}

function parsePredictionResponse(
  raw: string,
  action: string,
  config: PredictorConfig,
): PredictionResult {
  const fallback = makeFallback(action, config.version, 'parse-failed');

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]) as RawPrediction;

    const scoreImpact: Partial<Record<DimensionName, number>> = {};
    for (const [dim, val] of Object.entries(parsed.scoreImpact ?? {})) {
      if (typeof val === 'number' && isFinite(val)) {
        scoreImpact[dim as DimensionName] = Math.max(-2, Math.min(2, val));
      }
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.3;

    const coveredDimensions = Array.isArray(parsed.coveredDimensions)
      ? parsed.coveredDimensions.filter((d): d is DimensionName => typeof d === 'string')
      : (Object.keys(scoreImpact) as DimensionName[]);

    return {
      predicted: {
        scoreImpact,
        costUsd: typeof parsed.costUsd === 'number' ? Math.max(0, parsed.costUsd) : 0.05,
        latencyMs: typeof parsed.latencyMs === 'number' ? Math.max(0, parsed.latencyMs) : 30000,
        confidence,
      },
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'No rationale provided',
      predictorVersion: config.version,
      predictedAt: new Date().toISOString(),
      coveredDimensions,
    };
  } catch {
    return fallback;
  }
}

function makeFallback(action: string, version: string, reason: string): PredictionResult {
  return {
    predicted: {
      scoreImpact: {},
      costUsd: 0.05,
      latencyMs: 30000,
      confidence: 0.1,
    },
    rationale: `Fallback prediction (${reason}) for action: ${action}`,
    predictorVersion: version,
    predictedAt: new Date().toISOString(),
    coveredDimensions: [],
  };
}

// ---------------------------------------------------------------------------
// Main predict function
// ---------------------------------------------------------------------------

/**
 * Generate an outcome prediction for a proposed action.
 *
 * Never throws — returns a low-confidence fallback on any failure so the
 * convergence loop is never blocked by predictor errors.
 */
export async function predict(
  request: PredictionRequest,
  llmCaller: LlmCaller,
  config: PredictorConfig = DEFAULT_PREDICTOR_CONFIG,
): Promise<PredictionResult> {
  if (config.disabled) {
    return makeFallback(request.proposedAction.command, config.version, 'predictor-disabled');
  }

  try {
    const prompt = buildPredictionPrompt(request);
    const estimatedCost = prompt.length * 0.000004;
    if (estimatedCost > config.maxBudgetUsd) {
      return makeFallback(request.proposedAction.command, config.version, 'budget-exceeded');
    }

    const startMs = Date.now();
    const raw = await llmCaller(prompt);
    const latencyMs = Date.now() - startMs;

    const result = parsePredictionResponse(raw, request.proposedAction.command, config);
    result.predicted.latencyMs = latencyMs;
    return result;
  } catch {
    return makeFallback(request.proposedAction.command, config.version, 'llm-error');
  }
}
