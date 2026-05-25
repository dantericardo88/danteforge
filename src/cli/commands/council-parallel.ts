// council-parallel.ts — True parallel council with git worktree isolation.
//
// All available council members attack the project simultaneously, each in
// their own git worktree on their own branch. They build different dimensions
// (assigned by council-scheduler), then cross-judge each other's diffs. Only
// council-approved diffs are merged into the main working tree.
//
// Structural enforcement:
//   • The member who builds is NEVER in the judge pool for their own diff
//   • Each builder gets an isolated worktree → zero git conflicts during builds
//   • `git apply --3way` on merge → conflicts are surfaced, not silently lost
//
// Usage: danteforge council --parallel --goal "..." [--loop] [--rounds N]
import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { discoverCouncil } from './council.js';
import type { CouncilMember } from './council.js';
import { CodexAdapter } from '../../matrix/adapters/codex-adapter.js';
import { GeminiCLIAdapter } from '../../matrix/adapters/gemini-cli-adapter.js';
import { GrokBuildAdapter } from '../../matrix/adapters/grok-build-adapter.js';
import { ClaudeCodeAdapter } from '../../matrix/adapters/claude-code-adapter.js';
import { runAdapter } from '../../matrix/adapters/adapter-interface.js';
import {
  createCouncilWorktrees,
  removeCouncilWorktrees,
} from '../../matrix/engines/council-worktree.js';
import type { CouncilWorktreeHandle } from '../../matrix/engines/council-worktree.js';
import {
  scheduleWork,
  buildDimGoal,
  groupByMember,
} from '../../matrix/engines/council-scheduler.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';
import { runMergeCourt } from '../../matrix/engines/council-merge-court.js';
import type { MergeCourtResult } from '../../matrix/engines/council-merge-court.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';

export interface ParallelCouncilOptions {
  cwd?: string;
  goal: string;
  maxRounds?: number;
  maxDimsPerRound?: number;
  minGap?: number;
  json?: boolean;
  loop?: boolean;
  /** Injection seam: override council discovery for tests */
  _discover?: () => Promise<CouncilMember[]>;
}

// ── Internal adapter + work packet factories ──────────────────────────────────

function makeBuildWorkPacket(goal: string, worktreePath: string): WorkPacket {
  return {
    id: `parallel-council.${Date.now()}`,
    dimensionId: 'parallel-build',
    objective: goal,
    acceptanceCriteria: [
      'Implement all requested improvements with no stubs or mocks in src/ files.',
      'Modified files must typecheck cleanly.',
      'Tests must exercise real code, not mocked internals.',
    ],
    proof: { proofRequired: ['git diff shows non-trivial changes', 'no jest.mock / vi.mock in src/'] },
    globalForbidden: [
      '.danteforge/compete/matrix.json',
      '.danteforge/score-proposals/**',
      'node_modules/**',
      'dist/**',
    ],
    context: { worktreePath },
  } as unknown as WorkPacket;
}

function makeBuildLease(worktreePath: string): AgentLease {
  return {
    id: `parallel-lease.${Date.now()}`,
    worktreePath,
    allowedWritePaths: ['src/**', 'tests/**', 'commands/**', 'scripts/**', '*.md', '*.json'],
    allowedReadPaths: ['**'],
    forbiddenPaths: [
      '.danteforge/compete/matrix.json',
      '.danteforge/score-proposals/**',
      'node_modules/**',
      'dist/**',
    ],
  } as unknown as AgentLease;
}

function makeBuilderAdapter(id: CouncilMemberId, workPacket: WorkPacket) {
  switch (id) {
    case 'codex':       return new CodexAdapter({ workPacket });
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket });
  }
}

// ── Round progress artifact ───────────────────────────────────────────────────

interface RoundSummary {
  round: number;
  mergeResults: Array<{ memberId: string; changedFiles: number; consensus: string; merged: boolean }>;
  mergedThisRound: number;
  totalMerged: number;
  ts: string;
}

async function writeProgress(cwd: string, summary: RoundSummary): Promise<void> {
  const p = path.join(cwd, '.danteforge', 'PARALLEL_COUNCIL_PROGRESS.json');
  await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => { /* ignore */ });
  await fs.writeFile(p, JSON.stringify(summary, null, 2), 'utf8').catch(() => { /* best-effort */ });
}

// ── Print round summary ───────────────────────────────────────────────────────

function printRoundSummary(results: MergeCourtResult[], round: number, totalMerged: number): void {
  logger.info(chalk.bold(`\n── Round ${round} results ──────────────────────────`));
  for (const r of results) {
    const icon = r.merged ? chalk.green('✓') : r.consensus === 'PASS' ? chalk.yellow('~') : chalk.red('✗');
    const verdictLine = r.verdicts.map(v =>
      `${v.judgeId}:${v.verdict === 'PASS' ? chalk.green('P') : v.verdict === 'FAIL' ? chalk.red('F') : chalk.yellow('?')}`,
    ).join(' ');
    logger.info(`  ${icon} ${chalk.bold(r.memberId)}  ${r.changedFiles.length} file(s)  ${r.consensus}  [${verdictLine}]`);
    if (r.mergeError) logger.info(chalk.dim(`     merge error: ${r.mergeError}`));
  }
  logger.info(chalk.dim(`  Total merged: ${totalMerged}`));
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runParallelCouncil(options: ParallelCouncilOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const maxRounds = options.maxRounds ?? (options.loop ? 10 : 1);

  logger.info(chalk.bold('\n=== DanteForge Parallel Council ==='));
  logger.info(chalk.dim('One who builds never judges. Each member gets an isolated git worktree.\n'));

  // Discover available members
  const discover = options._discover ?? discoverCouncil;
  const members = await discover();

  const available = members.filter(m => m.available).map(m => m.id as CouncilMemberId);

  for (const m of members) {
    logger.info(`  ${m.available ? chalk.green('✓') : chalk.dim('✗')}  ${m.label}`);
  }
  logger.info('');

  if (available.length < 2) {
    logger.error('Parallel council requires at least 2 available members. Install Codex, Gemini CLI, or Grok Build.');
    process.exitCode = 1;
    return;
  }

  logger.info(`${available.length} member(s) active: ${available.map(id => chalk.bold(id)).join(', ')}`);
  logger.info(`Goal: ${chalk.italic(options.goal)}\n`);

  let totalMerged = 0;

  for (let round = 1; round <= maxRounds; round++) {
    logger.info(chalk.cyan(`\n── Round ${round}/${maxRounds} ─────────────────────────────────────`));

    // Schedule dimensions across members
    const scheduled = await scheduleWork(available, cwd, {
      maxDims: options.maxDimsPerRound ?? available.length * 3,
      minGap: options.minGap,
    });

    if (scheduled.length === 0) {
      logger.info(chalk.green('No eligible dimensions found — all may be at frontier. Stopping.'));
      break;
    }

    const byMember = groupByMember(scheduled);
    logger.info(`Scheduled ${scheduled.length} dim(s) across ${byMember.size} member(s)`);
    for (const [memberId, dims] of byMember) {
      logger.info(`  ${chalk.bold(memberId)}: ${dims.map(d => d.dimensionId).join(', ')}`);
    }

    const runId = `r${round}.${Date.now()}`;
    const worktreeOpts = { projectPath: cwd, runId };

    // Create one worktree per available member
    const handles: CouncilWorktreeHandle[] = await createCouncilWorktrees(available, worktreeOpts);

    if (handles.length === 0) {
      logger.error('Could not create any worktrees. Check git state and working directory.');
      break;
    }

    try {
      // Run all builders in parallel — each in their own isolated worktree
      logger.info(`\nRunning ${handles.length} builder(s) in parallel...`);

      await Promise.allSettled(
        handles.map(async (handle) => {
          const memberId = handle.memberId as CouncilMemberId;
          const myDims = byMember.get(memberId) ?? [];

          if (myDims.length === 0) return;

          const goal = myDims.map(d => buildDimGoal(d, 'this project')).join('\n\n---\n\n');
          const workPacket = makeBuildWorkPacket(goal, handle.worktreePath);
          const lease = makeBuildLease(handle.worktreePath);
          const adapter = makeBuilderAdapter(memberId, workPacket);

          logger.info(`  [${chalk.bold(memberId)}] building ${myDims.length} dim(s)...`);
          try {
            const result = await runAdapter(adapter, { lease, cwd: handle.worktreePath });
            logger.info(`  [${chalk.bold(memberId)}] done: status=${result.status}, ${result.filesChanged.length} file(s) changed`);
          } catch (err) {
            logger.warn(`  [${chalk.bold(memberId)}] build failed: ${String(err)}`);
          }
        }),
      );

      // Run merge court — builder-never-judges is enforced structurally inside
      logger.info('\nRunning merge court...');
      const mergeResults = await runMergeCourt({
        projectPath: cwd,
        worktreeOpts,
        handles,
        allMemberIds: available,
        goal: options.goal,
      });

      const roundMerged = mergeResults.filter(r => r.merged).length;
      totalMerged += roundMerged;

      printRoundSummary(mergeResults, round, totalMerged);

      await writeProgress(cwd, {
        round, totalMerged,
        mergedThisRound: roundMerged,
        mergeResults: mergeResults.map(r => ({
          memberId: r.memberId, changedFiles: r.changedFiles.length,
          consensus: r.consensus, merged: r.merged,
        })),
        ts: new Date().toISOString(),
      });

      if (roundMerged === 0 && options.loop) {
        logger.info(chalk.yellow('\nNo merges approved this round. Stopping to avoid spinning.'));
        break;
      }

    } finally {
      await removeCouncilWorktrees(handles, worktreeOpts);
    }
  }

  logger.info(chalk.bold(`\n── Parallel Council Complete ───────────────────────`));
  logger.info(`Rounds run: ${Math.min(options.maxRounds ?? 1, maxRounds)}`);
  logger.info(`Total merges approved: ${chalk.bold(String(totalMerged))}`);
  logger.info(chalk.dim('Run `danteforge validate --all` to generate receipts for the new changes.'));

  if (options.json) {
    process.stdout.write(JSON.stringify({ totalMerged, maxRounds }, null, 2) + '\n');
  }
}
