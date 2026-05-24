/**
 * @danteforge/predictor — public types
 *
 * Provider-agnostic. LLM caller is injected by the consumer (DanteForge CLI layer)
 * so this package has zero runtime dependencies.
 */
export const DEFAULT_PREDICTOR_CONFIG = {
    maxBudgetUsd: 0.50,
    contextWindowSize: 10,
    version: 'llm-predictor-v1',
};
//# sourceMappingURL=types.js.map