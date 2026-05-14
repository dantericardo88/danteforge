// MCP Tool Server â€” exposes DanteForge as an MCP tool server for Claude Code, Codex, or any MCP client.
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
import { TOOL_DEFINITIONS } from './mcp-tool-definitions.js';
export { TOOL_DEFINITIONS } from './mcp-tool-definitions.js';
import {
  handleAdoptionQueue,
  handleQualityCertificate,
  handlePatternCoverage,
  handleHarvestNextPattern,
  handleExplainScore,
  handleLeapfrogOpportunities,
  handlePatternSearch,
  handleCofl,
  handleDossierBuild,
  handleDossierGet,
  handleDossierList,
  handleLandscapeBuild,
  handleLandscapeDiff,
  handleRubricGet,
  handleScoreCompetitor,
  handleUniverse,
  handleEnsureUniverseReady,
  handleCanonicalCompetitors,
  handleCompeteReset,
} from './mcp-extended-handlers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolResult = CallToolResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_DIR = '.danteforge';

/** Resolve working directory â€” allows _cwd injection for testing */
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
    // Best-effort â€” never block main path
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
    return jsonResult({ content: '', message: 'No lessons.md found â€” no lessons recorded yet.' });
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
    await auditLog(`verify: failed â€” ${err instanceof Error ? err.message : String(err)}`, cwd);
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
    await auditLog(`handoff: ${stage} failed â€” ${err instanceof Error ? err.message : String(err)}`, cwd);
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

function clampAuditCount(raw: unknown): number {
  const count = typeof raw === 'number' ? raw : 20;
  return Math.max(1, Math.min(count, 500));
}

async function handleAuditLog(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const safeCount = clampAuditCount(args['count']);
  const state = await loadState({ cwd });
  const total = state.auditLog.length;
  const entries = state.auditLog.slice(-safeCount);
  await auditLog('audit_log read', cwd);
  return jsonResult({ total, returned: entries.length, entries });
}

// ---------------------------------------------------------------------------
// McpServerDeps â€” injection interface for testing
// ---------------------------------------------------------------------------

export interface McpServerDeps {
  /** Injected assess function â€” returns score and threshold result */
  _assess?: (opts: { cwd: string }) => Promise<{ overallScore: number; passesThreshold: boolean }>;
  /** Injected state loader â€” returns DanteState */
  _loadState?: (opts: { cwd: string }) => Promise<unknown>;
  /** Injected workflow info â€” returns workflowStage, currentPhase, lastHandoff, lastVerifyStatus */
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
  /** Injected rate limiter â€” defaults to the MCP singleton. Override in tests to bypass. */
  _rateLimiter?: RateLimiter | null;
  /** Injected adversarial scorer â€” for testing danteforge_adversarial_score without LLM */
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
  | 'danteforge_universe'
  | 'danteforge_ensure_universe_ready'
  | 'danteforge_canonical_competitors'
  | 'danteforge_compete_reset'
  | 'danteforge_adversarial_score'
  | 'danteforge_convergence_status'
  | 'danteforge_git_activity'
  | 'danteforge_health';

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

// ── Ecosystem / health tool handlers ─────────────────────────────────────────

async function handleConvergenceStatus(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  const reportsDir = path.join(cwd, STATE_DIR, 'reports');
  try {
    const entries = await fs.readdir(reportsDir);
    const scoreFiles = entries
      .filter(e => e.startsWith('score-') && e.endsWith('.json'))
      .sort()
      .slice(-3);

    if (scoreFiles.length === 0) {
      return jsonResult({ trend: 'unknown', reason: 'No score snapshots found', delta: 0, snapshots: [] });
    }

    const snapshots: Array<{ file: string; score: number; timestamp: string }> = [];
    for (const file of scoreFiles) {
      try {
        const raw = await fs.readFile(path.join(reportsDir, file), 'utf8');
        const data = JSON.parse(raw) as Record<string, unknown>;
        const score =
          typeof data['overallScore'] === 'number' ? data['overallScore'] :
          typeof data['score'] === 'number' ? data['score'] : 0;
        const timestamp = typeof data['timestamp'] === 'string' ? data['timestamp'] : file;
        snapshots.push({ file, score, timestamp });
      } catch {
        // Skip unparseable snapshots
      }
    }

    if (snapshots.length < 2) {
      const latest = snapshots[0];
      return jsonResult({ trend: 'unknown', reason: 'Fewer than 2 snapshots', delta: 0, snapshots, latest });
    }

    const first = snapshots[0].score;
    const last = snapshots[snapshots.length - 1].score;
    const delta = Math.round((last - first) * 100) / 100;
    const trend = delta > 0.05 ? 'improving' : delta < -0.05 ? 'regressing' : 'stalled';

    return jsonResult({ trend, delta, snapshots, latest: snapshots[snapshots.length - 1] });
  } catch {
    return jsonResult({ trend: 'unknown', reason: 'No reports directory', delta: 0, snapshots: [] });
  }
}

async function handleGitActivity(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { getRecentPRActivity } = await import('./git-integration.js');
    const activity = await getRecentPRActivity(cwd);
    return jsonResult({ branchCount: activity.length, branches: activity });
  } catch (err) {
    return errorResult(`git activity failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleHealth(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = resolveCwd(args);
  try {
    const { runIntegrationHealth } = await import('../cli/commands/integration-health.js');
    const result = await runIntegrationHealth({ cwd });
    return jsonResult(result);
  } catch (err) {
    return errorResult(`health check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Tool dispatch
// ---------------------------------------------------------------------------

// ToolHandler is now a union: old handlers return ToolResult, new injectable handlers return string.
// Tests must use the appropriate type for the specific handler called.
export type ToolHandler = (args: Record<string, unknown>, deps?: McpServerDeps) => Promise<ToolResult | string>;

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // Legacy handlers â€” return ToolResult (backward compat with mcp-handlers.test.ts)
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
  // New injectable handlers â€” return string (JSON-serialized result)
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
  danteforge_universe: (args) => handleUniverse(args),
  danteforge_ensure_universe_ready: (args) => handleEnsureUniverseReady(args),
  danteforge_canonical_competitors: (args) => handleCanonicalCompetitors(args),
  danteforge_compete_reset: (args) => handleCompeteReset(args),
  danteforge_convergence_status: (args) => handleConvergenceStatus(args),
  danteforge_git_activity: (args) => handleGitActivity(args),
  danteforge_health: (args) => handleHealth(args),
};

// ---------------------------------------------------------------------------
// Dossier MCP handlers
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

    // Rate limit per tool name â€” protects against DoS / tight automation loops
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
        await auditLog(`tool error: ${name} â€” ${message}`);
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


