/**
 * @danteforge/predictor — public types
 *
 * Provider-agnostic. LLM caller is injected by the consumer (DanteForge CLI layer)
 * so this package has zero runtime dependencies.
 */

export type DimensionName =
  | 'functionality' | 'testing' | 'errorHandling' | 'security'
  | 'uxPolish' | 'documentation' | 'performance' | 'maintainability'
  | 'developerExperience' | 'autonomy' | 'planningQuality' | 'selfImprovement'
  | 'specDrivenPipeline' | 'convergenceSelfHealing' | 'tokenEconomy'
  | 'contextEconomy' | 'ecosystemMcp' | 'enterpriseReadiness' | 'communityAdoption'
  | 'causalCoherence';

export interface ProjectState {
  workflowStage: string;
  dimensionScores: Partial<Record<DimensionName, number>>;
  totalCostUsd: number;
  cycleCount: number;
}

export interface ImprovementAction {
  command: string;
  reason: string;
  targetDimensions?: DimensionName[];
  estimatedComplexity?: 'low' | 'medium' | 'high';
}

export interface PriorPredictionRecord {
  action: string;
  predictedDelta: Partial<Record<DimensionName, number>>;
  measuredDelta: Partial<Record<DimensionName, number>>;
  aligned: boolean;
}

export interface PredictionRequest {
  proposedAction: ImprovementAction;
  currentState: ProjectState;
  /** Last N prediction-outcome pairs for the same dimension (context window) */
  recentHistory: PriorPredictionRecord[];
  /** Current causal weight accuracy per dimension (0-1) */
  causalWeights?: Partial<Record<DimensionName, number>>;
  budgetEnvelope: { maxUsd: number; maxLatencyMs: number };
}

export interface PredictionResult {
  predicted: {
    /** Expected score delta per dimension (positive = improvement) */
    scoreImpact: Partial<Record<DimensionName, number>>;
    costUsd: number;
    latencyMs: number;
    /** 0-1 confidence in this prediction */
    confidence: number;
  };
  rationale: string;
  predictorVersion: string;
  /** ISO timestamp */
  predictedAt: string;
  /** Which dimensions this prediction covers */
  coveredDimensions: DimensionName[];
  /** SHA-256 hash of the evidence-chain receipt anchoring this prediction (best-effort, omitted if evidence-chain unavailable) */
  receiptHash?: string;
}

export interface PredictorConfig {
  /** Budget cap for predictor LLM calls per convergence run */
  maxBudgetUsd: number;
  /** Maximum number of prior records to include in context */
  contextWindowSize: number;
  /** Version string embedded in results */
  version: string;
  /** Disable predictor (returns low-confidence no-op) */
  disabled?: boolean;
}

export const DEFAULT_PREDICTOR_CONFIG: PredictorConfig = {
  maxBudgetUsd: 0.50,
  contextWindowSize: 10,
  version: 'llm-predictor-v1',
};
