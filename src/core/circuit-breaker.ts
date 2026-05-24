// Per-provider circuit breaker — prevents hammering dead providers
// State machine: CLOSED → (failures ≥ threshold) → OPEN → (after resetTimeout) → HALF_OPEN → (success) → CLOSED
// Trips and resets are logged to the structured error log for rate tracking.

import { logStructuredError } from './error-log.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold: number;       // default: 3
  resetTimeoutMs: number;         // default: 30_000
  halfOpenSuccessThreshold: number; // default: 1
}

interface CircuitEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number;
  halfOpenSuccessCount: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  halfOpenSuccessThreshold: 1,
};

const circuits = new Map<string, CircuitEntry>();

function getOrCreateEntry(provider: string): CircuitEntry {
  let entry = circuits.get(provider);
  if (!entry) {
    entry = { state: 'closed', failureCount: 0, lastFailureAt: 0, halfOpenSuccessCount: 0 };
    circuits.set(provider, entry);
  }
  return entry;
}

/** Get the current circuit state for a provider */
export function getCircuitState(provider: string): CircuitState {
  const entry = circuits.get(provider);
  return entry?.state ?? 'closed';
}

/** Check if a request should be allowed through the circuit breaker */
export function shouldAllowRequest(
  provider: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG,
  now = Date.now(),
): boolean {
  const entry = getOrCreateEntry(provider);

  switch (entry.state) {
    case 'closed':
      return true;
    case 'open': {
      // Check if enough time has passed to transition to half_open
      if (now - entry.lastFailureAt >= config.resetTimeoutMs) {
        entry.state = 'half_open';
        entry.halfOpenSuccessCount = 0;
        return true;
      }
      return false;
    }
    case 'half_open':
      return true;
  }
}

/** Record a successful request — may transition half_open → closed */
export function recordSuccess(provider: string, config: CircuitBreakerConfig = DEFAULT_CONFIG): void {
  const entry = getOrCreateEntry(provider);
  const wasHalfOpen = entry.state === 'half_open';

  if (entry.state === 'half_open') {
    entry.halfOpenSuccessCount++;
    if (entry.halfOpenSuccessCount >= config.halfOpenSuccessThreshold) {
      entry.state = 'closed';
      entry.failureCount = 0;
      entry.halfOpenSuccessCount = 0;
    }
  } else if (entry.state === 'closed') {
    // Reset failure count on success in closed state
    entry.failureCount = 0;
  }

  // Log circuit reset when transitioning from half_open → closed.
  // Deferred via setImmediate so logging never blocks the circuit-breaker hot path.
  if (wasHalfOpen && entry.state === 'closed') {
    setImmediate(() => {
      logStructuredError(
        new Error(`Circuit breaker reset for provider: ${provider}`),
        { command: 'circuit-breaker', phase: 'reset' },
      );
    });
  }
}

/** Record a failed request — may transition closed → open or half_open → open */
export function recordFailure(provider: string, config: CircuitBreakerConfig = DEFAULT_CONFIG): void {
  const entry = getOrCreateEntry(provider);
  const wasClosed = entry.state === 'closed';
  const wasHalfOpen = entry.state === 'half_open';
  entry.failureCount++;
  entry.lastFailureAt = Date.now();

  if (entry.state === 'half_open') {
    // Any failure in half_open → back to open
    entry.state = 'open';
    entry.halfOpenSuccessCount = 0;
  } else if (entry.state === 'closed' && entry.failureCount >= config.failureThreshold) {
    entry.state = 'open';
  }

  // Log circuit trip when transitioning to OPEN.
  // Deferred via setImmediate so logging never blocks the circuit-breaker hot path.
  const tripped =
    (wasClosed && entry.state === 'open') ||
    (wasHalfOpen && entry.state === 'open');
  if (tripped) {
    setImmediate(() => {
      logStructuredError(
        new Error(`Circuit breaker open for provider: ${provider} after ${entry.failureCount} failure(s)`),
        { command: 'circuit-breaker', phase: 'open' },
      );
    });
  }
}

/** Compute exponential backoff delay for a given attempt */
export function computeBackoffDelay(
  attempt: number,
  baseMs = 1000,
  maxMs = 30_000,
): number {
  const delay = baseMs * Math.pow(2, attempt);
  return Math.min(delay, maxMs);
}

/** Reset all circuit breaker state (for testing) */
export function resetAllCircuits(): void {
  circuits.clear();
}
