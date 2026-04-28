import { logger } from '../../core/logger.js';
import { loadState } from '../../core/state.js';
import { isLLMAvailable } from '../../core/llm.js';
import { recordMemory } from '../../core/memory-engine.js';
import { buildSubagentContext, runIsolatedAgent, type AgentRole } from '../../core/subagent-isolator.js';
import { createAgentWorktree, removeAgentWorktree, listWorktrees } from '../../utils/worktree.js';
import { reflect, evaluateVerdict } from '../../core/reflection-engine.js';
import { createTelemetry, recordToolCall, type ExecutionTelemetry } from '../../core/execution-telemetry.js';
import { runPMAgent } from './agents/pm.js';
import { runArchitectAgent } from './agents/architect.js';
import { runDevAgent } from './agents/dev.js';
import { runUXAgent } from './agents/ux.js';
import { runDesignAgent } from './agents/design.js';
import { runScrumMasterAgent } from './agents/scrum-master.js';
import fs from 'fs/promises';

export const DEFAULT_AGENTS = ['pm', 'architect', 'dev', 'ux', 'design', 'scrum-master'];
const PARTY_ARTIFACT_DIR = '.danteforge';
export const AGENT_MAX_RETRIES = 2;
export const AGENT_RETRY_DELAYS_MS = [2000, 5000];

/**
 * Shared state type used by party-mode internals.
 */
export interface PartyState {
  project: string;
  constitution?: string;
  workflowStage?: string;
  currentPhase: number;
  tasks: Record<number, { name: string; files?: string[]; verify?: string }[]>;
  lastHandoff: string;
  profile: string;
  tddEnabled?: boolean;
  lightMode?: boolean;
  auditLog?: string[];
}

/**
 * Injection interface for testing party-mode without real dependencies.
 */
export interface PartyModeOptions {
  _loadState?: () => Promise<PartyState>;
  _isLLMAvailable?: () => Promise<boolean>;
  _readArtifact?: (filename: string) => Promise<string>;
  _onAgentUpdate?: (agent: string, status: 'starting' | 'done' | 'failed') => void;
  _dispatchAgent?: (
    agentName: string, context: string, projectSize: string,
    profile: string, fullContext: Record<string, string>, isolation: boolean,
  ) => Promise<AgentResult>;
  _createWorktree?: (name: string) => Promise<string>;
  _removeWorktree?: (name: string) => Promise<void>;
  _listWorktrees?: () => Promise<{ path: string; branch: string }[]>;
  _reflect?: typeof reflect;
  _recordMemory?: typeof recordMemory;
  _captureFailureLessons?: (
    failures: { task: string; error?: string }[],
    source: 'forge failure' | 'party failure',
  ) => Promise<void>;
  _sleep?: (ms: number) => Promise<void>;
  /** Project directory — used for lesson injection. Defaults to process.cwd(). */
  _cwd?: string;
}

const AGENT_ROLES: Record<string, AgentRole> = {
  pm: 'pm',
  architect: 'architect',
  dev: 'dev',
  ux: 'ux',
  design: 'design',
  'scrum-master': 'scrum-master',
};

export function determineScale(projectSize: string): 'light' | 'standard' | 'deep' {
  const size = projectSize.toLowerCase().trim();

  if (size.includes('small') || size.includes('lite') || size.includes('light') || size.includes('mini')) {
    return 'light';
  }

  if (size.includes('large') || size.includes('enterprise') || size.includes('complex') || size.includes('deep')) {
    return 'deep';
  }

  return 'standard';
}

export function buildTaskSummary(state: PartyState): string {
  const lines: string[] = [];
  const phaseKeys = Object.keys(state.tasks).map(Number).sort((a, b) => a - b);
  if (phaseKeys.length > 0) {
    lines.push('## Task Summary');
    for (const phase of phaseKeys) {
      const phaseTasks = state.tasks[phase];
      if (!phaseTasks || phaseTasks.length === 0) continue;

      lines.push(`### Phase ${phase} (${phaseTasks.length} tasks)`);
      for (const task of phaseTasks) {
        const fileCount = task.files?.length ?? 0;
        const verifyStatus = task.verify ? 'has verification' : 'no verification defined';
        lines.push(`  - ${task.name} (${fileCount} files, ${verifyStatus})`);
      }
    }
  } else {
    lines.push('## Task Summary\nNo tasks defined yet.');
  }

  return lines.join('\n');
}

export async function readArtifact(filename: string): Promise<string> {
  try {
    return await fs.readFile(`${PARTY_ARTIFACT_DIR}/${filename}`, 'utf8');
  } catch {
    return '';
  }
}

async function buildStructuredContextFromState(
  state: PartyState,
  _readArtifact?: (filename: string) => Promise<string>,
): Promise<Record<string, string>> {
  const read = _readArtifact ?? readArtifact;
  const uniqueFiles = new Set<string>();
  for (const phaseTasks of Object.values(state.tasks)) {
    for (const task of phaseTasks ?? []) {
      for (const file of task.files ?? []) {
        uniqueFiles.add(file);
      }
    }
  }

  const spec = await read('SPEC.md');
  const plan = await read('PLAN.md');
  const design = await read('DESIGN.op');
  const designTokens = await read('design-tokens.css');
  const lessons = await read('lessons.md');
  const taskSummary = buildTaskSummary(state);
  const summaries = (state.auditLog ?? []).slice(-10).join('\n');

  return {
    spec,
    plan,
    fileTree: Array.from(uniqueFiles).sort().join('\n'),
    tasks: taskSummary,
    relevantFiles: Array.from(uniqueFiles).sort().join('\n'),
    design,
    componentList: Array.from(uniqueFiles)
      .filter(file => /\.(tsx|jsx|vue|svelte|html)$/i.test(file))
      .sort()
      .join('\n'),
    opDocument: design,
    designTokens,
    summaries,
    lessons,
  };
}

export function buildContextFromState(
  state: PartyState,
  fullContext: Record<string, string>,
): string {
  const lines: string[] = [];

  lines.push(`## Project: ${state.project}`);
  lines.push(`## Workflow Stage: ${state.workflowStage ?? 'unknown'}`);
  lines.push(`## Current Phase: ${state.currentPhase}`);
  lines.push(`## Last Handoff: ${state.lastHandoff}`);
  lines.push(`## Developer Profile: ${state.profile}`);

  if (state.constitution) {
    lines.push(`## Constitution:\n${state.constitution}`);
  }

  if (state.tddEnabled) {
    lines.push('## TDD Mode: Enabled');
  }

  if (state.lightMode) {
    lines.push('## Light Mode: Enabled (reduced overhead)');
  }

  for (const [key, value] of Object.entries(fullContext)) {
    if (value.trim().length > 0) {
      lines.push(`## ${key}\n${value}`);
    }
  }

  return lines.join('\n');
}

export interface AgentResult {
  agent: string;
  result: string;
  durationMs: number;
  success: boolean;
  error?: Error;
}

export function isSyntheticAgentResult(result: string): boolean {
  return /offline mode|no llm available|manual review required|configure an llm provider/i.test(result);
}

/**
 * Compute a quality score for agent output based on length and structure.
 * PDSE-style heuristic: length contributes up to 40pts, headings 30pts, action items 30pts.
 */
export function computeQualityScore(output: string): number {
  const outputLength = output.length;
  const hasHeadings = /^#+ /m.test(output);
  const hasActionItems = /^[-*] /m.test(output);
  return Math.min(100,
    (outputLength > 500 ? 40 : Math.round(outputLength / 12.5)) +
    (hasHeadings ? 30 : 0) +
    (hasActionItems ? 30 : 0),
  );
}

async function dispatchAgent(
  agentName: string,
  context: string,
  projectSize: string,
  profile: string,
  fullContext: Record<string, string>,
  isolation = false,
): Promise<AgentResult> {
  const start = Date.now();
  const runAgent = async (agentContext: string): Promise<string> => {
    switch (agentName) {
      case 'pm':
        return runPMAgent(agentContext, projectSize);
      case 'architect':
        return runArchitectAgent(agentContext, projectSize);
      case 'dev':
        return runDevAgent(agentContext, profile);
      case 'ux':
        return runUXAgent(agentContext, projectSize);
      case 'design':
        return runDesignAgent(agentContext, projectSize);
      case 'scrum-master':
        return runScrumMasterAgent(agentContext, projectSize);
      default:
        throw new Error(`Unknown Agent: ${agentName}. Available agents: ${DEFAULT_AGENTS.join(', ')}`);
    }
  };

  let result: string;
  let success = true;
  let error: Error | undefined;

  try {
    if (isolation) {
      const role = AGENT_ROLES[agentName];
      if (!role) {
        throw new Error(`Unknown Agent: ${agentName}. Available agents: ${DEFAULT_AGENTS.join(', ')}`);
      }

      const isolated = await runIsolatedAgent(
        buildSubagentContext(agentName, fullContext, role),
        runAgent,
      );
      result = isolated.output;
      if (isolated.flagged) {
        success = false;
        error = new Error(`${agentName} output was flagged during isolated review`);
      }
    } else {
      result = await runAgent(context);
    }
  } catch (err) {
    const failure = err instanceof Error ? err : new Error(String(err));
    logger.warn(`Agent "${agentName}" failed before completion`);
    return {
      agent: agentName,
      result: `# ${agentName} Agent Error\n\nFailed to execute: ${failure.message}`,
      durationMs: Date.now() - start,
      success: false,
      error: failure,
    };
  }

  if (isSyntheticAgentResult(result)) {
    return {
      agent: agentName,
      result,
      durationMs: Date.now() - start,
      success: false,
      error: new Error(`${agentName} produced offline/template output instead of a live result`),
    };
  }

  return { agent: agentName, result, durationMs: Date.now() - start, success, error };
}

export async function dispatchAgentWithRetry(
  agentName: string,
  context: string,
  projectSize: string,
  profile: string,
  fullContext: Record<string, string>,
  isolation: boolean,
  options?: {
    _dispatchAgent?: PartyModeOptions['_dispatchAgent'];
    _sleep?: (ms: number) => Promise<void>;
    _onAgentUpdate?: PartyModeOptions['_onAgentUpdate'];
  },
): Promise<AgentResult> {
  const dispatch = options?._dispatchAgent ?? dispatchAgent;
  const sleep = options?._sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const onUpdate = options?._onAgentUpdate ?? ((agent: string, status: string) => {
    logger.info(`[party:${agent}] ${status}`);
  });
  let lastResult: AgentResult | undefined;
  onUpdate(agentName, 'starting');
  for (let attempt = 0; attempt <= AGENT_MAX_RETRIES; attempt++) {
    const result = await dispatch(agentName, context, projectSize, profile, fullContext, isolation);
    if (result.success) {
      onUpdate(agentName, 'done');
      return result;
    }
    lastResult = result;
    if (attempt < AGENT_MAX_RETRIES) {
      const delay = AGENT_RETRY_DELAYS_MS[attempt]!;
      logger.warn(`Agent "${agentName}" failed (attempt ${attempt + 1}/${AGENT_MAX_RETRIES + 1}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  onUpdate(agentName, 'failed');
  return lastResult!;
}

async function setupWorktrees(
  activeAgents: string[],
  createWt: (name: string) => Promise<string>,
  removeWt: (name: string) => Promise<void>,
): Promise<{ worktreePaths: { agent: string; path: string }[]; success: boolean }> {
  const worktreePaths: { agent: string; path: string }[] = [];
  logger.info('Worktree isolation enabled - creating isolated workspaces...');
  try {
    for (const agent of activeAgents) {
      const safeName = agent.toLowerCase().replace(/\s+/g, '-');
      worktreePaths.push({ agent, path: await createWt(safeName) });
    }
    logger.success(`${worktreePaths.length} worktree(s) created for parallel execution`);
    for (const worktree of worktreePaths) logger.info(`  ${worktree.agent}: ${worktree.path}`);
    return { worktreePaths, success: true };
  } catch (err) {
    logger.error(`Worktree setup failed: ${err instanceof Error ? err.message : String(err)}`);
    if (worktreePaths.length > 0) await cleanupWorktrees(worktreePaths.map(w => w.agent), removeWt);
    logger.error('Party mode requires worktree isolation when --worktree is requested. Fix git/worktree setup and re-run.');
    return { worktreePaths: [], success: false };
  }
}

async function dispatchAllAgents(
  activeAgents: string[],
  context: string,
  projectSize: string,
  profile: string,
  fullContext: Record<string, string>,
  isolatedMode: boolean,
  partyStart: number,
  options: PartyModeOptions | undefined,
): Promise<AgentResult[]> {
  let dagExecutionUsed = false;
  let results: AgentResult[] = [];
  try {
    const { isClaudeCliAvailable } = await import('../../core/headless-spawner.js');
    const cliAvailable = await isClaudeCliAvailable();
    if (cliAvailable && !isolatedMode) {
      const { buildDefaultDAG, computeExecutionLevels, executeDAG, loadCustomDAG, filterDAGToRoles } = await import('../../core/agent-dag.js');
      const customDag = await loadCustomDAG();
      const dagNodes = customDag ?? buildDefaultDAG();
      const filteredNodes = filterDAGToRoles(dagNodes, activeAgents as AgentRole[]);
      if (filteredNodes.length > 0) {
        const dagPlan = computeExecutionLevels(filteredNodes);
        logger.info(`[Party] DAG execution: ${dagPlan.levels.length} levels, max parallelism ${dagPlan.estimatedParallelism}`);
        const dagResult = await executeDAG<AgentResult>(dagPlan, async (levelAgents) => {
          const levelResults = new Map<AgentRole, AgentResult>();
          await Promise.all(levelAgents.map(async (role) => {
            const agentName = role as string;
            try {
              levelResults.set(role, await dispatchAgentWithRetry(agentName, context, projectSize, profile, fullContext, false, { _dispatchAgent: options?._dispatchAgent, _sleep: options?._sleep, _onAgentUpdate: options?._onAgentUpdate }));
            } catch (err) {
              levelResults.set(role, { agent: agentName, result: `# ${agentName} Agent Error\n\nFailed to execute: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - partyStart, success: false, error: err instanceof Error ? err : new Error(String(err)) });
            }
          }));
          return levelResults;
        });
        results = Array.from(dagResult.results.values());
        for (const blockedRole of dagResult.blockedAgents) {
          results.push({ agent: blockedRole, result: `# ${blockedRole} Agent Blocked\n\nBlocked by upstream DAG dependency failure`, durationMs: 0, success: false, error: new Error('Blocked by upstream DAG dependency failure') });
        }
        dagExecutionUsed = true;
        logger.info(`[Party] DAG execution completed: ${dagResult.results.size} succeeded, ${dagResult.blockedAgents.length} blocked`);
      }
    }
  } catch (err) {
    logger.info(`[Party] DAG execution unavailable, using standard dispatch: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!dagExecutionUsed) {
    results = await Promise.all(activeAgents.map((agentName) =>
      dispatchAgentWithRetry(agentName, context, projectSize, profile, fullContext, isolatedMode, { _dispatchAgent: options?._dispatchAgent, _sleep: options?._sleep, _onAgentUpdate: options?._onAgentUpdate }).catch((err): AgentResult => ({
        agent: agentName, result: `# ${agentName} Agent Error\n\nFailed to execute: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - partyStart, success: false, error: err instanceof Error ? err : new Error(String(err)),
      })),
    ));
  }
  return results;
}

async function scoreAndReflectResults(results: AgentResult[], reflectFn: typeof reflect): Promise<void> {
  for (const agentResult of results) {
    if (!agentResult.success) continue;
    const qualityScore = computeQualityScore(agentResult.result);
    (agentResult as AgentResult & { qualityScore?: number }).qualityScore = qualityScore;
    if (qualityScore < 50) logger.warn(`Agent "${agentResult.agent}" output quality score: ${qualityScore}/100 (below threshold)`);
    try {
      const agentTelemetry: ExecutionTelemetry = createTelemetry();
      recordToolCall(agentTelemetry, `dispatch:${agentResult.agent}`, true);
      agentTelemetry.duration = agentResult.durationMs;
      const verdict = await reflectFn(agentResult.agent, agentResult.result, agentTelemetry);
      const evaluation = evaluateVerdict(verdict);
      if (!evaluation.complete && evaluation.score < 50) logger.warn(`Reflection: ${agentResult.agent} agent scored ${evaluation.score}/100 — ${evaluation.feedback}`);
    } catch { /* reflection must not block party mode */ }
  }
}

async function defaultCaptureFailureLessons(
  failures: { task: string; error?: string }[],
  source: 'forge failure' | 'party failure',
): Promise<void> {
  const { captureFailureLessons } = await import('../../cli/commands/lessons.js');
  await captureFailureLessons(failures, source);
}

async function reportFailures(
  failedAgents: AgentResult[],
  memoryFn: typeof recordMemory,
  captureFailureLessons: NonNullable<PartyModeOptions['_captureFailureLessons']>,
): Promise<void> {
  for (const failedAgent of failedAgents) {
    logger.warn(`  ${failedAgent.agent}: ${failedAgent.result.split('\n')[2] ?? 'unknown error'}`);
    await memoryFn({ category: 'error', summary: `Party agent failed: ${failedAgent.agent}`, detail: failedAgent.error?.message ?? failedAgent.result, tags: ['party', 'agent-failure', failedAgent.agent], relatedCommands: ['party'] });
  }
  try {
    await captureFailureLessons(
      failedAgents.map(e => ({ task: `${e.agent} agent`, error: e.result.split('\n')[2] ?? 'unknown error' })),
      'party failure',
    );
  } catch (err) { logger.verbose(`[best-effort] party lessons: ${err instanceof Error ? err.message : String(err)}`); }
}

function printResultsSummary(results: AgentResult[]): void {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('  DANTE PARTY MODE - RESULTS SUMMARY');
  logger.info('='.repeat(60));
  for (const { agent, result, durationMs, success } of results) {
    const durationSec = (durationMs / 1000).toFixed(1);
    const previewLines = result.split('\n').slice(0, 3).join(' | ');
    const preview = previewLines.length > 120 ? `${previewLines.substring(0, 120)}...` : previewLines;
    logger.info('');
    if (success) logger.success(`[${agent.toUpperCase()}] (${durationSec}s)`);
    else logger.warn(`[${agent.toUpperCase()}] (${durationSec}s)`);
    logger.info(`  Preview: ${preview}`);
    logger.info(`  Full response: ${result.length} characters`);
  }
  logger.info('');
  logger.info('-'.repeat(60));
  for (const { agent, result } of results) {
    logger.info('');
    logger.info('='.repeat(60));
    logger.info(`  ${agent.toUpperCase()} AGENT - FULL REPORT`);
    logger.info('='.repeat(60));
    logger.info(result);
  }
}

export async function runDanteParty(
  agents?: string[],
  useWorktrees?: boolean,
  isolation?: boolean,
  options?: PartyModeOptions,
): Promise<{ success: boolean }> {
  const isolatedMode = isolation ?? false;
  const activeAgents = agents ?? DEFAULT_AGENTS;
  const partyStart = Date.now();

  const stateLoader = options?._loadState ?? (async () => await loadState() as PartyState);
  const llmChecker = options?._isLLMAvailable ?? isLLMAvailable;
  const createWt = options?._createWorktree ?? createAgentWorktree;
  const removeWt = options?._removeWorktree ?? removeAgentWorktree;
  const listWt = options?._listWorktrees ?? listWorktrees;
  const reflectFn = options?._reflect ?? reflect;
  const memoryFn = options?._recordMemory ?? recordMemory;
  const captureFailureLessonsFn = options?._captureFailureLessons ?? defaultCaptureFailureLessons;

  logger.success(`Dante Party Mode - ${activeAgents.length} agent(s) assembling`);
  logger.info(`Agents: ${activeAgents.join(', ')}`);

  const state = await stateLoader();
  const scale = determineScale(state.lightMode ? 'small' : 'medium');
  logger.info(`Orchestration scale: ${scale}`);

  const llmReady = await llmChecker();
  if (!llmReady) {
    logger.error('Party mode requires a verified live LLM provider. Configure a provider with working model access or start Ollama with the configured model before dispatching agents.');
    return { success: false };
  }

  const fullContext = await buildStructuredContextFromState(state, options?._readArtifact);
  let context = buildContextFromState(state, fullContext);
  if (fullContext['lessons']?.trim()) {
    try {
      const { injectRelevantLessons } = await import('../../core/lessons-index.js');
      context = await injectRelevantLessons(context, 5, options?._cwd ?? process.cwd());
    } catch { /* lessons injection is best-effort — never block party mode */ }
  }

  let worktreePaths: { agent: string; path: string }[] = [];
  if (useWorktrees) {
    const wtResult = await setupWorktrees(activeAgents, createWt, removeWt);
    if (!wtResult.success) return { success: false };
    worktreePaths = wtResult.worktreePaths;
  }

  logger.info('Dispatching agents...');
  const projectSize = state.lightMode ? 'small' : 'medium';
  const profile = state.profile ?? 'balanced';
  const results = await dispatchAllAgents(activeAgents, context, projectSize, profile, fullContext, isolatedMode, partyStart, options);

  await scoreAndReflectResults(results, reflectFn);

  const failedAgents = results.filter(r => !r.success);
  if (failedAgents.length === results.length) logger.error(`All ${results.length} agent(s) failed - party mode aborted`);
  else if (failedAgents.length > 0) logger.warn(`${failedAgents.length}/${results.length} agent(s) failed`);
  if (failedAgents.length > 0) await reportFailures(failedAgents, memoryFn, captureFailureLessonsFn);

  printResultsSummary(results);

  if (worktreePaths.length > 0) {
    const activeWorktrees = await listWt();
    if (activeWorktrees.length > 0) logger.info(`Active DanteForge worktrees: ${activeWorktrees.length}`);
    await cleanupWorktrees(activeAgents, removeWt);
  }

  const totalDurationSec = ((Date.now() - partyStart) / 1000).toFixed(1);
  logger.info('');
  if (failedAgents.length > 0) logger.warn(`Dante Party Mode completed with failures - ${results.length - failedAgents.length}/${results.length} agent(s) succeeded, ${totalDurationSec}s total`);
  else logger.success(`Dante Party Mode complete - ${results.length} agent(s), ${totalDurationSec}s total`);
  return { success: failedAgents.length === 0 };
}

export async function cleanupWorktrees(
  agents: string[],
  _removeWorktree?: (name: string) => Promise<void>,
): Promise<void> {
  const remove = _removeWorktree ?? removeAgentWorktree;
  logger.info('Cleaning up agent worktrees...');

  for (const agent of agents) {
    const safeName = agent.toLowerCase().replace(/\s+/g, '-');
    try {
      await remove(safeName);
    } catch (err) {
      logger.warn(`Failed to remove worktree for "${agent}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.success('Agent worktree cleanup complete');
}
