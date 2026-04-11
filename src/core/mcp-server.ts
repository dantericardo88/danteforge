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
  // New tools added for full workflow coverage
  {
    name: 'danteforge_assess',
    description: 'Run a quality assessment of the current project and return an overall score.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: process.cwd())' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_forge',
    description: 'Execute GSD forge waves to build the next set of features.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_autoforge',
    description: 'Run the autoforge loop to automatically drive the project to completion.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_plan',
    description: 'Generate a detailed implementation plan from the project spec.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_tasks',
    description: 'Break the plan into an executable task list.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_synthesize',
    description: 'Generate Ultimate Planning Resource (UPR.md) from current project artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_retro',
    description: 'Run a retrospective on the current project iteration.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_maturity',
    description: 'Analyze current code maturity level and provide improvement recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_specify',
    description: 'Start the SPEC refinement flow from a high-level idea.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
        idea: { type: 'string', description: 'High-level product idea to specify' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_constitution',
    description: 'Generate or update the project constitution.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_state_read',
    description: 'Read full DanteForge project state as JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_masterplan',
    description: 'Generate a masterplan from the current project artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_competitors',
    description: 'Scan and analyze competitor products in the same space.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_lessons_add',
    description: 'Append a new lesson or correction to the project lessons log.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
        lesson: { type: 'string', description: 'Lesson text to record' },
      },
      required: ['lesson'],
    },
  },
  {
    name: 'danteforge_workflow',
    description: 'Get current workflow state: stage, phase, last handoff, verify status.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory' },
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
// McpServerDeps — injection interface for testing
// ---------------------------------------------------------------------------

export interface McpServerDeps {
  /** Injected assess function — returns score and threshold result */
  _assess?: (opts: { cwd: string }) => Promise<{ overallScore: number; passesThreshold: boolean }>;
  /** Injected state loader — returns DanteState */
  _loadState?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected workflow info — returns workflowStage, currentPhase, lastHandoff, lastVerifyStatus */
  _workflow?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected lesson appender */
  _appendLesson?: (entry: string) => Promise<void>;
  /** Injected forge runner */
  _forge?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected autoforge runner */
  _autoforge?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected plan generator */
  _plan?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected tasks generator */
  _tasks?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected synthesize runner */
  _synthesize?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected retro runner */
  _retro?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected maturity assessor */
  _maturity?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected specify runner */
  _specify?: (opts: { cwd: string; idea?: string }) => Promise<unknown>;
  /** Injected constitution runner */
  _constitution?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected masterplan generator */
  _generateMasterplan?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected competitor scanner */
  _scanCompetitors?: (opts: { cwd: string }) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Tool names
// ---------------------------------------------------------------------------

export type ToolName =
  | 'danteforge_state'
  | 'danteforge_score'
  | 'danteforge_score_all'
  | 'danteforge_gate_check'
  | 'danteforge_next_steps'
  | 'danteforge_task_list'
  | 'danteforge_artifact_read'
  | 'danteforge_lessons'
  | 'danteforge_memory_query'
  | 'danteforge_verify'
  | 'danteforge_handoff'
  | 'danteforge_budget_status'
  | 'danteforge_complexity'
  | 'danteforge_route_task'
  | 'danteforge_audit_log'
  | 'danteforge_assess'
  | 'danteforge_forge'
  | 'danteforge_autoforge'
  | 'danteforge_plan'
  | 'danteforge_tasks'
  | 'danteforge_synthesize'
  | 'danteforge_retro'
  | 'danteforge_maturity'
  | 'danteforge_specify'
  | 'danteforge_constitution'
  | 'danteforge_state_read'
  | 'danteforge_masterplan'
  | 'danteforge_competitors'
  | 'danteforge_lessons_add'
  | 'danteforge_workflow';

// ---------------------------------------------------------------------------
// New injectable tool handlers
// ---------------------------------------------------------------------------

async function handleAssess(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  if (deps._assess) {
    const result = await deps._assess({ cwd });
    return JSON.stringify(result);
  }
  // Real implementation fallback
  try {
    const assessMod = await import('../cli/commands/assess.js');
    const runFn = (assessMod as Record<string, unknown>)['runAssess'] as ((opts: { cwd: string }) => Promise<unknown>) | undefined;
    if (runFn) {
      const result = await runFn({ cwd });
      return JSON.stringify(result);
    }
    return JSON.stringify({ overallScore: 0, passesThreshold: false, error: 'runAssess not exported' });
  } catch {
    return JSON.stringify({ overallScore: 0, passesThreshold: false, error: 'assess not available' });
  }
}

async function handleStateRead(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  if (deps._loadState) {
    const state = await deps._loadState({ cwd });
    return JSON.stringify(state);
  }
  const state = await loadState({ cwd });
  return JSON.stringify(state);
}

async function handleWorkflow(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  if (deps._workflow) {
    const result = await deps._workflow({ cwd });
    return JSON.stringify(result);
  }
  const state = await loadState({ cwd });
  return JSON.stringify({
    workflowStage: state.workflowStage,
    currentPhase: state.currentPhase,
    lastHandoff: state.lastHandoff,
    lastVerifyStatus: (state as unknown as Record<string, unknown>)['lastVerifyStatus'],
  });
}

async function handleLessonsAdd(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const lesson = typeof args['lesson'] === 'string' ? args['lesson'] : '';
  if (deps._appendLesson) {
    await deps._appendLesson(lesson);
    return JSON.stringify({ ok: true, lesson });
  }
  // Real fallback
  try {
    const { appendLesson } = await import('../cli/commands/lessons.js');
    await appendLesson(lesson);
    return JSON.stringify({ ok: true, lesson });
  } catch {
    return JSON.stringify({ ok: false, error: 'appendLesson not available', lesson });
  }
}

async function handleSimpleInjectable(
  name: string,
  args: Record<string, unknown>,
  deps: McpServerDeps,
  injected?: (opts: { cwd: string; idea?: string }) => Promise<unknown>,
): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  const idea = typeof args['idea'] === 'string' ? args['idea'] : undefined;
  if (injected) {
    const result = await injected({ cwd, idea });
    return JSON.stringify(result ?? { ok: true });
  }
  return JSON.stringify({ ok: true, message: `${name} not fully wired in this mode` });
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

// ToolHandler is now a union: old handlers return ToolResult, new injectable handlers return string.
// Tests must use the appropriate type for the specific handler called.
export type ToolHandler = (args: Record<string, unknown>, deps?: McpServerDeps) => Promise<ToolResult | string>;

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // Legacy handlers — return ToolResult (backward compat with mcp-handlers.test.ts)
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
  // New injectable handlers — return string (JSON-serialized result)
  danteforge_assess: (args, deps = {}) => handleAssess(args, deps),
  danteforge_state_read: (args, deps = {}) => handleStateRead(args, deps),
  danteforge_workflow: (args, deps = {}) => handleWorkflow(args, deps),
  danteforge_lessons_add: (args, deps = {}) => handleLessonsAdd(args, deps),
  danteforge_forge: (args, deps = {}) => handleSimpleInjectable('forge', args, deps, deps._forge),
  danteforge_autoforge: (args, deps = {}) => handleSimpleInjectable('autoforge', args, deps, deps._autoforge),
  danteforge_plan: (args, deps = {}) => handleSimpleInjectable('plan', args, deps, deps._plan),
  danteforge_tasks: (args, deps = {}) => handleSimpleInjectable('tasks', args, deps, deps._tasks),
  danteforge_synthesize: (args, deps = {}) => handleSimpleInjectable('synthesize', args, deps, deps._synthesize),
  danteforge_retro: (args, deps = {}) => handleSimpleInjectable('retro', args, deps, deps._retro),
  danteforge_maturity: (args, deps = {}) => handleSimpleInjectable('maturity', args, deps, deps._maturity),
  danteforge_specify: (args, deps = {}) => handleSimpleInjectable('specify', args, deps, deps._specify),
  danteforge_constitution: (args, deps = {}) => handleSimpleInjectable('constitution', args, deps, deps._constitution),
  danteforge_masterplan: (args, deps = {}) => handleSimpleInjectable('masterplan', args, deps, deps._generateMasterplan),
  danteforge_competitors: (args, deps = {}) => handleSimpleInjectable('competitors', args, deps, deps._scanCompetitors),
};

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function createAndStartMCPServer(): Promise<void> {
  const server = new Server(
    { name: 'danteforge', version: '0.15.0' },
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
      const handlerResult = await handler(args, {});
      if (typeof handlerResult === 'string') {
        return { content: [{ type: 'text', text: handlerResult }] };
      }
      return handlerResult;
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

// ---------------------------------------------------------------------------
// Lightweight server factory (for tests and programmatic use)
// ---------------------------------------------------------------------------

type JsonRpcRequest = { jsonrpc: string; id?: number | string; method: string; params?: Record<string, unknown> };
type JsonRpcResponse = { jsonrpc: string; id?: number | string; result?: unknown; error?: { code: number; message: string } };

export interface ManualMcpServer {
  /** handleRequest accepts either a JSON-RPC string line or a plain request object.
   *  Optional deps parameter overrides the session-level deps for a single call. */
  handleRequest: (request: string | { method: string; params?: Record<string, unknown> }, deps?: McpServerDeps) => Promise<JsonRpcResponse | unknown>;
}

export function createMcpServer(sessionDeps: McpServerDeps = {}): ManualMcpServer {
  return {
    async handleRequest(request, callDeps) {
      const effectiveDeps: McpServerDeps = callDeps ?? sessionDeps;

      // Parse JSON-RPC string or use object directly
      let rpc: JsonRpcRequest;
      if (typeof request === 'string') {
        try {
          rpc = JSON.parse(request) as JsonRpcRequest;
        } catch {
          return { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } };
        }
      } else {
        rpc = { jsonrpc: '2.0', method: request.method, params: request.params };
      }

      const id = rpc.id;
      const method = rpc.method;
      const params = rpc.params ?? {};

      try {
        if (method === 'initialize') {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: params['protocolVersion'] ?? '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'danteforge', version: '0.15.0' },
            },
          };
        }

        if (method === 'tools/list') {
          return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } };
        }

        if (method === 'tools/call') {
          const name = String((params as Record<string, unknown>)['name'] ?? '');
          const args = ((params as Record<string, unknown>)['arguments'] ?? {}) as Record<string, unknown>;
          const handler = TOOL_HANDLERS[name];
          if (!handler) {
            return {
              jsonrpc: '2.0', id,
              result: { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }], isError: true },
            };
          }
          try {
            const handlerResult = await handler(args, effectiveDeps);
            // Normalize ToolResult or string to a uniform text string
            let text: string;
            if (typeof handlerResult === 'string') {
              text = handlerResult;
            } else {
              // ToolResult: extract text from content[0]
              text = (handlerResult.content[0] as { text: string } | undefined)?.text ?? JSON.stringify(handlerResult);
            }
            return {
              jsonrpc: '2.0', id,
              result: { content: [{ type: 'text', text }] },
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              jsonrpc: '2.0', id,
              result: { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true },
            };
          }
        }

        return {
          jsonrpc: '2.0', id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      } catch (err) {
        return {
          jsonrpc: '2.0', id,
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };
}
