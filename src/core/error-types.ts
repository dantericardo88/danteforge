// Structured error hierarchy for DanteForge.
// Provides typed errors with machine-readable codes and rich context for
// structured logging, retry policy decisions, and user-facing remediation.

// ---------------------------------------------------------------------------
// Base error class
// ---------------------------------------------------------------------------

export class DanteForgeError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context ?? {};
    // Maintain proper prototype chain in transpiled ES5 environments.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Config errors — CODE prefix: CONFIG_*
// ---------------------------------------------------------------------------

export class ConfigError extends DanteForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('CONFIG_ERROR', message, context);
  }
}

export class ConfigMissingKeyError extends ConfigError {
  constructor(key: string, context?: Record<string, unknown>) {
    super(`Missing required config key: ${key}`, { key, ...context });
    this.code; // already set by super
    Object.defineProperty(this, 'code', { value: 'CONFIG_MISSING_KEY', writable: false });
  }
}

// ---------------------------------------------------------------------------
// State errors — CODE prefix: STATE_*
// ---------------------------------------------------------------------------

export class StateError extends DanteForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('STATE_ERROR', message, context);
  }
}

export class StateCorruptError extends StateError {
  constructor(path: string, context?: Record<string, unknown>) {
    super(`State file corrupted: ${path}`, { path, ...context });
    Object.defineProperty(this, 'code', { value: 'STATE_CORRUPT', writable: false });
  }
}

// ---------------------------------------------------------------------------
// LLM errors — CODE prefix: LLM_*
// ---------------------------------------------------------------------------

export class LLMError extends DanteForgeError {
  constructor(
    code: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(code, message, context);
  }
}

export class RateLimitError extends LLMError {
  constructor(provider: string, context?: Record<string, unknown>) {
    super('LLM_RATE_LIMIT', `Rate limit exceeded for provider: ${provider}`, {
      provider,
      ...context,
    });
  }
}

export class TimeoutError extends LLMError {
  constructor(provider: string, timeoutMs?: number, context?: Record<string, unknown>) {
    super(
      'LLM_TIMEOUT',
      `Request timed out${timeoutMs !== undefined ? ` after ${timeoutMs}ms` : ''} for provider: ${provider}`,
      { provider, timeoutMs, ...context },
    );
  }
}

export class LLMUnavailableError extends LLMError {
  constructor(provider: string, context?: Record<string, unknown>) {
    super('LLM_UNAVAILABLE', `LLM provider unavailable: ${provider}`, {
      provider,
      ...context,
    });
  }
}

export class LLMAuthError extends LLMError {
  constructor(provider: string, context?: Record<string, unknown>) {
    super('LLM_AUTH_FAILED', `Authentication failed for provider: ${provider}`, {
      provider,
      ...context,
    });
  }
}

// ---------------------------------------------------------------------------
// Matrix errors — CODE prefix: MATRIX_*
// ---------------------------------------------------------------------------

export class MatrixError extends DanteForgeError {
  constructor(
    code: string,
    message: string,
    context?: Record<string, unknown>,
  ) {
    super(code, message, context);
  }
}

export class LeaseError extends MatrixError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MATRIX_LEASE_ERROR', message, context);
  }
}

export class WorktreeError extends MatrixError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MATRIX_WORKTREE_ERROR', message, context);
  }
}

export class ConflictError extends MatrixError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('MATRIX_CONFLICT', message, context);
  }
}

// ---------------------------------------------------------------------------
// Gate errors — CODE prefix: GATE_*
// ---------------------------------------------------------------------------

export class GateError extends DanteForgeError {
  constructor(gate: string, message: string, context?: Record<string, unknown>) {
    super(`GATE_${gate.toUpperCase()}`, message, { gate, ...context });
  }
}

// ---------------------------------------------------------------------------
// Spec errors — CODE prefix: SPEC_*
// ---------------------------------------------------------------------------

export class SpecError extends DanteForgeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super('SPEC_ERROR', message, context);
  }
}

export class SpecMissingError extends SpecError {
  constructor(artifact: string, context?: Record<string, unknown>) {
    super(`Required artifact missing: ${artifact}`, { artifact, ...context });
    Object.defineProperty(this, 'code', { value: 'SPEC_MISSING', writable: false });
  }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isDanteForgeError(e: unknown): e is DanteForgeError {
  return e instanceof DanteForgeError;
}

/** Returns true for errors that are safe to retry (transient failures). */
export function isRetryable(e: unknown): boolean {
  if (e instanceof RateLimitError) return true;
  if (e instanceof TimeoutError) return true;
  if (e instanceof LLMUnavailableError) return true;
  // Catch-all for generic network/transient patterns in Error messages
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    return (
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      msg.includes('fetch failed') ||
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('503') ||
      msg.includes('502')
    );
  }
  return false;
}
