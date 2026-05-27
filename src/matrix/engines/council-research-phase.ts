// Matrix Kernel — CouncilResearchPhase
//
// The research phase runs BEFORE and DURING the build phase. Codex and Grok
// divide all target dimensions between them, each doing a deep OSS dive to
// produce a precise FORGE_BRIEF per dimension. Claude Code reads these briefs
// before each build cycle, so every build is targeted rather than exploratory.
//
// Flow: divide dims → assign half to Codex, half to Grok → each researcher
//   runs its adapter with a research-focused prompt → parses response into a
//   ForgeBrief → writes to .danteforge/forge-briefs/<dimId>.json
//
// Research runs concurrently with the builder's first cycle. By the time Claude
// finishes building dims 1–4, all remaining briefs are ready.
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
  /** Which members do the research. Default: ['codex', 'grok-build'] */
  researchers?: CouncilMemberId[];
  /** Path to OSS harvest directory (for local repo scanning context). */
  ossHarvestPath?: string;
  /** Skip dims that already have a brief on disk (resume mode). Default: true */
  skipExisting?: boolean;
  /** Timeout per researcher in ms. Default: 300_000 (5 min) */
  timeoutMs?: number;
  /** Injection seam for tests */
  _runAdapter?: typeof runAdapter;
}

export interface ResearchPhaseResult {
  written: string[];
  skipped: string[];
  failed: string[];
}

function makeResearchWorkPacket(targets: ResearchTarget[], ossContext: string): WorkPacket {
  const dimList = targets.map(t =>
    `  - ${t.dimId} (${t.dimName}): current ${t.currentScore} → target ${t.targetScore}` +
    (t.ossLeader ? `, OSS leader: ${t.ossLeader}` : ''),
  ).join('\n');

  return {
    id: `research-phase.${Date.now()}`,
    dimensionId: 'research',
    objective: [
      'Research each dimension below and produce a FORGE_BRIEF JSON for each one.',
      'For each dimension, identify:',
      '  1. What OSS leaders do that this project does not (with specific file references if possible)',
      '  2. A numbered checklist of SPECIFIC things to implement to reach the target score',
      '     Each checklist item must have:',
      '       - id: "item-N"',
      '       - description: what to build',
      '       - productionCallsite: "src/module/file.ts:functionName"',
      '       - observableOutput: a log line, file path, or CLI output',
      '       - testCommand: "npx tsx --test tests/name.test.ts"',
      '       - effort: "S" | "M" | "L"',
      '',
      'Dimensions to research:',
      dimList,
      '',
      ossContext,
      '',
      'Output format — for EACH dimension, output a JSON block wrapped in:',
      '```forge-brief',
      '{ "dimId": "...", "dimName": "...", "ossCapabilities": [...], "checklist": [...] }',
      '```',
      '',
      'Be specific and actionable. No vague advice. Real file paths and function names.',
    ].join('\n'),
    acceptanceCriteria: [
      'Each dimension has a forge-brief JSON block in the output',
      'Each checklist item has all required fields',
      'OSS capabilities reference real tools by name',
    ],
    proof: { proofRequired: ['forge-brief JSON blocks present in output'] },
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
    return `Available OSS repos in harvest (reference these for patterns):\n${repos.map(r => `  - ${r}`).join('\n')}`;
  } catch {
    return '';
  }
}

function parseForgeBriefs(
  output: string,
  targets: ResearchTarget[],
  researchedBy: string,
): ForgeBrief[] {
  const briefs: ForgeBrief[] = [];
  const briefRegex = /```forge-brief\s*([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = briefRegex.exec(output)) !== null) {
    try {
      const raw = JSON.parse(match[1]!.trim()) as {
        dimId?: string;
        dimName?: string;
        ossCapabilities?: OssCapability[];
        checklist?: ChecklistItem[];
      };

      if (!raw.dimId) continue;
      const target = targets.find(t => t.dimId === raw.dimId);
      if (!target) continue;

      briefs.push({
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
      });
    } catch {
      logger.warn('[research-phase] Failed to parse a forge-brief JSON block — skipping');
    }
  }
  return briefs;
}

function makeAdapter(memberId: CouncilMemberId, workPacket: WorkPacket) {
  switch (memberId) {
    case 'codex':      return new CodexAdapter({ workPacket });
    case 'grok-build': return new GrokBuildAdapter({ workPacket });
    default:           return new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
  }
}

async function runResearcher(
  memberId: CouncilMemberId,
  targets: ResearchTarget[],
  projectPath: string,
  ossContext: string,
  timeoutMs: number,
  _run: typeof runAdapter,
): Promise<AgentRunResult> {
  const workPacket = makeResearchWorkPacket(targets, ossContext);
  const lease = makeResearchLease(projectPath);
  const adapter = makeAdapter(memberId, workPacket);

  try {
    const available = await adapter.isAvailable();
    if (!available) {
      return { output: '', exitCode: 1, filesChanged: [] } as AgentRunResult;
    }
    const timeoutPromise = new Promise<AgentRunResult>((_, reject) =>
      setTimeout(() => reject(new Error(`Research timeout after ${timeoutMs}ms`)), timeoutMs),
    );
    return await Promise.race([_run(adapter, { lease }), timeoutPromise]);
  } catch (err) {
    logger.warn(`[research-phase] ${memberId} failed: ${String(err).split('\n')[0]}`);
    return { output: '', exitCode: 1, filesChanged: [] } as AgentRunResult;
  }
}

export async function runResearchPhase(
  opts: ResearchPhaseOptions,
): Promise<ResearchPhaseResult> {
  const {
    projectPath,
    targets,
    researchers = ['codex', 'grok-build'],
    ossHarvestPath,
    skipExisting = true,
    timeoutMs = 300_000,
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

  // Divide dims evenly among researchers
  const chunks: ResearchTarget[][] = Array.from({ length: researchers.length }, () => []);
  toResearch.forEach((t, i) => chunks[i % researchers.length]!.push(t));

  logger.info(`[research-phase] Dividing ${toResearch.length} dims across ${researchers.length} researcher(s):`);
  researchers.forEach((r, i) => {
    logger.info(`  ${r}: ${(chunks[i] ?? []).map(t => t.dimId).join(', ')}`);
  });

  const researchPromises = researchers.map(async (memberId, i) => {
    const chunk = chunks[i] ?? [];
    if (chunk.length === 0) return;

    logger.info(`[research-phase] ${memberId} researching ${chunk.length} dim(s)...`);
    const runResult = await runResearcher(memberId, chunk, projectPath, ossContext, timeoutMs, _run);

    const briefs = parseForgeBriefs(runResult.output ?? '', chunk, memberId);
    logger.info(`[research-phase] ${memberId} produced ${briefs.length}/${chunk.length} briefs`);

    for (const brief of briefs) {
      await saveForgeBrief(projectPath, brief);
      result.written.push(brief.dimId);
      logger.info(`[research-phase] Wrote brief for ${brief.dimId} (${brief.checklist.length} checklist items)`);
    }

    const missing = chunk.filter(t => !briefs.some(b => b.dimId === t.dimId));
    result.failed.push(...missing.map(t => t.dimId));
    if (missing.length > 0) {
      logger.warn(`[research-phase] ${memberId} produced no brief for: ${missing.map(t => t.dimId).join(', ')}`);
    }
  });

  await Promise.allSettled(researchPromises);
  return result;
}
