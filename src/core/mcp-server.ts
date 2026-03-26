// MCP Tool Server — exposes DanteForge as an MCP tool server for Claude Code, Codex, or any MCP client.
// Uses @modelcontextprotocol/sdk stdio transport. All read-only tools are safe; mutating tools require confirm: true.

import fs from 'fs/promises';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { loadState, saveState } from './state.js';
import type { DanteState, WorkflowStage } from './state.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type ToolResult = CallToolResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_DIR = '.danteforge';

/** Resolve working directory — allows _cwd injection for testing */
export function resolveCwd(args: Record<string, unknown>): string {
  return typeof args._cwd === 'string' ? args._cwd : process.cwd();
}

export function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

async function auditLog(entry: string, cwd?: string): Promise<void> {
  try {
    const state = await loadState({ cwd });
    state.auditLog.push(`${new Date().toISOString()} | mcp: ${entry}`);
    await saveState(state, { cwd });
  } catch {
    // Best-effort — never block main path
  }
}

async function readStateFile(filename: string, cwd?: string): Promise<string> {
  const filePath = path.join(cwd ?? process.cwd(), STATE_DIR, filename);
  return fs.readFile(filePath, 'utf8');
}

// ---------------------------------------------------------------------------
// Tool definitions (15 tools)
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'danteforge_state',
    description: 'Read current DanteForge project state (workflow stage, phase, project name, configuration).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_score',
    description: 'Get PDSE quality score for a specific artifact (CONSTITUTION, SPEC, CLARIFY, PLAN, TASKS).',
    inputSchema: {
      type: 'object',
      properties: {
        artifact: {
          type: 'string',
          description: 'Artifact name to score (e.g. CONSTITUTION, SPEC, CLARIFY, PLAN, TASKS)',
        },
      },
      required: ['artifact'],
    },
  },
  {
    name: 'danteforge_score_all',
    description: 'Get PDSE quality scores for all artifacts on disk.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_gate_check',
    description: 'Check whether a specific gate passes (requireConstitution, requireSpec, requireClarify, requirePlan, requireTests, requireDesign).',
    inputSchema: {
      type: 'object',
      properties: {
        gate: {
          type: 'string',
          description: 'Gate name: requireConstitution, requireSpec, requireClarify, requirePlan, requireTests, or requireDesign',
        },
      },
      required: ['gate'],
    },
  },
  {
    name: 'danteforge_next_steps',
    description: 'Get recommended next workflow steps based on current project state and the workflow graph.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_task_list',
    description: 'List tasks for the current execution phase.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_artifact_read',
    description: 'Read a specific artifact file from .danteforge/ directory.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Filename to read from .danteforge/ (e.g. SPEC.md, PLAN.md, CONSTITUTION.md, TASKS.md)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'danteforge_lessons',
    description: 'Read accumulated lessons from .danteforge/lessons.md (corrections, failures, insights).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_memory_query',
    description: 'Search the persistent memory engine for past decisions, corrections, and insights.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for memory entries',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'danteforge_verify',
    description: 'Run project verification (artifact checks, release checks, drift detection). Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to execute verification',
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'danteforge_handoff',
    description: 'Trigger a workflow handoff to advance the pipeline to the next stage. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          description: 'Source stage for the handoff (constitution, spec, forge, party, review, ux-refine, design)',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to execute the handoff',
        },
      },
      required: ['stage', 'confirm'],
    },
  },
  {
    name: 'danteforge_budget_status',
    description: 'Check the latest token cost/budget report from .danteforge/reports/.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_complexity',
    description: 'Assess task complexity for the current phase and get routing/preset recommendations.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'danteforge_route_task',
    description: 'Get routing recommendation (local/light/heavy tier) for a named task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskName: {
          type: 'string',
          description: 'Name of the task to route',
        },
      },
      required: ['taskName'],
    },
  },
  {
    name: 'danteforge_audit_log',
    description: 'Read recent entries from the project audit log.',
    inputSchema: {
      type: 'object',
      properties: {
        count: {
          type: 'number',
          description: 'Number of recent entries to return (default: 20)',
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleState(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const state = await loadState({ cwd });
  await auditLog('state read', cwd);
  return jsonResult({
    project: state.project,
    workflowStage: state.workflowStage,
    currentPhase: state.currentPhase,
    lastHandoff: state.lastHandoff,
    profile: state.profile,
    tddEnabled: state.tddEnabled ?? false,
    lightMode: state.lightMode ?? false,
    autoforgeEnabled: state.autoforgeEnabled ?? false,
    memoryEnabled: state.memoryEnabled ?? false,
    reflectionEnabled: state.reflectionEnabled ?? false,
    designEnabled: state.designEnabled ?? false,
    premiumTier: state.premiumTier ?? 'free',
  });
}

async function handleScore(args: Record<string, unknown>): Promise<ToolResult> {
  const artifactName = String(args['artifact'] ?? '');
  if (!artifactName) {
    return errorResult('Missing required parameter: artifact');
  }

  const cwd = resolveCwd(args);
  const state = await loadState({ cwd });
  const stateDir = path.join(cwd, STATE_DIR);
  const artifactPath = path.join(stateDir, artifactName.includes('.') ? artifactName : `${artifactName}.md`);

  let content: string;
  try {
    content = await fs.readFile(artifactPath, 'utf8');
  } catch {
    return errorResult(`Artifact not found: ${artifactName}`);
  }

  try {
    const pdse = await import('./pdse.js');
    const result = pdse.scoreArtifact({
      artifactContent: content,
      artifactName: artifactName.replace(/\.md$/, '').toUpperCase() as import('./pdse-config.js').ScoredArtifact,
      stateYaml: state,
      upstreamArtifacts: {},
      isWebProject: state.projectType === 'web',
    });
    await auditLog(`score: ${artifactName} = ${result.score}`, cwd);
    return jsonResult(result);
  } catch (err) {
    return errorResult(`PDSE scoring failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleScoreAll(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const cwd = resolveCwd(args);
    const state = await loadState({ cwd });
    const pdse = await import('./pdse.js');
    const results = await pdse.scoreAllArtifacts(cwd, state);
    await auditLog('score_all', cwd);
    return jsonResult(results);
  } catch (err) {
    return errorResult(`PDSE score-all failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleGateCheck(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const gateName = String(args['gate'] ?? '');
  if (!gateName) {
    return errorResult('Missing required parameter: gate');
  }

  const validGates = [
    'requireConstitution',
    'requireSpec',
    'requireClarify',
    'requirePlan',
    'requireTests',
    'requireDesign',
  ];

  if (!validGates.includes(gateName)) {
    return errorResult(`Unknown gate: ${gateName}. Valid gates: ${validGates.join(', ')}`);
  }

  try {
    const gates = await import('./gates.js');
    const gateFn = gates[gateName as keyof typeof gates] as (light?: boolean, cwd?: string) => Promise<void>;
    await gateFn(false, cwd);
    await auditLog(`gate_check: ${gateName} = PASS`, cwd);
    return jsonResult({ gate: gateName, status: 'PASS', message: 'Gate passed successfully' });
  } catch (err) {
    const isGateError = err instanceof Error && err.constructor.name === 'GateError';
    const gateErr = err as { gate?: string; remedy?: string; message?: string };
    await auditLog(`gate_check: ${gateName} = FAIL`, cwd);
    return jsonResult({
      gate: gateName,
      status: 'FAIL',
      message: isGateError ? gateErr.message : (err instanceof Error ? err.message : String(err)),
      remedy: isGateError ? gateErr.remedy : undefined,
    });
  }
}

async function handleNextSteps(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const state = await loadState({ cwd });

  try {
    const { getNextSteps, getWorkflowGraph } = await import('./workflow-enforcer.js');
    const nextStages = getNextSteps(state.workflowStage);
    const graph = getWorkflowGraph();

    const suggestions = nextStages.map((stage: WorkflowStage) => {
      const transition = graph.find((t: { to: WorkflowStage }) => t.to === stage);
      return {
        stage,
        command: `danteforge ${stage}`,
        requiredArtifacts: transition?.artifacts ?? [],
        gates: transition?.gates.map((g: { name: string }) => g.name) ?? [],
      };
    });

    await auditLog('next_steps', cwd);
    return jsonResult({
      currentStage: state.workflowStage,
      currentPhase: state.currentPhase,
      project: state.project,
      nextSteps: suggestions,
      pipelineOrder: [
        'initialized', 'review', 'constitution', 'specify', 'clarify',
        'plan', 'tasks', 'design', 'forge', 'ux-refine', 'verify', 'synthesize',
      ],
    });
  } catch (err) {
    return errorResult(`Failed to compute next steps: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleTaskList(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const state = await loadState({ cwd });
  const phase = state.currentPhase;
  const tasks = state.tasks[phase] ?? [];
  await auditLog(`task_list: phase=${phase}, count=${tasks.length}`, cwd);
  return jsonResult({
    currentPhase: phase,
    taskCount: tasks.length,
    tasks: tasks.map((t, i) => ({
      index: i,
      name: t.name,
      files: t.files ?? [],
      verify: t.verify ?? null,
    })),
  });
}

async function handleArtifactRead(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const name = String(args['name'] ?? '');
  if (!name) {
    return errorResult('Missing required parameter: name');
  }

  // Prevent path traversal
  const sanitized = path.basename(name);
  try {
    const content = await readStateFile(sanitized, cwd);
    await auditLog(`artifact_read: ${sanitized}`, cwd);
    return jsonResult({ name: sanitized, content });
  } catch {
    return errorResult(`Artifact not found: ${sanitized}`);
  }
}

async function handleLessons(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const content = await readStateFile('lessons.md', cwd);
    await auditLog('lessons read', cwd);
    return jsonResult({ content });
  } catch {
    return jsonResult({ content: '', message: 'No lessons.md found — no lessons recorded yet.' });
  }
}

async function handleMemoryQuery(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const query = String(args['query'] ?? '');
  if (!query) {
    return errorResult('Missing required parameter: query');
  }

  try {
    const memEngine = await import('./memory-engine.js');
    const results = await memEngine.searchMemory(query, undefined, cwd);
    await auditLog(`memory_query: "${query}" (${results.length} results)`, cwd);
    return jsonResult({
      query,
      resultCount: results.length,
      results: results.map(entry => ({
        id: entry.id,
        timestamp: entry.timestamp,
        category: entry.category,
        summary: entry.summary,
        detail: entry.detail,
        tags: entry.tags,
      })),
    });
  } catch (err) {
    return errorResult(`Memory query failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleVerify(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const confirm = args['confirm'] === true;
  if (!confirm) {
    return errorResult('Verification requires confirm: true to execute.');
  }

  try {
    const { verify } = await import('../cli/commands/verify.js');
    await verify();
    await auditLog('verify: executed via MCP', cwd);
    return jsonResult({ status: 'completed', message: 'Verification completed. Check console output for details.' });
  } catch (err) {
    await auditLog(`verify: failed — ${err instanceof Error ? err.message : String(err)}`, cwd);
    return errorResult(`Verification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleHandoff(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const stage = String(args['stage'] ?? '');
  const confirm = args['confirm'] === true;

  if (!confirm) {
    return errorResult('Handoff requires confirm: true to execute.');
  }

  if (!stage) {
    return errorResult('Missing required parameter: stage');
  }

  const validStages = ['constitution', 'spec', 'forge', 'party', 'review', 'ux-refine', 'design'];
  if (!validStages.includes(stage)) {
    return errorResult(`Invalid stage: ${stage}. Valid stages: ${validStages.join(', ')}`);
  }

  try {
    const { handoff } = await import('./handoff.js');
    await handoff(
      stage as 'constitution' | 'spec' | 'forge' | 'party' | 'review' | 'ux-refine' | 'design',
      {},
      { cwd },
    );
    await auditLog(`handoff: ${stage} via MCP`, cwd);
    const updatedState = await loadState({ cwd });
    return jsonResult({
      status: 'completed',
      previousStage: stage,
      newWorkflowStage: updatedState.workflowStage,
      lastHandoff: updatedState.lastHandoff,
    });
  } catch (err) {
    await auditLog(`handoff: ${stage} failed — ${err instanceof Error ? err.message : String(err)}`, cwd);
    return errorResult(`Handoff failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleBudgetStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const reportsDir = path.join(cwd, STATE_DIR, 'reports');

  try {
    const entries = await fs.readdir(reportsDir);
    const costFiles = entries
      .filter(e => e.startsWith('cost-') && e.endsWith('.json'))
      .sort();

    if (costFiles.length === 0) {
      return jsonResult({ message: 'No cost reports found.', reports: [] });
    }

    // Read the latest report
    const latestFile = costFiles[costFiles.length - 1];
    const latestPath = path.join(reportsDir, latestFile);
    const raw = await fs.readFile(latestPath, 'utf8');
    const report = JSON.parse(raw) as Record<string, unknown>;

    await auditLog(`budget_status: read ${latestFile}`, cwd);
    return jsonResult({
      latestReport: latestFile,
      totalReports: costFiles.length,
      data: report,
    });
  } catch {
    return jsonResult({ message: 'No cost reports directory found.', reports: [] });
  }
}

async function handleComplexity(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const state = await loadState({ cwd });
    const phase = state.currentPhase;
    const tasks = state.tasks[phase] ?? [];

    if (tasks.length === 0) {
      return jsonResult({
        message: `No tasks found for current phase ${phase}.`,
        assessment: null,
      });
    }

    const { assessComplexity } = await import('./complexity-classifier.js');
    const assessment = assessComplexity(tasks, state);
    await auditLog(`complexity: score=${assessment.score}, preset=${assessment.recommendedPreset}`, cwd);
    return jsonResult(assessment);
  } catch (err) {
    return errorResult(`Complexity assessment failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleRouteTask(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const taskName = String(args['taskName'] ?? '');
  if (!taskName) {
    return errorResult('Missing required parameter: taskName');
  }

  try {
    const state = await loadState({ cwd });
    const { classifyTaskSignature, routeTask } = await import('./task-router.js');

    const taskObj = { name: taskName, files: [] as string[], verify: '' };
    const signature = classifyTaskSignature(taskObj, state);
    const decision = routeTask(signature);

    await auditLog(`route_task: "${taskName}" -> ${decision.tier}`, cwd);
    return jsonResult({
      taskName,
      signature,
      routing: decision,
    });
  } catch (err) {
    return errorResult(`Task routing failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleAuditLog(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const count = typeof args['count'] === 'number' ? args['count'] : 20;
  const safeCount = Math.max(1, Math.min(count, 500));

  const state = await loadState({ cwd });
  const total = state.auditLog.length;
  const entries = state.auditLog.slice(-safeCount);

  await auditLog('audit_log read', cwd);
  return jsonResult({
    total,
    returned: entries.length,
    entries,
  });
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  danteforge_state: (args) => handleState(args),
  danteforge_score: (args) => handleScore(args),
  danteforge_score_all: (args) => handleScoreAll(args),
  danteforge_gate_check: (args) => handleGateCheck(args),
  danteforge_next_steps: (args) => handleNextSteps(args),
  danteforge_task_list: (args) => handleTaskList(args),
  danteforge_artifact_read: (args) => handleArtifactRead(args),
  danteforge_lessons: (args) => handleLessons(args),
  danteforge_memory_query: (args) => handleMemoryQuery(args),
  danteforge_verify: (args) => handleVerify(args),
  danteforge_handoff: (args) => handleHandoff(args),
  danteforge_budget_status: (args) => handleBudgetStatus(args),
  danteforge_complexity: (args) => handleComplexity(args),
  danteforge_route_task: (args) => handleRouteTask(args),
  danteforge_audit_log: (args) => handleAuditLog(args),
};

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function createAndStartMCPServer(): Promise<void> {
  const server = new Server(
    { name: 'danteforge', version: '0.9.2' },
    { capabilities: { tools: {} } },
  );

  // Register list-tools handler
  server.setRequestHandler(ListToolsRequestSchema, async (_request, _extra) => {
    return { tools: TOOL_DEFINITIONS };
  });

  // Register call-tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request, _extra) => {
    const { name, arguments: toolArgs } = request.params;
    const args = (toolArgs ?? {}) as Record<string, unknown>;

    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return errorResult(`Unknown tool: ${name}`);
    }

    try {
      return await handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await auditLog(`tool error: ${name} — ${message}`);
      } catch {
        // Best-effort audit logging
      }
      return errorResult(`Tool '${name}' failed: ${message}`);
    }
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
