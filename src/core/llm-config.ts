// LLM configuration constants — centralized to eliminate magic numbers
export const MAX_LLM_RETRIES = 2;
export const LLM_RETRY_DELAYS_MS = [1000, 3000] as const;
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;
export const DEFAULT_OLLAMA_TIMEOUT_MS = 180_000;
export const AUDIT_STATE_CACHE_TTL_MS = 5000;
