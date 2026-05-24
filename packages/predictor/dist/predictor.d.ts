/**
 * @danteforge/predictor — LLM-as-predictor implementation
 *
 * Takes a PredictionRequest and returns expected outcome predictions.
 * The LLM caller is injected — no direct dependency on danteforge LLM infra.
 *
 * Fail-closed: errors return a low-confidence prediction rather than throwing,
 * so predictor failures never block the convergence loop.
 */
import type { PredictionRequest, PredictionResult, PredictorConfig } from './types.js';
export type LlmCaller = (prompt: string) => Promise<string>;
/**
 * Generate an outcome prediction for a proposed action.
 *
 * Never throws — returns a low-confidence fallback on any failure so the
 * convergence loop is never blocked by predictor errors.
 */
export declare function predict(request: PredictionRequest, llmCaller: LlmCaller, config?: PredictorConfig): Promise<PredictionResult>;
//# sourceMappingURL=predictor.d.ts.map