// Error hierarchy — structured errors with machine-readable codes and human-readable remedies.
// Mirrors the GateError pattern from gates.ts but covers the full CLI surface.

/** Base error class for all DanteForge errors. */
export class DanteError extends Error {
  public readonly retryable: boolean;
  public readonly remedy: string;

  constructor(
    message: string,
    public readonly code: string,
    retryableOrRemedy: string | boolean = false,
  ) {
    super(message);
    this.name = 'DanteError';
    if (typeof retryableOrRemedy === 'boolean') {
      this.retryable = retryableOrRemedy;
      this.remedy = '';
    } else {
      this.retryable = false;
      this.remedy = retryableOrRemedy;
    }
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
  constructor(message: string, public readonly provider?: string, remedy?: string, code?: string) {
    super(message, code ?? 'LLM_ERROR', remedy ?? `Check your ${provider ?? 'LLM'} API key and connectivity`);
    this.name = 'LLMError';
  }
}

export class BudgetError extends DanteError {
  public readonly agentRole: string;
  public readonly currentSpendUsd: number;
  public readonly maxBudgetUsd: number;

  constructor(
    message: string,
    opts?: { agentRole?: string; currentSpendUsd?: number; maxBudgetUsd?: number; remedy?: string },
  ) {
    // Use BUDGET_EXCEEDED when detail opts are provided (fence-exceeded context),
    // BUDGET_ERROR for generic usage (backward compat with errors.test.ts)
    const code = opts && (opts.agentRole !== undefined || opts.currentSpendUsd !== undefined) ? 'BUDGET_EXCEEDED' : 'BUDGET_ERROR';
    super(message, code, opts?.remedy ?? 'Use a lighter preset (ember/spark) or increase --max-budget');
    this.name = 'BudgetError';
    this.agentRole = opts?.agentRole ?? '';
    this.currentSpendUsd = opts?.currentSpendUsd ?? 0;
    this.maxBudgetUsd = opts?.maxBudgetUsd ?? 0;
  }
}

export function isRetryableError(err: unknown): boolean {
  if (err instanceof DanteError && err.retryable) return true;
  if (err instanceof NetworkError) return true;
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
