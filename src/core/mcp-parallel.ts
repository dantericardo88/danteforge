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
  const maxConcurrency = options.maxConcurrency ?? 4;
  const timeout = options.timeout ?? 30000;
  const results: MCPToolResult[] = new Array(calls.length);

  // Process in concurrent chunks
  for (let i = 0; i < calls.length; i += maxConcurrency) {
    const chunk = calls.slice(i, i + maxConcurrency);
    const chunkPromises = chunk.map((call, j) => {
      const index = i + j;
      return executeWithTimeout(call, executor, timeout)
        .then(result => { results[index] = result; })
        .catch(err => {
          results[index] = {
            tool: call.tool,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: 0,
          };
        });
    });

    await Promise.all(chunkPromises);

    // Check for fail-fast
    if (options.failFast) {
      const failed = results.filter(r => r && !r.success);
      if (failed.length > 0) {
        logger.warn(`Fail-fast: ${failed.length} tool(s) failed, aborting batch`);
        // Fill remaining with skipped
        for (let k = i + maxConcurrency; k < calls.length; k++) {
          results[k] = { tool: calls[k].tool, success: false, error: 'Skipped (fail-fast)', durationMs: 0 };
        }
        break;
      }
    }
  }

  return results;
}

async function executeWithTimeout(
  call: MCPToolCall,
  executor: (call: MCPToolCall) => Promise<MCPToolResult>,
  timeout: number,
): Promise<MCPToolResult> {
  return Promise.race([
    executor(call),
    new Promise<MCPToolResult>((_, reject) =>
      setTimeout(() => reject(new NetworkError(`Tool "${call.tool}" timed out after ${timeout}ms`, `Increase timeout or check if "${call.tool}" is responsive`)), timeout),
    ),
  ]);
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
