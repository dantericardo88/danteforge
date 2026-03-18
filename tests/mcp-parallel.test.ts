import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  executeToolsBatch,
  summarizeBatch,
} from '../src/core/mcp-parallel.js';
import type { MCPToolCall, MCPToolResult } from '../src/core/mcp-parallel.js';

describe('executeToolsBatch', () => {
  it('handles empty call list', async () => {
    const results = await executeToolsBatch([], async () => ({
      tool: 'none',
      success: true,
      durationMs: 0,
    }));
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  it('runs executor for each call', async () => {
    const calls: MCPToolCall[] = [
      { tool: 'tool-a', params: { key: 'a' } },
      { tool: 'tool-b', params: { key: 'b' } },
      { tool: 'tool-c', params: { key: 'c' } },
    ];

    const executed: string[] = [];
    const executor = async (call: MCPToolCall): Promise<MCPToolResult> => {
      executed.push(call.tool);
      return { tool: call.tool, success: true, durationMs: 10 };
    };

    const results = await executeToolsBatch(calls, executor);
    assert.strictEqual(results.length, 3);
    assert.ok(executed.includes('tool-a'));
    assert.ok(executed.includes('tool-b'));
    assert.ok(executed.includes('tool-c'));
    assert.ok(results.every(r => r.success));
  });

  it('respects maxConcurrency', async () => {
    const calls: MCPToolCall[] = [
      { tool: 'tool-1', params: {} },
      { tool: 'tool-2', params: {} },
      { tool: 'tool-3', params: {} },
      { tool: 'tool-4', params: {} },
      { tool: 'tool-5', params: {} },
    ];

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const executor = async (call: MCPToolCall): Promise<MCPToolResult> => {
      currentConcurrent++;
      if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
      // Small delay to allow overlap detection
      await new Promise(resolve => setTimeout(resolve, 10));
      currentConcurrent--;
      return { tool: call.tool, success: true, durationMs: 10 };
    };

    await executeToolsBatch(calls, executor, { maxConcurrency: 2 });
    assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
  });
});

describe('summarizeBatch', () => {
  it('counts successes and failures', () => {
    const results: MCPToolResult[] = [
      { tool: 'a', success: true, durationMs: 100 },
      { tool: 'b', success: false, error: 'failed', durationMs: 50 },
      { tool: 'c', success: true, durationMs: 200 },
      { tool: 'd', success: false, error: 'timeout', durationMs: 0 },
    ];

    const summary = summarizeBatch(results);
    assert.strictEqual(summary.total, 4);
    assert.strictEqual(summary.succeeded, 2);
    assert.strictEqual(summary.failed, 2);
    assert.strictEqual(summary.totalDurationMs, 350);
  });
});
