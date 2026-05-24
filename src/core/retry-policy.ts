// Retry policy with exponential backoff + jitter.
// Fully injectable delay function so tests run at full speed (no real sleeping).

import { isRetryable } from './error-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of total attempts (including the initial one). Default: 3 */
  maxAttempts: number;
  /** Base delay in milliseconds before the first retry. Default: 1000 */
  baseDelayMs: number;
  /** Ceiling on the computed delay. Default: 30_000 */
  maxDelayMs: number;
  /** Exponential factor applied per attempt. Default: 2 */
  factor: number;
  /** Add ±20% randomness to avoid thundering herd. Default: true */
  jitter: boolean;
  /** Custom predicate — retry only when this returns true. Default: isRetryable() */
  retryIf?: (err: unknown) => boolean;
  /** Injected delay for testing (avoids real sleeps). Default: real setTimeout */
  _delayFn?: (ms: number) => Promise<void>;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalDelayMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: Required<Omit<RetryOptions, 'retryIf' | '_delayFn'>> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: true,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveOptions(opts?: Partial<RetryOptions>): Required<Omit<RetryOptions, '_delayFn'>> & {
  _delayFn: (ms: number) => Promise<void>;
} {
  const merged = { ...DEFAULTS, ...opts };
  return {
    maxAttempts: merged.maxAttempts,
    baseDelayMs: merged.baseDelayMs,
    maxDelayMs: merged.maxDelayMs,
    factor: merged.factor,
    jitter: merged.jitter,
    retryIf: opts?.retryIf ?? isRetryable,
    _delayFn:
      opts?._delayFn ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  };
}

/**
 * Compute the delay for a given attempt index (0-based: 0 = before first retry).
 * Formula: min(base * factor^attempt, max) ± jitter(20%)
 */
export function computeDelay(
  attempt: number,
  opts: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter'>,
): number {
  const raw = (opts.baseDelayMs ?? DEFAULTS.baseDelayMs) *
    Math.pow(opts.factor ?? DEFAULTS.factor, attempt);
  const capped = Math.min(raw, opts.maxDelayMs ?? DEFAULTS.maxDelayMs);
  if (!(opts.jitter ?? DEFAULTS.jitter)) return capped;
  // ±20% jitter: multiply by a value in [0.8, 1.2)
  const jitterFactor = 0.8 + Math.random() * 0.4;
  return Math.round(capped * jitterFactor);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute `fn`, retrying on retryable errors with exponential backoff + jitter.
 * Throws the last error after exhausting all attempts.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const { result } = await withRetryDetailed(fn, options);
  return result;
}

/**
 * Like `withRetry` but also returns metadata about the run (attempt count, delay).
 */
export async function withRetryDetailed<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<RetryResult<T>> {
  const opts = resolveOptions(options);
  let lastErr: unknown;
  let totalDelayMs = 0;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    if (attempt > 0) {
      // Wait before retrying (attempt 0 = before 1st retry, i.e. after initial failure)
      const delay = computeDelay(attempt - 1, opts);
      totalDelayMs += delay;
      await opts._delayFn(delay);
    }

    try {
      const result = await fn();
      return { result, attempts: attempt + 1, totalDelayMs };
    } catch (err) {
      lastErr = err;
      // Check if this error qualifies for a retry
      if (!opts.retryIf(err)) {
        throw err;
      }
      // If we've exhausted attempts, don't loop again
      if (attempt === opts.maxAttempts - 1) {
        throw err;
      }
    }
  }

  // Should not reach here; throw for type-safety
  throw lastErr;
}
