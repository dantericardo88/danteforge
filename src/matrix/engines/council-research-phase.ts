// Matrix Kernel — CouncilResearchPhase
//
// Research phase: Claude Code, Codex, and Grok each own 1/3 of the dims.
// Each dim gets its OWN focused API call (not a batch). All calls run in
// parallel (up to concurrencyLimit). This avoids the timeout that occurs
// when one call tries to produce 12 FORGE_BRIEFs at once.
//
// Storage: .danteforge/forge-briefs/<dimId>.json
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { GrokBuildAdapter } from '../adapters/grok-build-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { AgentRunResult } from '../types/agent.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentLease } from '../types/lease.js';
import type { CouncilMemberId } from './council-scheduler.js';
import { makeReadOnlyLease } from './council-worktree.js';
import {
  saveForgeBrief,
  loadForgeBrief,
} from './council-forge-brief.js';
import type { ForgeBrief, OssCapability, ChecklistItem } from './council-forge-brief.js';

export interface ResearchTarget {
  dimId: string;
  dimName: string;
  currentScore: number;
  targetScore: number;
  ossLeader?: string;
  gap?: number;
}

export interface ResearchPhaseOptions {
  projectPath: string;
  targets: ResearchTarget[];
  /** Which members do the research. Default: ['claude-code', 'codex', 'grok-build'] */
  researchers?: CouncilMemberId[];
  /** Path to OSS harvest directory (for local repo scanning context). */
  ossHarvestPath?: string;
  /** Skip dims that already have a brief on disk (resume mode). Default: true */
  skipExisting?: boolean;
  /** Timeout per individual dim call in ms. Default: 600_000 (10 min) */
  timeoutMs?: number;
  /** Max parallel dim research calls. Default: 6 */
  concurrencyLimit?: number;
  /** Max retries per dim if adapter returns unparseable output. Default: 2 */
  maxRetries?: number;
  /** Called on each dim status change. */
  onProgress?: (dimId: string, status: "started" | "done" | "failed" | "retry", researcher: string) => void;
  /** Sleep seam for tests. */
  _sleep?: (ms: number) => Promise<void>;
  /** Injection seam for tests */
  _runAdapter?: typeof runAdapter;
}

export interface ResearchPhaseResult {
  written: string[];
  skipped: string[];
  failed: string[];
}

/** Build a focused research prompt for a SINGLE dimension. */
function makeDimResearchPacket(target: ResearchTarget, ossContext: string): WorkPacket {
  return {
    id: `research.${target.dimId}.${Date.now()}`,
    dimensionId: target.dimId,
    objective: [
      `Research the "${target.dimName}" dimension for DanteForge (current score: ${target.currentScore}/10, target: ${target.targetScore}/10).`,
      target.ossLeader ? `OSS leader to study: ${target.ossLeader}` : '',
      '',
      'Your job: produce ONE precise FORGE_BRIEF JSON block that tells the builder exactly what to implement.',
      '',
      'Required output — a single JSON block:',
      '```forge-brief',
      JSON.stringify({
        dimId: target.dimId,
        dimName: target.dimName,
        ossCapabilities: [
          {
            leader: '<OSS tool name>',
            capability: '<what they do>',
            theirImplementation: '<their specific file/function/approach>',
            ourGap: '<what we are missing>',
          },
        ],
        checklist: [
          {
            id: 'item-1',
            description: '<specific thing to implement>',
            productionCallsite: 'src/<file>.ts:<functionName>',
            observableOutput: '<log line, file path, or CLI output that proves it ran>',
            testCommand: 'npx tsx --test tests/<name>.test.ts',
            effort: 'S | M | L',
          },
        ],
      }, null, 2),
      '```',
      '',
      'Rules:',
      '  - ossCapabilities: 2–4 items, each citing a REAL OSS tool (e.g. Aider, OpenHands, CrewAI, MetaGPT)',
      '  - checklist: 3–6 specific build tasks, each with a REAL src/ callsite and observable output',
      '  - No vague advice. No "improve X". Name functions, file paths, log lines.',
      '  - Every checklist item must answer: what production function calls it, what output proves it ran',
      '',
      ossContext,
    ].filter(Boolean).join('\n'),
    acceptanceCriteria: [
      'Exactly one forge-brief JSON block in output',
      'dimId matches the requested dimension',
      'Each checklist item has productionCallsite and observableOutput',
    ],
    proof: { proofRequired: ['forge-brief JSON block present'] },
    globalForbidden: [
      '.danteforge/compete/matrix.json',
      '.danteforge/score-proposals/**',
      'node_modules/**',
      'dist/**',
    ],
    context: { mode: 'research-only' },
  } as unknown as WorkPacket;
}

function makeResearchLease(projectPath: string): AgentLease {
  return makeReadOnlyLease(projectPath, 'research');
}

async function buildOssContext(ossHarvestPath?: string): Promise<string> {
  if (!ossHarvestPath) return '';
  try {
    const entries = await fs.readdir(ossHarvestPath, { withFileTypes: true });
    const repos = entries.filter(e => e.isDirectory()).map(e => e.name).slice(0, 20);
    if (repos.length === 0) return '';
    return `Available OSS repos in harvest directory (reference these for patterns):\n${repos.map(r => `  - ${r}`).join('\n')}`;
  } catch {
    return '';
  }
}

function parseForgeBrief(
  output: string,
  target: ResearchTarget,
  researchedBy: string,
): ForgeBrief | null {
  const briefRegex = /```forge-brief\s*([\s\S]*?)```/;
  const match = briefRegex.exec(output);
  if (!match) return null;

  try {
    const raw = JSON.parse(match[1]!.trim()) as {
      dimId?: string;
      dimName?: string;
      ossCapabilities?: OssCapability[];
      checklist?: ChecklistItem[];
    };

    if (!raw.dimId || raw.dimId !== target.dimId) return null;

    return {
      dimId: raw.dimId,
      dimName: raw.dimName ?? target.dimName,
      currentScore: target.currentScore,
      targetScore: target.targetScore,
      researchedBy,
      researchedAt: new Date().toISOString(),
      ossCapabilities: raw.ossCapabilities ?? [],
      checklist: (raw.checklist ?? []).map((item, i) => ({
        id: item.id ?? `item-${i + 1}`,
        description: item.description ?? '',
        productionCallsite: item.productionCallsite ?? '',
        observableOutput: item.observableOutput ?? '',
        testCommand: item.testCommand ?? '',
        effort: item.effort ?? 'M',
        completed: false,
      })),
      completionState: {
        lastChecked: new Date().toISOString(),
        itemsComplete: [],
        itemsMissing: (raw.checklist ?? []).map((item, i) => item.id ?? `item-${i + 1}`),
        projectedScore: target.currentScore,
      },
      verificationHistory: [],
    };
  } catch {
    logger.verbose(`[research-phase] Failed to parse forge-brief JSON for ${target.dimId}`);
    return null;
  }
}

function makeAdapter(memberId: CouncilMemberId, workPacket: WorkPacket) {
  switch (memberId) {
    case 'codex':      return new CodexAdapter({ workPacket });
    case 'grok-build': return new GrokBuildAdapter({ workPacket });
    default:           return new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
  }
}

async function runDimResearch(
  memberId: CouncilMemberId,
  target: ResearchTarget,
  projectPath: string,
  ossContext: string,
  timeoutMs: number,
  _run: typeof runAdapter,
  skipAvailabilityCheck = false,
): Promise<AgentRunResult> {
  const workPacket = makeDimResearchPacket(target, ossContext);
  const lease = makeResearchLease(projectPath);
  const adapter = makeAdapter(memberId, workPacket);

  try {
    if (!skipAvailabilityCheck) {
      const available = await adapter.isAvailable();
      if (!available) {
        return { output: '', exitCode: 1, filesChanged: [] } as AgentRunResult;
      }
    }
    const timeoutPromise = new Promise<AgentRunResult>((_, reject) =>
      setTimeout(() => reject(new Error(`Research timeout after ${timeoutMs}ms for ${target.dimId}`)), timeoutMs),
    );
    return await Promise.race([_run(adapter, { lease }), timeoutPromise]);
  } catch (err) {
    logger.verbose(`[research-phase] ${memberId}/${target.dimId} failed: ${String(err).split('\n')[0]}`);
    return { output: '', exitCode: 1, filesChanged: [] } as AgentRunResult;
  }
}

/** Run N async tasks with a concurrency ceiling. */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const myIdx = idx++;
      results[myIdx] = await tasks[myIdx]!();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

export async function runResearchPhase(
  opts: ResearchPhaseOptions,
): Promise<ResearchPhaseResult> {
  const {
    projectPath,
    targets,
    researchers = ['claude-code', 'codex', 'grok-build'],
    ossHarvestPath,
    skipExisting = true,
    timeoutMs = 600_000,
    concurrencyLimit = 6,
    maxRetries = 2,
    onProgress,
    _sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
    _runAdapter: _run = runAdapter,
  } = opts;

  const result: ResearchPhaseResult = { written: [], skipped: [], failed: [] };

  // Filter out targets that already have briefs (resume mode)
  let toResearch = targets;
  if (skipExisting) {
    const existing = await Promise.all(targets.map(t => loadForgeBrief(projectPath, t.dimId)));
    toResearch = targets.filter((_, i) => existing[i] === null);
    result.skipped.push(...targets.filter((_, i) => existing[i] !== null).map(t => t.dimId));
    if (result.skipped.length > 0) {
      logger.info(`[research-phase] Skipping ${result.skipped.length} dims with existing briefs`);
    }
  }

  if (toResearch.length === 0) {
    logger.info('[research-phase] All dims already have briefs — research phase skipped');
    return result;
  }

  const ossContext = await buildOssContext(ossHarvestPath);

  // Assign each dim to a researcher (round-robin by researcher index)
  const assignments: Array<{ memberId: CouncilMemberId; target: ResearchTarget }> = toResearch.map(
    (t, i) => ({ memberId: researchers[i % researchers.length]!, target: t }),
  );

  logger.info(`[research-phase] ${toResearch.length} dims → ${researchers.length} researcher(s), ${concurrencyLimit} parallel calls`);
  researchers.forEach(r => {
    const rDims = assignments.filter(a => a.memberId === r).map(a => a.target.dimId);
    if (rDims.length > 0) logger.info(`  ${r} (${rDims.length}): ${rDims.join(', ')}`);
  });

  // One focused API call per dim — run in parallel up to concurrencyLimit
  const isTestRun = opts._runAdapter !== undefined;
  const tasks = assignments.map(({ memberId, target }) => async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        onProgress?.(target.dimId, 'retry', memberId);
        await _sleep(2_000);
      }
      onProgress?.(target.dimId, 'started', memberId);
      logger.info(`[research-phase] ${memberId} → ${target.dimId} (${target.dimName})${attempt > 0 ? ` [retry ${attempt}]` : ''}`);
      const runResult = await runDimResearch(memberId, target, projectPath, ossContext, timeoutMs, _run, isTestRun);
      const output = runResult.finalMessage ?? (runResult as unknown as { output?: string }).output ?? '';
      const brief = parseForgeBrief(output, target, memberId);
      if (brief) {
        await saveForgeBrief(projectPath, brief);
        result.written.push(brief.dimId);
        logger.info(`[research-phase] ✓ ${brief.dimId} — ${brief.checklist.length} checklist item(s) (by ${memberId})`);
        onProgress?.(target.dimId, 'done', memberId);
        return;
      }
    }
    result.failed.push(target.dimId);
    logger.verbose(`[research-phase] ✗ ${memberId} produced no brief for ${target.dimId}`);
    onProgress?.(target.dimId, 'failed', memberId);
  });

  await runWithConcurrency(tasks, concurrencyLimit);
  logger.info(`[research-phase] Done: ${result.written.length} written, ${result.skipped.length} skipped, ${result.failed.length} failed`);
  return result;
}
