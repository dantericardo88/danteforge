// OpenPencil Adapter — Bridges OpenPencil's tool system to DanteForge's prompt-builder and MCP layer
// Translates MCP tool calls through DanteForge's sanitization pipeline.

import { loadToolRegistry, toolToMCPFormat, findTool, getToolSummary } from './tool-registry.js';
import type { OPTool, MCPToolDefinition } from './tool-registry.js';

/**
 * Result of initializing the OpenPencil adapter.
 */
export interface OpenPencilAdapterResult {
  tools: OPTool[];
  mcpTools: MCPToolDefinition[];
  toolCount: number;
  categories: string[];
}

/**
 * Result of a tool execution.
 */
export interface ToolExecutionResult {
  tool: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Initialize the OpenPencil adapter — loads all 86 tools and prepares MCP definitions.
 */
export async function initOpenPencilAdapter(): Promise<OpenPencilAdapterResult> {
  const tools = await loadToolRegistry();
  const mcpTools = tools.map(toolToMCPFormat);
  const categories = [...new Set(tools.map(t => t.category))];

  return {
    tools,
    mcpTools,
    toolCount: tools.length,
    categories,
  };
}

/**
 * Execute a tool by name with the given parameters.
 * Validates parameter types before execution.
 */
export async function executeToolCall(
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const start = Date.now();

  const tool = await findTool(toolName);
  if (!tool) {
    return {
      tool: toolName,
      success: false,
      error: `Unknown tool: "${toolName}". Use getToolSummary() to list available tools.`,
      durationMs: Date.now() - start,
    };
  }

  // Validate required parameters
  for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
    if (paramDef.required && !(paramName in params)) {
      return {
        tool: toolName,
        success: false,
        error: `Missing required parameter: "${paramName}" (${paramDef.description})`,
        durationMs: Date.now() - start,
      };
    }

    // Type validation for provided params
    if (paramName in params) {
      const value = params[paramName];
      const expectedType = paramDef.type;

      if (expectedType === 'string' && typeof value !== 'string') {
        return {
          tool: toolName,
          success: false,
          error: `Parameter "${paramName}" must be a string, got ${typeof value}`,
          durationMs: Date.now() - start,
        };
      }
      if (expectedType === 'number' && typeof value !== 'number') {
        return {
          tool: toolName,
          success: false,
          error: `Parameter "${paramName}" must be a number, got ${typeof value}`,
          durationMs: Date.now() - start,
        };
      }
      if (expectedType === 'boolean' && typeof value !== 'boolean') {
        return {
          tool: toolName,
          success: false,
          error: `Parameter "${paramName}" must be a boolean, got ${typeof value}`,
          durationMs: Date.now() - start,
        };
      }

      // Enum validation
      if (paramDef.enum && typeof value === 'string' && !paramDef.enum.includes(value)) {
        return {
          tool: toolName,
          success: false,
          error: `Parameter "${paramName}" must be one of: ${paramDef.enum.join(', ')}. Got: "${value}"`,
          durationMs: Date.now() - start,
        };
      }
    }
  }

  try {
    const result = await tool.execute(params);
    return {
      tool: toolName,
      success: true,
      result,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      tool: toolName,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Execute multiple tool calls in batch with concurrency control.
 * Returns results keyed by tool name.
 */
export async function executeToolBatch(
  calls: { tool: string; params: Record<string, unknown> }[],
  maxConcurrency = 4,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];

  // Process in chunks of maxConcurrency
  for (let i = 0; i < calls.length; i += maxConcurrency) {
    const chunk = calls.slice(i, i + maxConcurrency);
    const chunkResults = await Promise.all(
      chunk.map(call => executeToolCall(call.tool, call.params)),
    );
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Generate a prompt-friendly tool summary for LLM consumption.
 * Used in --prompt mode to describe available tools without full schemas.
 */
export async function buildToolPromptSummary(): Promise<string> {
  const summary = await getToolSummary();
  const lines: string[] = ['## OpenPencil Tools (84 total)', ''];

  for (const [category, info] of Object.entries(summary)) {
    lines.push(`### ${category} (${info.count} tools)`);
    lines.push(info.tools.map(t => `- ${t}`).join('\n'));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get MCP tool definitions filtered for a specific task context.
 * Avoids sending all 84 schemas to the LLM — sends only relevant ones.
 */
export async function getRelevantTools(taskContext: string): Promise<MCPToolDefinition[]> {
  const tools = await loadToolRegistry();
  const context = taskContext.toLowerCase();

  // Determine which categories are relevant based on context keywords
  const categoryRelevance: Record<string, string[]> = {
    read: ['inspect', 'query', 'find', 'get', 'list', 'select', 'tree', 'children'],
    create: ['create', 'new', 'add', 'generate', 'make', 'build', 'render'],
    modify: ['change', 'set', 'update', 'modify', 'resize', 'move', 'color', 'font', 'style', 'layout', 'padding'],
    structure: ['delete', 'remove', 'group', 'clone', 'duplicate', 'reorder', 'reparent', 'swap', 'flatten'],
    variables: ['token', 'variable', 'bind', 'collection', 'design system'],
    vector: ['boolean', 'union', 'subtract', 'export', 'svg', 'png', 'css', 'jsx', 'tailwind', 'zoom'],
    analysis: ['analyze', 'audit', 'diff', 'spacing', 'color', 'typography', 'cluster'],
  };

  const relevantCategories = new Set<string>();

  for (const [category, keywords] of Object.entries(categoryRelevance)) {
    if (keywords.some(kw => context.includes(kw))) {
      relevantCategories.add(category);
    }
  }

  // Always include read and analysis for context
  relevantCategories.add('read');

  // If no specific category matched, include create and modify
  if (relevantCategories.size <= 1) {
    relevantCategories.add('create');
    relevantCategories.add('modify');
  }

  const relevant = tools.filter(t => relevantCategories.has(t.category));
  return relevant.map(toolToMCPFormat);
}
