/**
 * Universal Resilience Layer
 *
 * Provides circuit breaker, timeout, and retry logic for ALL I/O operations:
 * - File I/O (read, write)
 * - Git operations (clone, commit, push)
 * - MCP calls (Figma, GitHub, etc.)
 * - Network requests
 *
 * Extends the per-provider circuit breaker to cover all external dependencies.
 */

import {
  shouldAllowRequest,
  recordSuccess,
  recordFailure,
  computeBackoffDelay,
  type CircuitBreakerConfig,
} from './circuit-breaker.js';
import { DanteError } from './errors.js';

/**
 * Operation types for categorization and monitoring
 */
export type OperationType =
  | 'file_read'
  | 'file_write'
  | 'git_clone'
  | 'git_commit'
  | 'git_push'
  | 'git_pull'
  | 'mcp_call'
  | 'network_request'
  | 'llm_call';

/**
 * Configuration for resilient operation execution
 */
export interface ResilienceConfig {
  /** Operation type (for circuit breaker key) */
  operationType: OperationType;

  /** Operation identifier (e.g., 'git_clone:https://github.com/repo') */
  operationId: string;

  /** Maximum concurrent executions (default: unlimited) */
  maxConcurrent?: number;

  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;

  /** Number of retry attempts (default: 3) */
  retries?: number;

  /** Circuit breaker config (uses defaults if not provided) */
  circuitBreaker?: CircuitBreakerConfig;
}

/**
 * Get global timeout (reads env var dynamically)
 */
function getGlobalTimeout(): number {
  return parseInt(process.env.DANTEFORGE_OPERATION_TIMEOUT_MS || '', 10) || 300_000; // 5 minutes
}

/**
 * Default resilience config
 */
const DEFAULT_CONFIG: Partial<ResilienceConfig> = {
  timeout: undefined, // Will use getGlobalTimeout() if not specified
  retries: 3,
  circuitBreaker: {
    failureThreshold: 5, // More tolerant for file I/O (vs 3 for LLM)
    resetTimeoutMs: 30_000, // 30 seconds
    halfOpenSuccessThreshold: 1,
  },
};

/**
 * Track concurrent operations for rate limiting
 */
const concurrentOperations = new Map<string, number>();

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitOpenError extends DanteError {
  constructor(
    public readonly operationType: string,
    public readonly operationId: string,
  ) {
    super(
      `Circuit breaker is OPEN for ${operationType}:${operationId}. Too many recent failures. Wait 30s and retry.`,
      'CIRCUIT_OPEN',
    );
  }
}

/**
 * Error thrown when operation times out
 */
export class OperationTimeoutError extends DanteError {
  constructor(
    public readonly operationType: string,
    public readonly operationId: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Operation ${operationType}:${operationId} timed out after ${timeoutMs}ms`,
      'OPERATION_TIMEOUT',
    );
  }
}

/**
 * Error thrown when max concurrent limit reached
 */
export class ConcurrencyLimitError extends DanteError {
  constructor(
    public readonly operationType: string,
    public readonly maxConcurrent: number,
  ) {
    super(
      `Maximum concurrent ${operationType} operations reached (${maxConcurrent}). Try again later.`,
      'CONCURRENCY_LIMIT',
    );
  }
}

/**
 * Execute an operation with resilience patterns (circuit breaker, timeout, retry)
 *
 * @param operation - Async operation to execute
 * @param config - Resilience configuration
 * @returns Result of operation
 * @throws CircuitOpenError if circuit breaker is open
 * @throws OperationTimeoutError if operation times out
 * @throws ConcurrencyLimitError if max concurrent limit reached
 */
export async function executeWithResilience<T>(
  operation: () => Promise<T>,
  config: ResilienceConfig,
): Promise<T> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const { operationType, operationId, maxConcurrent, retries, circuitBreaker } = fullConfig;
  const timeout = fullConfig.timeout ?? getGlobalTimeout();

  const circuitKey = `${operationType}:${operationId}`;

  // Check circuit breaker
  if (!shouldAllowRequest(circuitKey, circuitBreaker)) {
    throw new CircuitOpenError(operationType, operationId);
  }

  // Check concurrency limit
  if (maxConcurrent !== undefined) {
    const current = concurrentOperations.get(operationType) || 0;
    if (current >= maxConcurrent) {
      throw new ConcurrencyLimitError(operationType, maxConcurrent);
    }
  }

  // Track concurrent execution
  const current = concurrentOperations.get(operationType) || 0;
  concurrentOperations.set(operationType, current + 1);

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= (retries || 0); attempt++) {
    try {
      // Execute with timeout
      const result = await executeWithTimeout(operation, timeout, {
        operationType,
        operationId,
      });

      // Success - record and return
      recordSuccess(circuitKey, circuitBreaker);
      return result;
    } catch (err) {
      lastError = err as Error;

      // Don't retry on circuit breaker or concurrency errors
      if (err instanceof CircuitOpenError || err instanceof ConcurrencyLimitError) {
        throw err;
      }

      // Record failure
      recordFailure(circuitKey, circuitBreaker);

      // If this was the last attempt, throw
      if (attempt === retries) {
        break;
      }

      // Exponential backoff before retry
      const backoffMs = computeBackoffDelay(attempt);
      await sleep(backoffMs);
    } finally {
      // Decrement concurrent counter
      const updated = (concurrentOperations.get(operationType) || 1) - 1;
      if (updated <= 0) {
        concurrentOperations.delete(operationType);
      } else {
        concurrentOperations.set(operationType, updated);
      }
    }
  }

  // All retries exhausted
  throw lastError || new Error('Operation failed with unknown error');
}

/**
 * Execute operation with timeout
 *
 * @param operation - Async operation to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param context - Context for error message
 * @returns Result of operation
 * @throws OperationTimeoutError if operation times out
 */
async function executeWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  context: { operationType: string; operationId: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OperationTimeoutError(context.operationType, context.operationId, timeoutMs));
    }, timeoutMs);

    operation()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get current concurrent operation count for a type
 */
export function getConcurrentCount(operationType: OperationType): number {
  return concurrentOperations.get(operationType) || 0;
}

/**
 * Reset all concurrent counters (for testing)
 */
export function resetConcurrentCounters(): void {
  concurrentOperations.clear();
}

/**
 * Resilient file read operation
 */
export async function readFileResilient(
  path: string,
  operation: () => Promise<string>,
  options?: Partial<ResilienceConfig>,
): Promise<string> {
  return executeWithResilience(operation, {
    operationType: 'file_read',
    operationId: path,
    ...options,
  });
}

/**
 * Resilient file write operation
 */
export async function writeFileResilient(
  path: string,
  operation: () => Promise<void>,
  options?: Partial<ResilienceConfig>,
): Promise<void> {
  return executeWithResilience(operation, {
    operationType: 'file_write',
    operationId: path,
    ...options,
  });
}

/**
 * Resilient git operation
 */
export async function gitOperationResilient<T>(
  gitCommand: string,
  operation: () => Promise<T>,
  options?: Partial<ResilienceConfig>,
): Promise<T> {
  return executeWithResilience(operation, {
    operationType: gitCommand.startsWith('clone')
      ? 'git_clone'
      : gitCommand.startsWith('commit')
        ? 'git_commit'
        : gitCommand.startsWith('push')
          ? 'git_push'
          : 'git_pull',
    operationId: gitCommand,
    ...options,
  });
}

/**
 * Resilient MCP call
 */
export async function mcpCallResilient<T>(
  server: string,
  tool: string,
  operation: () => Promise<T>,
  options?: Partial<ResilienceConfig>,
): Promise<T> {
  return executeWithResilience(operation, {
    operationType: 'mcp_call',
    operationId: `${server}:${tool}`,
    ...options,
  });
}

/**
 * Resilient network request
 */
export async function networkRequestResilient<T>(
  url: string,
  operation: () => Promise<T>,
  options?: Partial<ResilienceConfig>,
): Promise<T> {
  return executeWithResilience(operation, {
    operationType: 'network_request',
    operationId: url,
    ...options,
  });
}
