// MCP Parallel Execution — Run multiple MCP tool calls concurrently
// Respects concurrency limits and handles partial failures.

import { logger } from './logger.js';
import { NetworkError } from './errors.js';

export interface MCPToolCall {
  tool: string;
  params: Record<string, unknown>;
}

export interface MCPToolResult {
  tool: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Execute multiple MCP tool calls with concurrency control.
 * Returns results for all calls, preserving order.
 */
export async function executeToolsBatch(
  calls: MCPToolCall[],
  executor: (call: MCPToolCall) => Promise<MCPToolResult>,
  options: { maxConcurrency?: number; timeout?: number; failFast?: boolean } = {},
): Promise<MCPToolResult[]> {
  if (calls.length === 0) return [];

  const maxConcurrency = normalizeConcurrency(options.maxConcurrency ?? 4, calls.length);
  const timeout = options.timeout ?? 30000;
  const results: MCPToolResult[] = new Array(calls.length);
  let nextIndex = 0;
  let failFastTriggered = false;

  async function worker(): Promise<void> {
    while (!failFastTriggered) {
      const index = nextIndex++;
      if (index >= calls.length) return;

      const call = calls[index]!;
      try {
        results[index] = await executeWithTimeout(call, executor, timeout);
      } catch (err) {
        results[index] = {
          tool: call.tool,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        };
      }

      if (options.failFast && !results[index]!.success) {
        failFastTriggered = true;
        break;
      }
    }
  }

  await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));

  if (failFastTriggered) {
    const failed = results.filter(r => r && !r.success);
    logger.warn(`Fail-fast: ${failed.length} tool(s) failed, aborting batch`);
    for (let i = 0; i < calls.length; i++) {
      if (!results[i]) {
        results[i] = { tool: calls[i]!.tool, success: false, error: 'Skipped (fail-fast)', durationMs: 0 };
      }
    }
  }

  return results;
}

function normalizeConcurrency(value: number, callCount: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), callCount);
}

async function executeWithTimeout(
  call: MCPToolCall,
  executor: (call: MCPToolCall) => Promise<MCPToolResult>,
  timeout: number,
): Promise<MCPToolResult> {
  return new Promise<MCPToolResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new NetworkError(
        `Tool "${call.tool}" timed out after ${timeout}ms`,
        `Increase timeout or check if "${call.tool}" is responsive`,
      ));
    }, timeout);

    executor(call).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Summarize batch execution results.
 */
export function summarizeBatch(results: MCPToolResult[]): {
  total: number;
  succeeded: number;
  failed: number;
  totalDurationMs: number;
} {
  const succeeded = results.filter(r => r.success).length;
  const totalDurationMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    totalDurationMs,
  };
}
