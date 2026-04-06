/**
 * DanteForge MCP Server
 *
 * Exposes 16 DanteForge tools via JSON-RPC 2.0 over stdio so that
 * Claude Code, Cursor, Codex, and other MCP-aware agents can invoke the
 * full spec-driven pipeline without shelling out to the CLI themselves.
 *
 * Uses a dynamic import of @modelcontextprotocol/sdk with a manual stdio
 * JSON-RPC fallback so it works even when the SDK is not installed.
 */

import { loadState } from './state.js';
import { appendLesson } from '../cli/commands/lessons.js';
import { assess } from '../cli/commands/assess.js';
import { forge } from '../cli/commands/forge.js';
import { verify } from '../cli/commands/verify.js';
import { autoforge } from '../cli/commands/autoforge.js';
import { plan } from '../cli/commands/plan.js';
import { tasks } from '../cli/commands/tasks.js';
import { synthesize } from '../cli/commands/synthesize.js';
import { retro } from '../cli/commands/retro.js';
import { maturity } from '../cli/commands/maturity.js';
import { specify } from '../cli/commands/specify.js';
import { constitution } from '../cli/commands/constitution.js';
import { generateMasterplan } from './gap-masterplan.js';
import { scanCompetitors } from './competitor-scanner.js';

// ── Injection seam interface ──────────────────────────────────────────────────

export interface McpServerDeps {
  _assess?: (opts: Record<string, unknown>) => Promise<unknown>;
  _forge?: (opts: Record<string, unknown>) => Promise<unknown>;
  _verify?: (opts: Record<string, unknown>) => Promise<unknown>;
  _autoforge?: (goal: string | undefined, opts: Record<string, unknown>) => Promise<unknown>;
  _plan?: (opts: Record<string, unknown>) => Promise<unknown>;
  _tasks?: (opts: Record<string, unknown>) => Promise<unknown>;
  _synthesize?: () => Promise<unknown>;
  _retro?: (opts: Record<string, unknown>) => Promise<unknown>;
  _maturity?: (opts: Record<string, unknown>) => Promise<unknown>;
  _specify?: (idea: string, opts: Record<string, unknown>) => Promise<unknown>;
  _constitution?: (opts?: Record<string, unknown>) => Promise<unknown>;
  _loadState?: (opts: Record<string, unknown>) => Promise<unknown>;
  _generateMasterplan?: (opts: Record<string, unknown>) => Promise<unknown>;
  _scanCompetitors?: (opts: Record<string, unknown>) => Promise<unknown>;
  _appendLesson?: (entry: string, opts?: Record<string, unknown>) => Promise<void>;
  _workflow?: (opts: Record<string, unknown>) => Promise<unknown>;
}

// ── Tool registry ─────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS = [
  {
    name: 'danteforge_assess',
    description: 'Run 18-dimension quality scoring benchmarked against 27 competitors',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        json: { type: 'boolean', description: 'Return JSON output', default: false },
      },
    },
  },
  {
    name: 'danteforge_forge',
    description: 'Execute GSD execution waves to build a feature or fix',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        phase: { type: 'string', description: 'Wave phase number', default: '1' },
        prompt: { type: 'boolean', description: 'Copy-paste prompt mode', default: false },
        light: { type: 'boolean', description: 'Skip hard gates', default: false },
      },
    },
  },
  {
    name: 'danteforge_verify',
    description: 'Run verification checks — validate project state, artifacts, and tests',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        release: { type: 'boolean', description: 'Include release checks', default: false },
      },
    },
  },
  {
    name: 'danteforge_autoforge',
    description: 'Deterministic auto-orchestration loop — score artifacts, plan next steps, execute',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        goal: { type: 'string', description: 'Optional goal description' },
        waves: { type: 'number', description: 'Max waves to run', default: 3 },
        dryRun: { type: 'boolean', description: 'Plan only, do not execute', default: false },
      },
    },
  },
  {
    name: 'danteforge_plan',
    description: 'Generate detailed implementation plan from spec',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        prompt: { type: 'boolean', description: 'Copy-paste prompt mode', default: false },
        light: { type: 'boolean', description: 'Skip hard gates', default: false },
      },
    },
  },
  {
    name: 'danteforge_tasks',
    description: 'Break plan into executable task list — structured for wave execution',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        prompt: { type: 'boolean', description: 'Copy-paste prompt mode', default: false },
        light: { type: 'boolean', description: 'Skip hard gates', default: false },
      },
    },
  },
  {
    name: 'danteforge_synthesize',
    description: 'Generate Ultimate Planning Resource (UPR.md) — consolidate all artifacts',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
      },
    },
  },
  {
    name: 'danteforge_retro',
    description: 'Run a retrospective — capture lessons, score the session',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        summary: { type: 'boolean', description: 'Summary mode only', default: false },
      },
    },
  },
  {
    name: 'danteforge_maturity',
    description: 'Analyze current code maturity level with 8-dimension scoring',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        json: { type: 'boolean', description: 'Return JSON output', default: false },
      },
    },
  },
  {
    name: 'danteforge_specify',
    description: 'Start the SPEC refinement flow — transform idea into full spec',
    inputSchema: {
      type: 'object',
      required: ['idea'],
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        idea: { type: 'string', description: 'High-level idea or feature description' },
        prompt: { type: 'boolean', description: 'Copy-paste prompt mode', default: false },
      },
    },
  },
  {
    name: 'danteforge_constitution',
    description: 'Generate project constitution — principles, quality bar, constraints',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        prompt: { type: 'boolean', description: 'Copy-paste prompt mode', default: false },
        light: { type: 'boolean', description: 'Skip hard gates', default: false },
      },
    },
  },
  {
    name: 'danteforge_state_read',
    description: 'Read current DanteForge state — workflow stage, tasks, audit log',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
      },
    },
  },
  {
    name: 'danteforge_masterplan',
    description: 'Generate gap-closing masterplan from competitor analysis',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        prompt: { type: 'boolean', description: 'Copy-paste prompt mode', default: false },
      },
    },
  },
  {
    name: 'danteforge_competitors',
    description: 'Scan competitor landscape and compute dimension gaps',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        json: { type: 'boolean', description: 'Return JSON output', default: false },
      },
    },
  },
  {
    name: 'danteforge_lessons_add',
    description: 'Append a lesson or correction to the self-improving lessons log',
    inputSchema: {
      type: 'object',
      required: ['lesson'],
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
        lesson: { type: 'string', description: 'Lesson or correction text to append' },
      },
    },
  },
  {
    name: 'danteforge_workflow',
    description: 'Get the current workflow stage and pipeline status',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (defaults to process.cwd())' },
      },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];

// ── Tool handler map ──────────────────────────────────────────────────────────

export type ToolHandlerMap = {
  [K in ToolName]: (input: Record<string, unknown>, deps: McpServerDeps) => Promise<string>;
};

function resolveCwd(input: Record<string, unknown>): string {
  return (typeof input.cwd === 'string' && input.cwd.length > 0)
    ? input.cwd
    : process.cwd();
}

export const TOOL_HANDLERS: ToolHandlerMap = {
  danteforge_assess: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._assess ?? ((opts) => assess(opts as Parameters<typeof assess>[0]));
    const result = await fn({ cwd, json: input.json ?? false });
    return JSON.stringify(result, null, 2);
  },

  danteforge_forge: async (input, deps) => {
    const cwd = resolveCwd(input);
    const phase = typeof input.phase === 'string' ? input.phase : '1';
    const fn = deps._forge ?? ((opts) => forge(phase, opts as Parameters<typeof forge>[1]));
    const result = await fn({ cwd, phase, prompt: input.prompt ?? false, light: input.light ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_verify: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._verify ?? ((opts) => verify(opts as Parameters<typeof verify>[0]));
    const result = await fn({ cwd, release: input.release ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_autoforge: async (input, deps) => {
    const cwd = resolveCwd(input);
    const goal = typeof input.goal === 'string' ? input.goal : undefined;
    const fn = deps._autoforge ?? ((g, opts) => autoforge(g, opts as Parameters<typeof autoforge>[1]));
    const result = await fn(goal, { cwd, maxWaves: (input.waves as number | undefined) ?? 3, dryRun: input.dryRun ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_plan: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._plan ?? ((opts) => plan(opts as Parameters<typeof plan>[0]));
    const result = await fn({ cwd, prompt: input.prompt ?? false, light: input.light ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_tasks: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._tasks ?? ((opts) => tasks(opts as Parameters<typeof tasks>[0]));
    const result = await fn({ cwd, prompt: input.prompt ?? false, light: input.light ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_synthesize: async (_input, deps) => {
    const fn = deps._synthesize ?? (() => synthesize());
    const result = await fn();
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_retro: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._retro ?? ((opts) => retro(opts as Parameters<typeof retro>[0]));
    const result = await fn({ cwd, summary: input.summary ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_maturity: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._maturity ?? ((opts) => maturity(opts as Parameters<typeof maturity>[0]));
    const result = await fn({ cwd, json: input.json ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_specify: async (input, deps) => {
    const cwd = resolveCwd(input);
    const idea = typeof input.idea === 'string' ? input.idea : '';
    const fn = deps._specify ?? ((i, opts) => specify(i, opts as Parameters<typeof specify>[1]));
    const result = await fn(idea, { cwd, prompt: input.prompt ?? false });
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_constitution: async (_input, deps) => {
    const fn = deps._constitution ?? (() => constitution());
    const result = await fn({});
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_state_read: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._loadState ?? ((opts) => loadState(opts as Parameters<typeof loadState>[0]));
    const state = await fn({ cwd });
    return JSON.stringify(state, null, 2);
  },

  danteforge_masterplan: async (input, deps) => {
    const cwd = resolveCwd(input);
    if (deps._generateMasterplan) {
      const result = await deps._generateMasterplan({ cwd });
      return JSON.stringify(result, null, 2);
    }
    // generateMasterplan requires a prior assessment; run assess first
    const assessFn = deps._assess ?? ((opts) => assess(opts as Parameters<typeof assess>[0]));
    const assessResult = await assessFn({ cwd }) as import('../cli/commands/assess.js').AssessResult;
    const result = await generateMasterplan({
      assessment: assessResult.assessment,
      comparison: assessResult.comparison,
      cwd,
    });
    return JSON.stringify(result, null, 2);
  },

  danteforge_competitors: async (input, deps) => {
    const cwd = resolveCwd(input);
    if (deps._scanCompetitors) {
      const result = await deps._scanCompetitors({ cwd });
      return JSON.stringify(result, null, 2);
    }
    // scanCompetitors requires ourScores; run assess first to get them
    const assessFn = deps._assess ?? ((opts) => assess(opts as Parameters<typeof assess>[0]));
    const assessResult = await assessFn({ cwd }) as import('../cli/commands/assess.js').AssessResult;
    const result = assessResult.comparison;
    return JSON.stringify(result ?? { ok: true }, null, 2);
  },

  danteforge_lessons_add: async (input, deps) => {
    const cwd = resolveCwd(input);
    const lesson = typeof input.lesson === 'string' ? input.lesson : '';
    const fn = deps._appendLesson ?? appendLesson;
    await fn(lesson, { cwd } as Record<string, unknown>);
    return JSON.stringify({ ok: true, lesson });
  },

  danteforge_workflow: async (input, deps) => {
    const cwd = resolveCwd(input);
    const fn = deps._workflow ?? ((opts) => loadState(opts as Parameters<typeof loadState>[0]));
    const state = await fn({ cwd }) as import('./state.js').DanteState;
    return JSON.stringify({
      workflowStage: state.workflowStage,
      currentPhase: state.currentPhase,
      lastHandoff: state.lastHandoff,
      lastVerifyStatus: state.lastVerifyStatus,
    }, null, 2);
  },
};

// ── Manual stdio JSON-RPC 2.0 server (SDK-free fallback) ────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function sendResponse(res: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(res) + '\n');
}

async function handleJsonRpcRequest(
  req: JsonRpcRequest,
  deps: McpServerDeps,
): Promise<JsonRpcResponse> {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'danteforge', version: '0.10.0' },
        capabilities: { tools: {} },
      },
    };
  }

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: req.id,
      result: { tools: TOOL_DEFINITIONS },
    };
  }

  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const toolName = params.name as string;
    const toolInput = (params.arguments ?? {}) as Record<string, unknown>;

    const handler = TOOL_HANDLERS[toolName as ToolName];
    if (!handler) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      };
    }

    try {
      const text = await handler(toolInput, deps);
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text }] },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: { content: [{ type: 'text', text: `Error: ${message}` }], isError: true },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id: req.id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  };
}

export interface ManualMcpServer {
  handleRequest(line: string, deps: McpServerDeps): Promise<JsonRpcResponse>;
}

export function createMcpServer(_deps?: McpServerDeps): ManualMcpServer {
  return {
    async handleRequest(line: string, deps: McpServerDeps): Promise<JsonRpcResponse> {
      const trimmed = line.trim();
      if (!trimmed) {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      }
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      }
      return handleJsonRpcRequest(req, deps);
    },
  };
}

/**
 * Start the MCP server using a manual stdio JSON-RPC 2.0 transport.
 *
 * Tries to use @modelcontextprotocol/sdk if available; falls back to the
 * built-in manual implementation so the server always works.
 */
export async function startMcpServer(deps: McpServerDeps = {}): Promise<void> {
  // Try SDK path first
  try {
    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js' as string);
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js' as string);
    const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
      '@modelcontextprotocol/sdk/types.js' as string
    );

    const server = new Server(
      { name: 'danteforge', version: '0.10.0' },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOL_DEFINITIONS,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request: {
      params: { name: string; arguments?: Record<string, unknown> };
    }) => {
      const { name, arguments: args = {} } = request.params;
      const handler = TOOL_HANDLERS[name as ToolName];
      if (!handler) {
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
      try {
        const text = await handler(args, deps);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
      }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  } catch {
    // SDK not available — fall through to manual implementation
  }

  // Manual stdio JSON-RPC 2.0 implementation
  process.stdin.setEncoding('utf-8');
  let buffer = '';

  process.stdin.on('data', async (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        sendResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }

      const response = await handleJsonRpcRequest(req, deps);
      sendResponse(response);
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  // Keep alive
  await new Promise<void>(() => {});
}
