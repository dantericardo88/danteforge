// Matrix Kernel — CouncilUniverseRunner
//
// Competitive universe research phase: council members (codex + claude-code) split
// the 24 matrix dims and conduct web-search-driven research to produce per-dim
// universe files at .danteforge/compete/universe/<dimId>.md.
//
// Universe files define exactly what 9+ looks like: OSS leaders, closed-source leaders,
// practitioner pain points (Reddit/Twitter/HN), a score ladder, and judge scoring
// criteria. These files are injected into builder and scorer prompts by council-forge-brief.ts.
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import { makeReadOnlyLease } from './council-worktree.js';
import { saveUniverseFile } from './council-forge-brief.js';
import type { CouncilMemberId } from './council-scheduler.js';

export interface UniverseTarget {
  dimId: string;
  dimName: string;
  currentScore: number;
  targetScore: number;
  ossLeader?: string;
}

export interface UniverseResearchOptions {
  projectPath: string;
  targets: UniverseTarget[];
  /** Members that perform research. Default: ['claude-code', 'codex'] */
  researchers?: Array<'claude-code' | 'codex'>;
  /** Skip dims that already have a universe file on disk. Default: true */
  skipExisting?: boolean;
  /** Timeout per dim in ms. Default: 600_000 (10 min) */
  timeoutMs?: number;
  /** Max parallel dim research calls. Default: 4 */
  concurrencyLimit?: number;
  /** Max retries per dim if output is too short. Default: 2 */
  maxRetries?: number;
  /** Progress callback */
  onProgress?: (dimId: string, status: 'started' | 'done' | 'failed', researcher: string) => void;
  /** Injection seam for tests */
  _runAdapter?: typeof runAdapter;
}

export interface UniverseResearchResult {
  written: string[];
  skipped: string[];
  failed: string[];
}

function universeDir(projectPath: string): string {
  return path.join(projectPath, '.danteforge', 'compete', 'universe');
}

async function existsUniverseFile(projectPath: string, dimId: string): Promise<boolean> {
  try {
    await fs.access(path.join(universeDir(projectPath), `${dimId}.md`));
    return true;
  } catch { return false; }
}

function makeUniversePacket(target: UniverseTarget, researcher: string): WorkPacket {
  const timestamp = new Date().toISOString();
  const ossHint = target.ossLeader
    ? `Known OSS leader to study in depth: **${target.ossLeader}**`
    : 'Find the best OSS tool for this dimension yourself (e.g. Aider, OpenHands, CrewAI, MetaGPT, SWE-agent, AutoGen, Codex).';

  return {
    id: `universe.${target.dimId}.${Date.now()}`,
    dimensionId: target.dimId,
    objective: [
      `Research the **${target.dimName}** dimension for an AI coding assistant CLI. Act as a competitive intelligence analyst.`,
      ``,
      `Current score: ${target.currentScore}/10. Target: 9+.`,
      ossHint,
      ``,
      `## Research tasks`,
      ``,
      `1. **GitHub** — Find the top 1-2 OSS tools for "${target.dimName}" in AI coding assistants.`,
      `   Read their README and 2-3 key source files to understand their implementation approach.`,
      `   Name specific functions, algorithms, or patterns they use.`,
      ``,
      `2. **Reddit** — Search r/MachineLearning, r/LocalLLaMA, r/ChatGPT, r/ClaudeAI`,
      `   for complaints, feature requests, and praise about "${target.dimName}".`,
      ``,
      `3. **Twitter/X and HN** — Find developer commentary on "${target.dimName}" for AI coding tools.`,
      ``,
      `4. **Technical papers or blog posts** — any canonical papers or posts about "${target.dimName}" for AI agents.`,
      ``,
      `## Required output`,
      ``,
      `Output EXACTLY this markdown structure. Fill every section with specific, actionable detail.`,
      `Do NOT add extra sections. Do NOT be vague ("improve X") — name real functions, file paths, log patterns.`,
      ``,
      `# Universe: ${target.dimName}`,
      `Generated: ${timestamp}`,
      `Researched by: ${researcher}`,
      ``,
      `## OSS Leader`,
      `**Name**: `,
      `**URL**: `,
      `**Key capability**: `,
      `**Implementation approach**: `,
      ``,
      `## Closed-Source Leader (if known)`,
      `**Name**: `,
      `**Key capability**: `,
      ``,
      `## Score Ladder`,
      `| Score | Evidence required for ${target.dimName} |`,
      `|-------|------------------------------------------|`,
      `| 5 | |`,
      `| 6 | |`,
      `| 7 | |`,
      `| 8 | |`,
      `| 9 | |`,
      `| 10 | |`,
      ``,
      `## What practitioners say (Reddit/Twitter/HN)`,
      `- `,
      `- `,
      ``,
      `## Key techniques that separate 9+ from 7`,
      `1. `,
      `2. `,
      `3. `,
      ``,
      `## Builder checklist for 9+`,
      `- [ ] `,
      `- [ ] `,
      ``,
      `## Judge scoring criteria`,
      `**PASS at 9 requires**: `,
      `**Red flags capping at ≤7**: `,
      `**Evidence to look for in a diff**: `,
    ].join('\n'),
    acceptanceCriteria: [
      'Output contains "# Universe:" header',
      'Score Ladder section is present',
      'Judge scoring criteria section is present',
    ],
    proof: { proofRequired: ['Universe markdown present'] },
    globalForbidden: [
      '.danteforge/compete/matrix.json',
      '.danteforge/score-proposals/**',
    ],
    context: { mode: 'research-only' },
  } as unknown as WorkPacket;
}

function makeAdapter(memberId: 'claude-code' | 'codex', workPacket: WorkPacket) {
  if (memberId === 'codex') return new CodexAdapter({ workPacket });
  return new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
}

async function runDimUniverse(
  memberId: 'claude-code' | 'codex',
  target: UniverseTarget,
  projectPath: string,
  timeoutMs: number,
  maxRetries: number,
  _run: typeof runAdapter,
  onProgress?: UniverseResearchOptions['onProgress'],
): Promise<string | null> {
  onProgress?.(target.dimId, 'started', memberId);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const workPacket = makeUniversePacket(target, memberId);
    const lease = makeReadOnlyLease(projectPath, 'universe-research');
    const adapter = makeAdapter(memberId, workPacket);

    try {
      const available = await adapter.isAvailable();
      if (!available) {
        logger.warn(`[universe] ${memberId} not available — skipping ${target.dimId}`);
        onProgress?.(target.dimId, 'failed', memberId);
        return null;
      }

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
      );
      const result = await Promise.race([_run(adapter, { lease }), timeoutPromise]);
      const output = result.output ?? '';

      if (output.length < 300) {
        if (attempt < maxRetries) {
          logger.verbose(`[universe] ${target.dimId} output too short (${output.length} chars), retry ${attempt + 1}/${maxRetries}`);
          continue;
        }
        logger.warn(`[universe] ${target.dimId} output too short after ${maxRetries} retries`);
        onProgress?.(target.dimId, 'failed', memberId);
        return null;
      }

      onProgress?.(target.dimId, 'done', memberId);
      return output;
    } catch (err) {
      logger.verbose(`[universe] ${memberId}/${target.dimId} attempt ${attempt + 1} failed: ${String(err).split('\n')[0]}`);
      if (attempt >= maxRetries) {
        onProgress?.(target.dimId, 'failed', memberId);
        return null;
      }
    }
  }

  onProgress?.(target.dimId, 'failed', memberId);
  return null;
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
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

export async function runCouncilUniversePhase(
  opts: UniverseResearchOptions,
): Promise<UniverseResearchResult> {
  const {
    projectPath,
    targets,
    researchers = ['claude-code', 'codex'],
    skipExisting = true,
    timeoutMs = 600_000,
    concurrencyLimit = 4,
    maxRetries = 2,
    onProgress,
    _runAdapter: _run = runAdapter,
  } = opts;

  const result: UniverseResearchResult = { written: [], skipped: [], failed: [] };

  let toResearch = targets;
  if (skipExisting) {
    const existChecks = await Promise.all(targets.map(t => existsUniverseFile(projectPath, t.dimId)));
    toResearch = targets.filter((_, i) => !existChecks[i]);
    const skipped = targets.filter((_, i) => existChecks[i]);
    result.skipped.push(...skipped.map(t => t.dimId));
    if (skipped.length > 0) {
      logger.info(`[universe] Skipping ${skipped.length} dims with existing universe files (use --no-skip-existing to force)`);
    }
  }

  if (toResearch.length === 0) {
    logger.info('[universe] All dims already have universe files — phase skipped');
    return result;
  }

  logger.info(`[universe] Researching ${toResearch.length} dims across ${researchers.length} member(s): ${researchers.join(', ')}`);

  const assignments = toResearch.map(
    (t, i) => ({ memberId: researchers[i % researchers.length] as 'claude-code' | 'codex', target: t }),
  );

  const tasks = assignments.map(({ memberId, target }) => async () => {
    const output = await runDimUniverse(memberId, target, projectPath, timeoutMs, maxRetries, _run, onProgress);
    if (output === null) {
      result.failed.push(target.dimId);
      return;
    }
    await saveUniverseFile(projectPath, target.dimId, output);
    result.written.push(target.dimId);
    logger.info(`[universe] ✓ ${target.dimId} (${memberId})`);
  });

  await runWithConcurrency(tasks, concurrencyLimit);

  logger.info(`[universe] Done — written: ${result.written.length}, skipped: ${result.skipped.length}, failed: ${result.failed.length}`);
  return result;
}
