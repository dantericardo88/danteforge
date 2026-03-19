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

function buildTaskSummary(state: {
  project: string;
  constitution?: string;
  workflowStage?: string;
  currentPhase: number;
  tasks: Record<number, { name: string; files?: string[]; verify?: string }[]>;
  lastHandoff: string;
  profile: string;
  tddEnabled?: boolean;
  lightMode?: boolean;
}): string {
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

async function readArtifact(filename: string): Promise<string> {
  try {
    return await fs.readFile(`${PARTY_ARTIFACT_DIR}/${filename}`, 'utf8');
  } catch {
    return '';
  }
}

async function buildStructuredContextFromState(state: {
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
}): Promise<Record<string, string>> {
  const uniqueFiles = new Set<string>();
  for (const phaseTasks of Object.values(state.tasks)) {
    for (const task of phaseTasks ?? []) {
      for (const file of task.files ?? []) {
        uniqueFiles.add(file);
      }
    }
  }

  const spec = await readArtifact('SPEC.md');
  const plan = await readArtifact('PLAN.md');
  const design = await readArtifact('DESIGN.op');
  const designTokens = await readArtifact('design-tokens.css');
  const lessons = await readArtifact('lessons.md');
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

function buildContextFromState(
  state: {
    project: string;
    constitution?: string;
    workflowStage?: string;
    currentPhase: number;
    tasks: Record<number, { name: string; files?: string[]; verify?: string }[]>;
    lastHandoff: string;
    profile: string;
    tddEnabled?: boolean;
    lightMode?: boolean;
  },
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

function isSyntheticAgentResult(result: string): boolean {
  return /offline mode|no llm available|manual review required|configure an llm provider/i.test(result);
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

async function dispatchAgentWithRetry(
  agentName: string,
  context: string,
  projectSize: string,
  profile: string,
  fullContext: Record<string, string>,
  isolation: boolean,
): Promise<AgentResult> {
  let lastResult: AgentResult | undefined;
  for (let attempt = 0; attempt <= AGENT_MAX_RETRIES; attempt++) {
    const result = await dispatchAgent(agentName, context, projectSize, profile, fullContext, isolation);
    if (result.success) return result;
    lastResult = result;
    if (attempt < AGENT_MAX_RETRIES) {
      const delay = AGENT_RETRY_DELAYS_MS[attempt]!;
      logger.warn(`Agent "${agentName}" failed (attempt ${attempt + 1}/${AGENT_MAX_RETRIES + 1}) — retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return lastResult!;
}

export async function runDanteParty(
  agents?: string[],
  useWorktrees?: boolean,
  isolation?: boolean,
): Promise<void> {
  const isolatedMode = isolation ?? false;
  const activeAgents = agents ?? DEFAULT_AGENTS;
  const partyStart = Date.now();

  logger.success(`Dante Party Mode - ${activeAgents.length} agent(s) assembling`);
  logger.info(`Agents: ${activeAgents.join(', ')}`);

  const state = await loadState();
  const scale = determineScale(state.lightMode ? 'small' : 'medium');
  logger.info(`Orchestration scale: ${scale}`);

  const llmReady = await isLLMAvailable();
  if (!llmReady) {
    logger.error('Party mode requires a verified live LLM provider. Configure a provider with working model access or start Ollama with the configured model before dispatching agents.');
    process.exitCode = 1;
    return;
  }

  const fullContext = await buildStructuredContextFromState(state);
  const context = buildContextFromState(state, fullContext);
  const worktreePaths: { agent: string; path: string }[] = [];

  if (useWorktrees) {
    logger.info('Worktree isolation enabled - creating isolated workspaces...');
    try {
      for (const agent of activeAgents) {
        const safeName = agent.toLowerCase().replace(/\s+/g, '-');
        const worktreePath = await createAgentWorktree(safeName);
        worktreePaths.push({ agent, path: worktreePath });
      }
      logger.success(`${worktreePaths.length} worktree(s) created for parallel execution`);
      for (const worktree of worktreePaths) {
        logger.info(`  ${worktree.agent}: ${worktree.path}`);
      }
    } catch (err) {
      logger.error(`Worktree setup failed: ${err instanceof Error ? err.message : String(err)}`);
      if (worktreePaths.length > 0) {
        await cleanupWorktrees(worktreePaths.map(worktree => worktree.agent));
        worktreePaths.length = 0;
      }
      logger.error('Party mode requires worktree isolation when --worktree is requested. Fix git/worktree setup and re-run.');
      process.exitCode = 1;
      return;
    }
  }

  logger.info('Dispatching agents...');
  const projectSize = state.lightMode ? 'small' : 'medium';
  const profile = state.profile ?? 'balanced';

  const results = await Promise.all(activeAgents.map((agentName) =>
    dispatchAgentWithRetry(agentName, context, projectSize, profile, fullContext, isolatedMode).catch((err): AgentResult => ({
      agent: agentName,
      result: `# ${agentName} Agent Error\n\nFailed to execute: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Date.now() - partyStart,
      success: false,
      error: err instanceof Error ? err : new Error(String(err)),
    })),
  ));

  // Score each successful agent's output for quality (PDSE-style length + structure check)
  for (const agentResult of results) {
    if (!agentResult.success) continue;
    const outputLength = agentResult.result.length;
    const hasHeadings = /^#+ /m.test(agentResult.result);
    const hasActionItems = /^[-*] /m.test(agentResult.result);
    const qualityScore = Math.min(100,
      (outputLength > 500 ? 40 : Math.round(outputLength / 12.5)) +
      (hasHeadings ? 30 : 0) +
      (hasActionItems ? 30 : 0),
    );
    (agentResult as AgentResult & { qualityScore?: number }).qualityScore = qualityScore;
    if (qualityScore < 50) {
      logger.warn(`Agent "${agentResult.agent}" output quality score: ${qualityScore}/100 (below threshold)`);
    }

    // Reflection: structured self-assessment on agent output
    try {
      const agentTelemetry: ExecutionTelemetry = createTelemetry();
      recordToolCall(agentTelemetry, `dispatch:${agentResult.agent}`, true);
      agentTelemetry.duration = agentResult.durationMs;
      const verdict = await reflect(agentResult.agent, agentResult.result, agentTelemetry);
      const evaluation = evaluateVerdict(verdict);
      if (!evaluation.complete && evaluation.score < 50) {
        logger.warn(`Reflection: ${agentResult.agent} agent scored ${evaluation.score}/100 — ${evaluation.feedback}`);
      }
    } catch {
      // Reflection should not block party mode
    }
  }

  const failedAgents = results.filter(result => !result.success);
  if (failedAgents.length === results.length) {
    logger.error(`All ${results.length} agent(s) failed - party mode aborted`);
  } else if (failedAgents.length > 0) {
    logger.warn(`${failedAgents.length}/${results.length} agent(s) failed`);
  }

  for (const failedAgent of failedAgents) {
    logger.warn(`  ${failedAgent.agent}: ${failedAgent.result.split('\n')[2] ?? 'unknown error'}`);
    await recordMemory({
      category: 'error',
      summary: `Party agent failed: ${failedAgent.agent}`,
      detail: failedAgent.error?.message ?? failedAgent.result,
      tags: ['party', 'agent-failure', failedAgent.agent],
      relatedCommands: ['party'],
    });
  }

  if (failedAgents.length > 0) {
    process.exitCode = 1;
    try {
      const { captureFailureLessons } = await import('../../cli/commands/lessons.js');
      const failures = failedAgents.map(entry => ({
        task: `${entry.agent} agent`,
        error: entry.result.split('\n')[2] ?? 'unknown error',
      }));
      await captureFailureLessons(failures, 'party failure');
    } catch {
      // Lessons capture should not block party mode.
    }
  }

  logger.info('');
  logger.info('='.repeat(60));
  logger.info('  DANTE PARTY MODE - RESULTS SUMMARY');
  logger.info('='.repeat(60));

  for (const { agent, result, durationMs, success } of results) {
    const durationSec = (durationMs / 1000).toFixed(1);
    const previewLines = result.split('\n').slice(0, 3).join(' | ');
    const preview = previewLines.length > 120 ? `${previewLines.substring(0, 120)}...` : previewLines;

    logger.info('');
    if (success) {
      logger.success(`[${agent.toUpperCase()}] (${durationSec}s)`);
    } else {
      logger.warn(`[${agent.toUpperCase()}] (${durationSec}s)`);
    }
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

  if (worktreePaths.length > 0) {
    const activeWorktrees = await listWorktrees();
    if (activeWorktrees.length > 0) {
      logger.info(`Active DanteForge worktrees: ${activeWorktrees.length}`);
    }
    await cleanupWorktrees(activeAgents);
  }

  const totalDurationSec = ((Date.now() - partyStart) / 1000).toFixed(1);
  logger.info('');
  if (failedAgents.length > 0) {
    logger.warn(`Dante Party Mode completed with failures - ${results.length - failedAgents.length}/${results.length} agent(s) succeeded, ${totalDurationSec}s total`);
  } else {
    logger.success(`Dante Party Mode complete - ${results.length} agent(s), ${totalDurationSec}s total`);
  }
}

export async function cleanupWorktrees(agents: string[]): Promise<void> {
  logger.info('Cleaning up agent worktrees...');

  for (const agent of agents) {
    const safeName = agent.toLowerCase().replace(/\s+/g, '-');
    try {
      await removeAgentWorktree(safeName);
    } catch (err) {
      logger.warn(`Failed to remove worktree for "${agent}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.success('Agent worktree cleanup complete');
}
