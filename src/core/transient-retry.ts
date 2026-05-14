// transient-retry.ts — Exponential-backoff retry wrapper for transient failures.
// Covers: network resets, timeouts, DNS failures, rate limits, service unavailable.
import { logger } from './logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of total attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Initial delay in milliseconds before the first retry. Default: 1000 */
  delayMs?: number;
  /** Multiply delay by this factor on each subsequent retry. Default: 2 */
  backoffFactor?: number;
  /** Predicate to decide whether an error is transient. Default: `isTransientError` */
  isTransient?: (err: Error) => boolean;
  /** Injectable sleep function for testing. Default: real setTimeout */
  _sleep?: (ms: number) => Promise<void>;
}

// ── Default transient-error classifier ───────────────────────────────────────

/**
 * Returns true for errors that are likely transient and safe to retry:
 *   - Network-level: ECONNRESET, ETIMEDOUT, ENOTFOUND, socket hang-up
 *   - HTTP rate-limit: 429 in message
 *   - HTTP server errors: 503 in message
 */
export function isTransientError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('503') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('request timed out')
  );
}

// ── Core retry wrapper ────────────────────────────────────────────────────────

/**
 * Wrap an async operation with transient-error retry logic.
 *
 * - Retries only errors that `isTransient` returns true for.
 * - Uses exponential backoff: delay doubles each retry.
 * - Logs each retry attempt at the `info` level.
 *
 * @param fn - Async operation to execute (called fresh each attempt).
 * @param options - Retry configuration (all optional, safe defaults apply).
 * @returns The resolved value from `fn` on success.
 * @throws The last error encountered if all attempts are exhausted.
 *
 * @example
 * const result = await withTransientRetry(() => callLLM(prompt), { maxAttempts: 3 });
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelay = options.delayMs ?? 1000;
  const backoffFactor = options.backoffFactor ?? 2;
  const isTransient = options.isTransient ?? isTransientError;
  const sleep = options._sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));

  let lastError: Error | undefined;
  let delayMs = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      const isLast = attempt >= maxAttempts;
      if (isLast || !isTransient(error)) {
        throw error;
      }

      logger.info(
        `[transient-retry] Retry ${attempt}/${maxAttempts - 1} after transient error: ${error.message}`,
      );
      await sleep(delayMs);
      delayMs = Math.round(delayMs * backoffFactor);
    }
  }

  // This line is only reachable if maxAttempts === 0, which is a misuse.
  throw lastError ?? new Error('[transient-retry] No attempts executed');
}
