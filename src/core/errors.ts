// Structured error hierarchy for DanteForge
import type { LLMProvider } from './config.js';

export type DanteErrorCode =
  | 'LLM_AUTH_FAILED'
  | 'LLM_TIMEOUT'
  | 'LLM_UNAVAILABLE'
  | 'LLM_EMPTY_RESPONSE'
  | 'LLM_INVALID_JSON'
  | 'LLM_UNKNOWN_PROVIDER'
  | 'LLM_RATE_LIMITED'
  | 'LLM_CIRCUIT_OPEN'
  | 'BUDGET_EXCEEDED'
  | 'MODEL_NOT_AVAILABLE'
  | 'CONFIG_MISSING_KEY';

export class DanteError extends Error {
  constructor(
    message: string,
    public readonly code: DanteErrorCode,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'DanteError';
  }
}

export class LLMError extends DanteError {
  constructor(
    message: string,
    code: DanteErrorCode,
    public readonly provider: LLMProvider,
    public readonly status?: number,
    retryable = false,
  ) {
    super(message, code, retryable);
    this.name = 'LLMError';
  }
}

export class BudgetError extends DanteError {
  constructor(
    message: string,
    public readonly agentRole: string,
    public readonly currentSpendUsd: number,
    public readonly maxBudgetUsd: number,
  ) {
    super(message, 'BUDGET_EXCEEDED', false);
    this.name = 'BudgetError';
  }
}

/** Check whether an error is retryable — supports DanteError.retryable and string pattern matching */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof DanteError) return err.retryable;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('econnreset')
    || msg.includes('econnrefused')
    || msg.includes('etimedout')
    || msg.includes('socket hang up')
    || msg.includes('fetch failed')
    || msg.includes('rate limit')
    || msg.includes('429')
    || msg.includes('503')
    || msg.includes('502');
}
