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
import { getMcpRateLimiter, type RateLimiter } from './rate-limiter.js';
import { getEconomizedArtifactForContext } from './context-economy/runtime.js';
import type { ArtifactType } from './context-economy/artifact-compressor.js';

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

function artifactTypeForMcpRead(filename: string): ArtifactType {
  if (/^(SPEC|PLAN|TASKS|CLARIFY|CONSTITUTION)\.md$/i.test(filename)) return 'prd-spec-plan';
  if (/^(CURRENT_STATE|UPR)\.md$/i.test(filename)) return 'upr-current-state';
  if (/verify|receipt/i.test(filename)) return 'verify-output';
  if (/score|quality/i.test(filename)) return 'score-report';
  return 'audit-log';
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
  {
    name: 'danteforge_adoption_queue',
    description: 'Read the current OSS adoption queue showing patterns ready to implement. Returns the ADOPTION_QUEUE.md content.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
    },
  },
  {
    name: 'danteforge_quality_certificate',
    description: 'Generate a tamper-evident quality certificate (evidenceFingerprint) from current convergence state.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
    },
  },
  {
    name: 'danteforge_pattern_coverage',
    description: 'Show which spec requirements have OSS pattern coverage. Reads PATTERN_COVERAGE.md if present.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
    },
  },
  {
    name: 'danteforge_harvest_next_pattern',
    description: 'Adopt the highest-priority pattern from ADOPTION_QUEUE.md. Requires human approval (policy: confirm) — writes files and may run tests.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
        dryRun: { type: 'boolean', description: 'If true, show what would be adopted without executing (default: true for safety)' },
      },
    },
  },
  {
    name: 'danteforge_explain_score',
    description: 'Explain a maturity score dimension — what it measures, why it matters, and what would improve it.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', description: 'Score dimension name (e.g. "circuit-breaker-reliability")' },
        score: { type: 'number', description: 'Current score 0-10 (optional — loads from state if omitted)' },
        cwd: { type: 'string', description: 'Project directory (default: current)' },
      },
      required: ['dimension'],
    },
  },
  {
    name: 'danteforge_leapfrog_opportunities',
    description: 'List competitive leapfrog opportunities — dimensions where OSS patterns can jump this project ahead of named competitors.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory (default: current)' },
        maxOpportunities: { type: 'number', description: 'Maximum opportunities to return (default: 5)' },
      },
    },
  },
  {
    name: 'danteforge_pattern_search',
    description: 'Search the global OSS pattern library by keyword, category, or complexity. Returns patterns ranked by ROI.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search term matched against pattern name and description' },
        category: { type: 'string', description: 'Filter by category (e.g. "reliability", "performance")' },
        maxComplexity: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Maximum adoption complexity' },
        minAvgRoi: { type: 'number', description: 'Minimum average ROI 0-1 (default: 0)' },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
      },
    },
  },
  {
    name: 'danteforge_adversarial_score',
    description: 'Challenge the self-score with an independent adversary LLM. Returns a divergence panel showing selfScore vs adversarialScore, verdict (trusted/watch/inflated/underestimated), and the most inflated dimensions. Use this to catch score inflation before declaring a feature complete.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Working directory (defaults to process.cwd())' },
        summaryOnly: { type: 'boolean', description: 'Use a single LLM call for summary score instead of per-dimension (faster, lower cost)' },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific dimensions to score adversarially. Omit to score all dimensions.',
        },
      },
      required: [],
    },
  },
  // ── Dossier system tools ──────────────────────────────────────────────────
  {
    name: 'danteforge_dossier_build',
    description: 'Build or refresh a competitor dossier with source-backed evidence and rubric scores',
    inputSchema: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Competitor id (e.g. "cursor", "aider")' },
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override primary source URLs (optional)',
        },
        since: { type: 'string', description: 'Skip if dossier built within this duration (e.g. "7d")' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: ['competitor'],
    },
  },
  {
    name: 'danteforge_dossier_get',
    description: 'Get a competitor dossier, optionally filtered to a single dimension',
    inputSchema: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Competitor id' },
        dim: { type: 'number', description: 'Dimension number (1–28). Omit for full dossier.' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: ['competitor'],
    },
  },
  {
    name: 'danteforge_dossier_list',
    description: 'List all built competitor dossiers with composite scores',
    inputSchema: {
      type: 'object',
      properties: {
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_landscape_build',
    description: 'Rebuild the full competitive landscape matrix from all dossiers and write COMPETITIVE_LANDSCAPE.md',
    inputSchema: {
      type: 'object',
      properties: {
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_landscape_diff',
    description: 'Show competitive landscape staleness and metadata since last build',
    inputSchema: {
      type: 'object',
      properties: {
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_rubric_get',
    description: 'Get the scoring rubric — all dimensions or a single dimension with criteria',
    inputSchema: {
      type: 'object',
      properties: {
        dim: { type: 'number', description: 'Dimension number (1–28). Omit for full rubric.' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: [],
    },
  },
  {
    name: 'danteforge_score_competitor',
    description: 'Get the composite score and dimension breakdown for a specific competitor',
    inputSchema: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Competitor id' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
      },
      required: ['competitor'],
    },
  },
  // ── COFL tool ──────────────────────────────────────────────────────────────
  {
    name: 'danteforge_cofl',
    description: 'Run a Competitive Operator Forge Loop (COFL) phase. Partitions competitors into direct_peer/specialist_teacher/reference_teacher roles, scores operator leverage for each matrix dimension, checks 7 anti-failure guardrails, and returns a full cycle result with reframe assessment. Use --auto for a complete end-to-end cycle.',
    inputSchema: {
      type: 'object',
      properties: {
        universe: { type: 'boolean', description: 'Run universe+partition phase — classify competitors by role' },
        harvest: { type: 'boolean', description: 'Run harvest phase — extract patterns from OSS teacher set (requires LLM)' },
        prioritize: { type: 'boolean', description: 'Run prioritize phase — rank dimensions by operator leverage score' },
        guards: { type: 'boolean', description: 'Run anti-failure guardrail checks (7 codified failure modes)' },
        reframe: { type: 'boolean', description: 'Run reframe phase — strategic position assessment (inflating rows vs real preference gain)' },
        report: { type: 'boolean', description: 'Write COFL_REPORT.md to .danteforge/cofl/' },
        auto: { type: 'boolean', description: 'Run all phases end-to-end (full 10-phase cycle)' },
        _cwd: { type: 'string', description: 'Working directory override (for testing)' },
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
    const context = await getEconomizedArtifactForContext({
      path: path.join(STATE_DIR, sanitized),
      type: artifactTypeForMcpRead(sanitized),
      cwd,
    });
    await auditLog(`artifact_read: ${sanitized}`, cwd);
    return jsonResult({
      name: sanitized,
      content: context.content,
      contextEconomy: {
        rawHash: context.rawHash,
        originalSize: context.originalSize,
        compressedSize: context.compressedSize,
        savingsPercent: context.savingsPercent,
        sacredSpanCount: context.sacredSpanCount,
      },
    });
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
  /** Injected rate limiter — defaults to the MCP singleton. Override in tests to bypass. */
  _rateLimiter?: RateLimiter | null;
  /** Injected adversarial scorer — for testing danteforge_adversarial_score without LLM */
  _adversarialScore?: (opts: { cwd: string; summaryOnly?: boolean }) => Promise<unknown>;
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
  | 'danteforge_workflow'
  | 'danteforge_adoption_queue'
  | 'danteforge_quality_certificate'
  | 'danteforge_pattern_coverage'
  | 'danteforge_harvest_next_pattern'
  | 'danteforge_explain_score'
  | 'danteforge_leapfrog_opportunities'
  | 'danteforge_pattern_search'
  | 'danteforge_adversarial_score';

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

async function handleAdversarialScore(args: Record<string, unknown>, deps: McpServerDeps): Promise<string> {
  const cwd = typeof args['cwd'] === 'string' ? args['cwd'] : process.cwd();
  const summaryOnly = args['summaryOnly'] === true;
  if (deps._adversarialScore) {
    const result = await deps._adversarialScore({ cwd, summaryOnly });
    return JSON.stringify(result ?? { ok: true });
  }
  try {
    const { generateAdversarialScore } = await import('./adversarial-scorer-dim.js');
    const { computeHarshScore } = await import('./harsh-scorer.js');
    const selfResult = await computeHarshScore({ cwd });
    const result = await generateAdversarialScore(selfResult, { cwd, summaryOnly });
    return JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({
      error: `Adversarial scoring failed: ${err instanceof Error ? err.message : String(err)}`,
    });
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

async function handleAdoptionQueue(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const queuePath = path.join(cwd, '.danteforge', 'ADOPTION_QUEUE.md');
    const content = await fs.readFile(queuePath, 'utf8');
    return jsonResult({ content, path: queuePath });
  } catch {
    return jsonResult({ content: '# Adoption Queue\n\n_(empty — run oss-intel to populate)_', path: null });
  }
}

async function handleQualityCertificate(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const certPath = path.join(cwd, '.danteforge', 'QUALITY_CERTIFICATE.json');
    const content = await fs.readFile(certPath, 'utf8');
    return jsonResult(JSON.parse(content) as unknown);
  } catch {
    return jsonResult({ error: 'No quality certificate found. Run danteforge certify to generate one.' });
  }
}

async function handlePatternCoverage(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const coveragePath = path.join(cwd, '.danteforge', 'PATTERN_COVERAGE.md');
    const content = await fs.readFile(coveragePath, 'utf8');
    return jsonResult({ content, path: coveragePath });
  } catch {
    return jsonResult({ content: '# Pattern Coverage\n\n_(not yet generated — run danteforge spec-match to compute)_', path: null });
  }
}

async function handleHarvestNextPattern(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  // Safety gate: dryRun=true by default — this tool writes files and must not auto-execute
  const dryRun = args['dryRun'] !== false; // default true unless explicitly set to false

  try {
    const queuePath = path.join(cwd, '.danteforge', 'ADOPTION_QUEUE.md');
    const content = await fs.readFile(queuePath, 'utf8');

    // Extract first pattern name from queue
    const firstPatternMatch = content.match(/^##\s+(.+)$/m);
    const patternName = firstPatternMatch?.[1] ?? 'unknown';

    if (dryRun) {
      return jsonResult({
        dryRun: true,
        nextPattern: patternName,
        message: `Would adopt "${patternName}". Set dryRun=false to execute (requires human approval policy).`,
        policy: 'confirm',
        warning: 'This tool writes files and may run tests. Human approval required.',
      });
    }

    // Non-dry-run: return authorization required message
    // Full adoption requires safe-self-edit approval flow — not auto-executed via MCP
    return jsonResult({
      requiresApproval: true,
      nextPattern: patternName,
      message: `Adopting "${patternName}" requires human approval. Use the CLI: danteforge oss-intel --adopt ${patternName}`,
      policy: 'confirm',
    });
  } catch {
    return jsonResult({ error: 'No adoption queue found. Run oss-intel first.' });
  }
}

async function handleExplainScore(args: Record<string, unknown>): Promise<ToolResult> {
  const dimension = String(args['dimension'] ?? '');
  if (!dimension) return errorResult('Missing required parameter: dimension');

  const cwd = resolveCwd(args);
  const score = typeof args['score'] === 'number' ? args['score'] : null;

  // Load score from state if not provided
  let resolvedScore = score;
  if (resolvedScore === null) {
    try {
      const stateDir = path.join(cwd, '.danteforge');
      const competitorPath = path.join(stateDir, 'COMPETITOR_MATRIX.md');
      const maturityPath = path.join(stateDir, 'MATURITY_REPORT.md');
      for (const p of [maturityPath, competitorPath]) {
        try {
          const content = await fs.readFile(p, 'utf8');
          const match = content.match(new RegExp(`${dimension}[^\\d]*(\\d+\\.?\\d*)\\/10`));
          if (match) { resolvedScore = parseFloat(match[1]); break; }
        } catch { /* keep looking */ }
      }
    } catch { /* best-effort */ }
  }

  const scoreLabel = resolvedScore !== null ? `${resolvedScore}/10` : 'unknown';

  const DIMENSION_EXPLANATIONS: Record<string, { what: string; why: string; howToImprove: string }> = {
    'circuit-breaker-reliability': {
      what: 'Measures whether external calls (LLM, API, DB) are wrapped in circuit breakers that open on repeated failure and recover gracefully.',
      why: 'Without it, one flaky provider cascades into full system downtime. Circuit breakers contain blast radius.',
      howToImprove: 'Add CLOSED/OPEN/HALF_OPEN state machine per provider; wrap callLLM with circuit-breaker check; add backoff strategy.',
    },
    'test-injection-discipline': {
      what: 'Measures whether tests use injected dependencies (_llmCaller, _isLLMAvailable, _readFile etc.) instead of real I/O.',
      why: 'Real I/O in tests causes 200x+ slowdowns, non-determinism, and CI failures. Injection seams are the antidote.',
      howToImprove: 'Add _fnName? optional params to all functions that call LLM or FS; use them in tests via stub injection.',
    },
  };

  const explanation = DIMENSION_EXPLANATIONS[dimension] ?? {
    what: `"${dimension}" measures this dimension of software maturity in your codebase.`,
    why: 'Higher scores on this dimension indicate production-readiness and reduced operational risk.',
    howToImprove: `Review the ${dimension} section in MATURITY_REPORT.md or run: danteforge assess`,
  };

  return jsonResult({
    dimension,
    score: scoreLabel,
    what: explanation.what,
    why: explanation.why,
    howToImprove: explanation.howToImprove,
    nextAction: resolvedScore !== null && resolvedScore < 7
      ? `Run: danteforge oss-intel --focus ${dimension} to find patterns that improve this score`
      : 'Score looks healthy. Run danteforge assess to see full picture.',
  });
}

async function handleLeapfrogOpportunities(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const maxOpportunities = typeof args['maxOpportunities'] === 'number' ? args['maxOpportunities'] : 5;

  try {
    const stateDir = path.join(cwd, '.danteforge');

    // Read competitor matrix and harvest queue to find leapfrog gaps
    let competitorContent = '';
    let queueContent = '';
    try { competitorContent = await fs.readFile(path.join(stateDir, 'COMPETITOR_MATRIX.md'), 'utf8'); } catch {}
    try { queueContent = await fs.readFile(path.join(stateDir, 'ADOPTION_QUEUE.md'), 'utf8'); } catch {}

    // Parse dimensions where we score lower than competitors
    const opportunities: Array<{ dimension: string; ourScore: number; competitorScore: number; gap: number; patternAvailable: boolean }> = [];

    // Extract score comparisons from competitor matrix (format: "| dimension | ourScore | competitorScore |")
    const tableRows = competitorContent.matchAll(/\|\s*([^|]+)\s*\|\s*(\d+\.?\d*)\s*\|\s*(\d+\.?\d*)\s*\|/g);
    for (const row of tableRows) {
      const dimension = row[1].trim();
      const ourScore = parseFloat(row[2]);
      const competitorScore = parseFloat(row[3]);
      if (!isNaN(ourScore) && !isNaN(competitorScore) && competitorScore > ourScore + 1) {
        const patternAvailable = queueContent.toLowerCase().includes(dimension.toLowerCase());
        opportunities.push({ dimension, ourScore, competitorScore, gap: competitorScore - ourScore, patternAvailable });
      }
    }

    // Sort by gap size (biggest opportunity first)
    opportunities.sort((a, b) => b.gap - a.gap);
    const top = opportunities.slice(0, maxOpportunities);

    if (top.length === 0) {
      return jsonResult({
        opportunities: [],
        message: 'No leapfrog opportunities found. Run: danteforge universe-scan to populate competitor data.',
        nextAction: 'danteforge universe-scan',
      });
    }

    return jsonResult({
      opportunities: top.map(o => ({
        dimension: o.dimension,
        ourScore: o.ourScore,
        competitorAverage: o.competitorScore,
        gap: Math.round(o.gap * 10) / 10,
        patternAvailable: o.patternAvailable,
        action: o.patternAvailable
          ? `danteforge oss-intel --focus ${o.dimension} (pattern queued)`
          : `danteforge harvest --focus ${o.dimension} (needs discovery)`,
      })),
      totalOpportunities: opportunities.length,
      nextAction: `danteforge oss-intel --focus ${top[0].dimension}`,
    });
  } catch (err) {
    return jsonResult({
      opportunities: [],
      error: err instanceof Error ? err.message : String(err),
      nextAction: 'danteforge universe-scan',
    });
  }
}

async function handlePatternSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const keyword = typeof args['keyword'] === 'string' ? args['keyword'].toLowerCase() : '';
  const category = typeof args['category'] === 'string' ? args['category'] : undefined;
  const maxComplexity = typeof args['maxComplexity'] === 'string'
    ? (args['maxComplexity'] as 'low' | 'medium' | 'high')
    : undefined;
  const minAvgRoi = typeof args['minAvgRoi'] === 'number' ? args['minAvgRoi'] : 0;
  const limit = typeof args['limit'] === 'number' ? args['limit'] : 10;

  try {
    const { queryLibrary } = await import('./global-pattern-library.js');
    const results = await queryLibrary({ category, maxComplexity, minAvgRoi, limit: limit * 2 });

    // Apply keyword filter client-side
    const filtered = keyword
      ? results.filter(e =>
          e.patternName.toLowerCase().includes(keyword) ||
          e.whyItWorks.toLowerCase().includes(keyword) ||
          e.category.toLowerCase().includes(keyword),
        )
      : results;

    const top = filtered.slice(0, limit);

    if (top.length === 0) {
      return jsonResult({
        patterns: [],
        message: `No patterns found matching "${keyword || '(all)'}". Run danteforge oss-intel to populate the library.`,
        totalInLibrary: results.length,
      });
    }

    return jsonResult({
      patterns: top.map(e => ({
        name: e.patternName,
        category: e.category,
        complexity: e.adoptionComplexity,
        avgRoi: Math.round(e.avgRoi * 100) + '%',
        useCount: e.useCount,
        sourceRepo: e.sourceRepo,
        whyItWorks: e.whyItWorks.slice(0, 200),
        adoptAction: `danteforge oss-intel --adopt "${e.patternName}"`,
      })),
      totalMatched: filtered.length,
      totalInLibrary: results.length,
    });
  } catch (err) {
    return jsonResult({
      patterns: [],
      error: err instanceof Error ? err.message : String(err),
      message: 'Global pattern library unavailable. Run danteforge oss-intel to populate it.',
    });
  }
}

// ---------------------------------------------------------------------------
// COFL handler
// ---------------------------------------------------------------------------

async function handleCofl(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { cofl } = await import('../cli/commands/cofl.js');
    const hasFlag = (key: string) => args[key] === true;
    const anyFlagSet = ['universe', 'harvest', 'prioritize', 'guards', 'reframe', 'report'].some(hasFlag);
    const options = {
      universe: hasFlag('universe'),
      harvest: hasFlag('harvest'),
      prioritize: hasFlag('prioritize'),
      guards: hasFlag('guards'),
      reframe: hasFlag('reframe'),
      report: hasFlag('report'),
      auto: hasFlag('auto') || !anyFlagSet, // default to auto when no specific phase flag given
    };
    const result = await cofl(options, { _cwd: cwd });
    await auditLog(`cofl: cycle ${result?.cycleNumber ?? '?'}, patterns=${result?.extractedPatterns?.length ?? 0}`, cwd);
    return jsonResult(result ?? { error: 'COFL returned no result — check matrix and registry' });
  } catch (err) {
    return errorResult(`COFL failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  danteforge_adversarial_score: (args, deps = {}) => handleAdversarialScore(args, deps),
  danteforge_adoption_queue: (args) => handleAdoptionQueue(args),
  danteforge_quality_certificate: (args) => handleQualityCertificate(args),
  danteforge_pattern_coverage: (args) => handlePatternCoverage(args),
  danteforge_harvest_next_pattern: (args) => handleHarvestNextPattern(args),
  danteforge_explain_score: (args) => handleExplainScore(args),
  danteforge_leapfrog_opportunities: (args) => handleLeapfrogOpportunities(args),
  danteforge_pattern_search: (args) => handlePatternSearch(args),
  danteforge_dossier_build: (args) => handleDossierBuild(args),
  danteforge_dossier_get: (args) => handleDossierGet(args),
  danteforge_dossier_list: (args) => handleDossierList(args),
  danteforge_landscape_build: (args) => handleLandscapeBuild(args),
  danteforge_landscape_diff: (args) => handleLandscapeDiff(args),
  danteforge_rubric_get: (args) => handleRubricGet(args),
  danteforge_score_competitor: (args) => handleScoreCompetitor(args),
  danteforge_cofl: (args) => handleCofl(args),
};

// ---------------------------------------------------------------------------
// Dossier MCP handlers
// ---------------------------------------------------------------------------

async function handleDossierBuild(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const competitor = String(args['competitor'] ?? '');
  if (!competitor) return errorResult('Missing required parameter: competitor');
  const sources = Array.isArray(args['sources'])
    ? (args['sources'] as string[])
    : undefined;
  const since = args['since'] ? String(args['since']) : undefined;
  try {
    const { buildDossier } = await import('../dossier/builder.js');
    const dossier = await buildDossier({ cwd, competitor, sources, since });
    return jsonResult({
      competitor: dossier.competitor,
      displayName: dossier.displayName,
      composite: dossier.composite,
      lastBuilt: dossier.lastBuilt,
      dimCount: Object.keys(dossier.dimensions).length,
    });
  } catch (err) {
    return errorResult(`dossier build failed: ${String(err)}`);
  }
}

async function handleDossierGet(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const competitor = String(args['competitor'] ?? '');
  if (!competitor) return errorResult('Missing required parameter: competitor');
  const dim = args['dim'] !== undefined ? Number(args['dim']) : undefined;
  try {
    const { loadDossier } = await import('../dossier/builder.js');
    const dossier = await loadDossier(cwd, competitor);
    if (!dossier) return errorResult(`No dossier found for "${competitor}"`);
    if (dim !== undefined) {
      const dimDef = dossier.dimensions[String(dim)];
      if (!dimDef) return errorResult(`Dimension ${dim} not found in dossier`);
      return jsonResult(dimDef);
    }
    return jsonResult(dossier);
  } catch (err) {
    return errorResult(`dossier get failed: ${String(err)}`);
  }
}

async function handleDossierList(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { listDossiers } = await import('../dossier/builder.js');
    const dossiers = await listDossiers(cwd);
    const summary = dossiers
      .sort((a, b) => b.composite - a.composite)
      .map((d) => ({
        competitor: d.competitor,
        displayName: d.displayName,
        composite: d.composite,
        type: d.type,
        lastBuilt: d.lastBuilt,
      }));
    return jsonResult({ count: dossiers.length, dossiers: summary });
  } catch (err) {
    return errorResult(`dossier list failed: ${String(err)}`);
  }
}

async function handleLandscapeBuild(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { buildLandscape } = await import('../dossier/landscape.js');
    const matrix = await buildLandscape(cwd);
    return jsonResult({
      generatedAt: matrix.generatedAt,
      rubricVersion: matrix.rubricVersion,
      competitorCount: matrix.competitors.length,
      topRankings: matrix.rankings.slice(0, 5),
    });
  } catch (err) {
    return errorResult(`landscape build failed: ${String(err)}`);
  }
}

async function handleLandscapeDiff(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const {
      diffLandscape,
      isLandscapeStale,
      loadLandscape,
      loadPreviousLandscape,
    } = await import('../dossier/landscape.js');
    const landscape = await loadLandscape(cwd);
    if (!landscape) return jsonResult({ status: 'no_landscape', message: 'Run danteforge landscape to build' });
    const previous = await loadPreviousLandscape(cwd);
    if (!previous) {
      return jsonResult({
        status: 'no_previous_snapshot',
        generatedAt: landscape.generatedAt,
        rubricVersion: landscape.rubricVersion,
        competitorCount: landscape.competitors.length,
        stale: isLandscapeStale(landscape),
      });
    }

    return jsonResult({
      status: 'ok',
      generatedAt: landscape.generatedAt,
      previousGeneratedAt: previous.generatedAt,
      stale: isLandscapeStale(landscape),
      diff: diffLandscape(previous, landscape),
    });
  } catch (err) {
    return errorResult(`landscape diff failed: ${String(err)}`);
  }
}

async function handleRubricGet(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const dim = args['dim'] !== undefined ? Number(args['dim']) : undefined;
  try {
    const { getRubric, getDimCriteria } = await import('../dossier/rubric.js');
    const rubric = await getRubric(cwd);
    if (dim !== undefined) {
      const dimDef = getDimCriteria(rubric, dim);
      if (!dimDef) return errorResult(`Dimension ${dim} not found in rubric`);
      return jsonResult({ dim, ...dimDef });
    }
    return jsonResult(rubric);
  } catch (err) {
    return errorResult(`rubric get failed: ${String(err)}`);
  }
}

async function handleScoreCompetitor(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const competitor = String(args['competitor'] ?? '');
  if (!competitor) return errorResult('Missing required parameter: competitor');
  try {
    const { loadDossier } = await import('../dossier/builder.js');
    const dossier = await loadDossier(cwd, competitor);
    if (!dossier) return errorResult(`No dossier found for "${competitor}". Run: danteforge dossier build ${competitor}`);
    const dimSummary: Record<string, number> = {};
    for (const [k, v] of Object.entries(dossier.dimensions)) {
      dimSummary[k] = v.humanOverride ?? v.score;
    }
    return jsonResult({
      competitor: dossier.competitor,
      displayName: dossier.displayName,
      composite: dossier.composite,
      dimensions: dimSummary,
      lastBuilt: dossier.lastBuilt,
    });
  } catch (err) {
    return errorResult(`score competitor failed: ${String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export async function createAndStartMCPServer(): Promise<void> {
  const server = new Server(
    { name: 'danteforge', version: '0.17.0' },
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

    // Rate limit per tool name — protects against DoS / tight automation loops
    const limiter = getMcpRateLimiter();
    const rateResult = limiter.consume(name);
    if (!rateResult.allowed) {
      return errorResult(
        `Rate limit exceeded for '${name}'. Retry after ${rateResult.retryAfterMs}ms. ` +
        `(Limit: 30 burst / 10 per second)`,
      );
    }

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
              serverInfo: { name: 'danteforge', version: '0.17.0' },
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
