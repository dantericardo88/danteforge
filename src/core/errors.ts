// Error hierarchy — structured errors with machine-readable codes and human-readable remedies.
// Mirrors the GateError pattern from gates.ts but covers the full CLI surface.

/** Machine-readable error codes used across the DanteForge error catalog */
export type DanteErrorCode =
  | 'LLM_UNAVAILABLE'
  | 'LLM_AUTH_FAILED'
  | 'LLM_RATE_LIMITED'
  | 'LLM_TIMEOUT'
  | 'LLM_EMPTY_RESPONSE'
  | 'LLM_CIRCUIT_OPEN'
  | 'LLM_UNKNOWN_PROVIDER'
  | 'LLM_ERROR'
  | 'MODEL_NOT_AVAILABLE'
  | 'CONFIG_MISSING_KEY'
  | 'CONFIG_ERROR'
  | 'BUDGET_EXCEEDED'
  | 'BUDGET_ERROR'
  | 'VALIDATION_ERROR'
  | 'FILE_ERROR'
  | 'NETWORK_ERROR'
  | 'CLI_ERROR'
  | 'CIRCUIT_OPEN'
  | 'OPERATION_TIMEOUT'
  | 'CONCURRENCY_LIMIT'
  | 'STATE_CORRUPT'
  | 'STATE_LOCK_FAILED'
  | 'STATE_WRITE_FAILED'
  | 'STATE_READ_FAILED';

/** Base error class for all DanteForge errors. */
export class DanteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly remedy: string = '',
  ) {
    super(message);
    this.name = 'DanteError';
  }
}

export class ConfigError extends DanteError {
  constructor(message: string, remedy = 'Check ~/.danteforge/config.yaml or run "danteforge config --help"') {
    super(message, 'CONFIG_ERROR', remedy);
    this.name = 'ConfigError';
  }
}

export class ValidationError extends DanteError {
  constructor(message: string, remedy = 'Check your input and try again') {
    super(message, 'VALIDATION_ERROR', remedy);
    this.name = 'ValidationError';
  }
}

export class FileError extends DanteError {
  constructor(message: string, public readonly filePath: string, remedy?: string) {
    super(message, 'FILE_ERROR', remedy ?? `Check that "${filePath}" exists and is readable`);
    this.name = 'FileError';
  }
}

export class NetworkError extends DanteError {
  constructor(message: string, remedy = 'Check your internet connection and API key') {
    super(message, 'NETWORK_ERROR', remedy);
    this.name = 'NetworkError';
  }
}

export class CLIError extends DanteError {
  constructor(message: string, public readonly exitCode: number = 1, remedy = '') {
    super(message, 'CLI_ERROR', remedy);
    this.name = 'CLIError';
  }
}

export class LLMError extends DanteError {
  constructor(
    message: string,
    public readonly llmCode?: string,
    public readonly provider?: string,
    remedy?: string,
    public readonly retryable?: boolean,
  ) {
    super(message, llmCode ?? 'LLM_ERROR', remedy ?? `Check your ${provider ?? 'LLM'} API key and connectivity`);
    this.name = 'LLMError';
  }
}

export class BudgetError extends DanteError {
  constructor(
    message: string,
    public readonly agentRole?: string,
    public readonly currentSpendUsd?: number,
    public readonly maxBudgetUsd?: number,
    remedy = 'Use a lighter preset (ember/spark) or increase --max-budget',
  ) {
    super(message, 'BUDGET_EXCEEDED', remedy);
    this.name = 'BudgetError';
  }
}

export class StateError extends DanteError {
  constructor(
    message: string,
    code: 'STATE_CORRUPT' | 'STATE_LOCK_FAILED' | 'STATE_WRITE_FAILED' | 'STATE_READ_FAILED' = 'STATE_CORRUPT',
    remedy = 'Delete .danteforge/STATE.yaml and run "danteforge init" to reset project state',
  ) {
    super(message, code, remedy);
    this.name = 'StateError';
  }
}

/** Map error codes to suggested next-step CLI commands */
export function suggestNextStep(err: DanteError): string {
  const suggestions: Record<string, string> = {
    CONFIG_MISSING_KEY: 'Run: danteforge config --set-key <provider>:<key>',
    CONFIG_ERROR: 'Run: danteforge doctor',
    LLM_UNAVAILABLE: 'Run: danteforge doctor --check-llm',
    LLM_AUTH_FAILED: 'Run: danteforge config --set-key <provider>:<your-api-key>',
    LLM_RATE_LIMITED: 'Wait a moment, or switch provider: danteforge config --set-key provider:ollama',
    LLM_TIMEOUT: 'Check connectivity, or use local model: danteforge config --set-key provider:ollama',
    LLM_CIRCUIT_OPEN: 'Circuit breaker tripped. Wait 30s or switch provider.',
    LLM_UNKNOWN_PROVIDER: 'Supported providers: ollama, claude, openai, gemini, grok',
    BUDGET_EXCEEDED: 'Run: danteforge magic --preset ember (lower budget)',
    STATE_CORRUPT: 'Run: danteforge init --force',
    STATE_LOCK_FAILED: 'Check for other running DanteForge processes, or delete .danteforge/STATE.lock',
    VALIDATION_ERROR: 'Run: danteforge help <command> for usage details',
    FILE_ERROR: 'Run: danteforge doctor to check project structure',
  };
  return suggestions[err.code] ?? err.remedy;
}

/**
 * Format a DanteError for display with code, message, remedy, and next-step suggestion.
 */
export function formatErrorForDisplay(err: DanteError): string {
  const lines = [`Error [${err.code}]: ${err.message}`];
  if (err.remedy) lines.push(`  Remedy: ${err.remedy}`);
  const suggestion = suggestNextStep(err);
  if (suggestion && suggestion !== err.remedy) lines.push(`  Next step: ${suggestion}`);
  return lines.join('\n');
}

/** Returns true if the error is likely transient and safe to retry */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof LLMError) return err.retryable !== false;
  if (err instanceof NetworkError) return true;
  if (err instanceof BudgetError) return false;
  if (err instanceof DanteError) {
    const retryableCodes = new Set(['LLM_RATE_LIMITED', 'LLM_TIMEOUT', 'LLM_EMPTY_RESPONSE', 'NETWORK_ERROR']);
    return retryableCodes.has(err.code);
  }
  // Plain errors with retryable message patterns (ECONNRESET, timeout, etc.)
  if (err instanceof Error) {
    const msg = err.message.toUpperCase();
    return msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('TIMEOUT');
  }
  return false;
}
