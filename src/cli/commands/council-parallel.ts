// council-parallel.ts — True parallel council with git worktree isolation.
//
// All available council members attack the project simultaneously, each in
// their own git worktree on their own branch. They build different dimensions
// (assigned by council-scheduler with profile-aware routing), then cross-judge
// each other's diffs. Only council-approved diffs are merged into the main
// working tree.
//
// Five structural guarantees:
//   1. Builder-never-judges: enforced at the type level in merge-court
//   2. Worktree isolation: each member gets its own git branch + working tree
//   3. File-claim registry: two builders cannot merge changes to the same file
//   4. Convergence detection: stuck dims are pruned after N failed attempts
//   5. Auto-validate feedback: after merges, receipts are written and scores updated
//
// Usage: danteforge council --parallel --goal "..." [--loop] [--rounds N]
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
  getChangedFiles,
} from '../../matrix/engines/council-worktree.js';
import type { CouncilWorktreeHandle } from '../../matrix/engines/council-worktree.js';
import {
  scheduleWork,
  buildDimGoal,
  groupByMember,
} from '../../matrix/engines/council-scheduler.js';
import type { CouncilMemberId, ScheduledDimension } from '../../matrix/engines/council-scheduler.js';
import { runMergeCourt } from '../../matrix/engines/council-merge-court.js';
import type { MergeCourtResult } from '../../matrix/engines/council-merge-court.js';
import { FileClaims } from '../../matrix/engines/council-file-claims.js';
import { ConvergenceTracker } from '../../matrix/engines/council-convergence.js';
import { MemberHealthTracker, isQuotaError } from '../../matrix/engines/council-member-health.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';

const execFileAsync = promisify(execFile);

export interface ParallelCouncilOptions {
  cwd?: string;
  goal: string;
  maxRounds?: number;
  maxDimsPerRound?: number;
  minGap?: number;
  json?: boolean;
  loop?: boolean;
  /** Skip running danteforge validate after merges (faster, but no receipts). */
  skipValidate?: boolean;
  /** Injection seam: override council discovery for tests */
  _discover?: () => Promise<CouncilMember[]>;
}

// ── Adapter factories ─────────────────────────────────────────────────────────

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

// ── Post-merge validate (auto-receipt generation) ─────────────────────────────

async function runPostMergeValidate(cwd: string, mergedDims: string[]): Promise<void> {
  if (mergedDims.length === 0) return;
  logger.info(chalk.dim(`  [validate] Running validate for ${mergedDims.length} merged dim(s)...`));
  for (const dimId of mergedDims) {
    try {
      await execFileAsync('node', ['dist/index.js', 'validate', dimId], {
        cwd, timeout: 120_000,
        env: { ...process.env, DANTEFORGE_MATRIX_MERGE_RECEIPT: '1' },
      });
      logger.info(chalk.dim(`  [validate] ${dimId} ✓`));
    } catch {
      logger.info(chalk.dim(`  [validate] ${dimId} — no outcome defined or failed (ok at breadth stage)`));
    }
  }
}

// ── Progress artifact ─────────────────────────────────────────────────────────

interface RoundSummary {
  round: number;
  mergedThisRound: number;
  totalMerged: number;
  memberResults: Array<{ memberId: string; files: number; consensus: string; merged: boolean }>;
  convergence: { converged: number; stuck: number; inProgress: number };
  ts: string;
}

async function writeProgress(cwd: string, summary: RoundSummary): Promise<void> {
  const p = path.join(cwd, '.danteforge', 'PARALLEL_COUNCIL_PROGRESS.json');
  await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => { /* ignore */ });
  await fs.writeFile(p, JSON.stringify(summary, null, 2), 'utf8').catch(() => { /* best-effort */ });
}

// ── Round summary logging ─────────────────────────────────────────────────────

function printRoundSummary(results: MergeCourtResult[], round: number, totalMerged: number): void {
  logger.info(chalk.bold(`\n── Round ${round} results ─────────────────────────────`));
  for (const r of results) {
    const icon = r.merged ? chalk.green('✓') : r.consensus === 'PASS' ? chalk.yellow('~') : chalk.red('✗');
    const vline = r.verdicts.map(v =>
      `${v.judgeId}:${v.verdict === 'PASS' ? chalk.green('P') : v.verdict === 'FAIL' ? chalk.red('F') : chalk.yellow('?')}`,
    ).join(' ');
    logger.info(`  ${icon} ${chalk.bold(r.memberId.padEnd(14))} ${r.changedFiles.length} file(s)  ${r.consensus}  [${vline || 'no judges'}]`);
    if (r.mergeError) logger.info(chalk.dim(`     merge error: ${r.mergeError}`));
  }
  logger.info(chalk.dim(`  Total merged: ${totalMerged}`));
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runParallelCouncil(options: ParallelCouncilOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const maxRounds = options.maxRounds ?? (options.loop ? 10 : 1);

  logger.info(chalk.bold('\n=== DanteForge Parallel Council ==='));
  logger.info(chalk.dim('Builder never judges. Isolated worktrees. File claims prevent conflicts.\n'));

  const discover = options._discover ?? discoverCouncil;
  const members = await discover();
  const available = members.filter(m => m.available).map(m => m.id as CouncilMemberId);

  for (const m of members) {
    logger.info(`  ${m.available ? chalk.green('✓') : chalk.dim('✗')}  ${m.label}`);
  }
  logger.info('');

  if (available.length < 2) {
    logger.error('Parallel council requires at least 2 available members.');
    process.exitCode = 1;
    return;
  }

  logger.info(`${available.length} member(s): ${available.map(id => chalk.bold(id)).join(', ')}`);
  logger.info(`Goal: ${chalk.italic(options.goal)}\n`);

  // Session-level state
  const convergence = new ConvergenceTracker(3);
  const health = new MemberHealthTracker();
  let totalMerged = 0;

  for (let round = 1; round <= maxRounds; round++) {
    logger.info(chalk.cyan(`\n── Round ${round}/${maxRounds} ─────────────────────────────────────`));

    // Drop members that exhausted quota or degraded this session
    const roundMembers = health.getActiveMembers(available);
    if (roundMembers.length < 2) {
      logger.error(chalk.red('Council quorum lost — fewer than 2 active members. Stopping.'));
      const degraded = health.getStatus().filter(h => h.status !== 'active');
      if (degraded.length > 0) {
        logger.warn(chalk.yellow(`  Unavailable: ${degraded.map(h => `${h.id} (${h.status})`).join(', ')}`));
      }
      break;
    }
    if (roundMembers.length < available.length) {
      const removed = available.filter(id => !roundMembers.includes(id));
      logger.warn(chalk.yellow(`  Degraded member(s) excluded this round: ${removed.join(', ')}`));
    }

    // Schedule dims — prune stuck dims so we don't retry known dead-ends
    const allScheduled = await scheduleWork(roundMembers, cwd, {
      maxDims: options.maxDimsPerRound ?? roundMembers.length * 3,
      minGap: options.minGap,
    });
    const scheduled = convergence.pruneStuck(allScheduled);

    if (scheduled.length === 0) {
      logger.info(chalk.green('No eligible dimensions left. Frontier or convergence limit reached.'));
      break;
    }

    const byMember = groupByMember(scheduled);
    logger.info(`Scheduled ${scheduled.length} dim(s) across ${byMember.size} member(s):`);
    for (const [id, dims] of byMember) {
      logger.info(`  ${chalk.bold(id)}: ${dims.map(d => d.dimensionId).join(', ')}`);
    }

    const runId = `r${round}.${Date.now()}`;
    const worktreeOpts = { projectPath: cwd, runId };
    const fileClaims = new FileClaims();

    const handles: CouncilWorktreeHandle[] = await createCouncilWorktrees(roundMembers, worktreeOpts);
    if (handles.length === 0) {
      logger.error('Could not create worktrees. Check git state.');
      break;
    }

    try {
      // Run all builders in parallel, each in their isolated worktree
      logger.info(`\nRunning ${handles.length} builder(s) in parallel...`);

      await Promise.allSettled(
        handles.map(async (handle) => {
          const memberId = handle.memberId as CouncilMemberId;
          const myDims = byMember.get(memberId) ?? [];
          if (myDims.length === 0) return;

          const goal = myDims.map(d => buildDimGoal(d, 'this project')).join('\n\n---\n\n');
          const wp = makeBuildWorkPacket(goal, handle.worktreePath);
          const lease = makeBuildLease(handle.worktreePath);
          const adapter = makeBuilderAdapter(memberId, wp);

          logger.info(`  [${chalk.bold(memberId)}] building ${myDims.length} dim(s)...`);
          try {
            const result = await runAdapter(adapter, { lease, cwd: handle.worktreePath });
            health.recordSuccess(memberId);
            logger.info(`  [${chalk.bold(memberId)}] done: ${result.status}, ${result.filesChanged.length} file(s)`);
          } catch (err) {
            const errStr = String(err);
            const exitCode = (err as NodeJS.ErrnoException & { code?: number }).code;
            health.recordFailure(memberId, errStr, typeof exitCode === 'number' ? exitCode : undefined);
            if (!health.isAvailable(memberId)) {
              logger.warn(chalk.yellow(`  [${chalk.bold(memberId)}] removed from session: ${health.getStatus().find(h => h.id === memberId)?.status}`));
            } else {
              logger.warn(`  [${chalk.bold(memberId)}] build failed: ${errStr}`);
            }
          }
        }),
      );

      // Register file claims BEFORE merge court to detect cross-member conflicts
      for (const handle of handles) {
        const changed = await getChangedFiles(handle.worktreePath);
        const claim = fileClaims.claim(handle.memberId as CouncilMemberId, changed);
        if (claim.conflicts.length > 0) {
          logger.warn(`  [${handle.memberId}] ${claim.conflicts.length} file conflict(s): ${claim.conflicts.map(c => `${c.file} (claimed by ${c.claimedBy})`).join(', ')}`);
        }
      }

      // Run merge court — fileClaims enforced structurally (not advisory)
      logger.info('\nRunning merge court...');
      const mergeResults = await runMergeCourt({
        projectPath: cwd,
        worktreeOpts,
        handles,
        allMemberIds: available,
        goal: options.goal,
        fileClaims,
      });

      const roundMerged = mergeResults.filter(r => r.merged).length;
      totalMerged += roundMerged;

      printRoundSummary(mergeResults, round, totalMerged);

      // Record convergence for each dim that was attempted
      const dimsByMember = new Map(
        [...byMember.entries()].map(([id, dims]) => [id, dims] as const),
      );
      for (const r of mergeResults) {
        const dims: ScheduledDimension[] = dimsByMember.get(r.memberId as CouncilMemberId) ?? [];
        for (const dim of dims) {
          convergence.record(dim.dimensionId, r.merged, round);
        }
      }

      const conv = convergence.summarize();
      if (conv.stuck > 0) {
        logger.warn(chalk.yellow(`  Stuck dims (${conv.stuck}): ${conv.stuckDims.map(d => d.dimensionId).join(', ')}`));
      }

      // Auto-validate merged dims to generate receipts
      if (!options.skipValidate && roundMerged > 0) {
        const mergedDimIds = mergeResults
          .filter(r => r.merged)
          .flatMap(r => (dimsByMember.get(r.memberId as CouncilMemberId) ?? []).map(d => d.dimensionId));
        await runPostMergeValidate(cwd, [...new Set(mergedDimIds)]);
      }

      await writeProgress(cwd, {
        round, totalMerged, mergedThisRound: roundMerged,
        memberResults: mergeResults.map(r => ({
          memberId: r.memberId, files: r.changedFiles.length,
          consensus: r.consensus, merged: r.merged,
        })),
        convergence: { converged: conv.converged, stuck: conv.stuck, inProgress: conv.inProgress },
        ts: new Date().toISOString(),
      });

      if (convergence.isDone()) {
        logger.info(chalk.green.bold('\nAll dimensions converged or stuck. Council complete.'));
        break;
      }

      if (roundMerged === 0 && options.loop) {
        logger.info(chalk.yellow('\nNo merges approved this round. Stopping to avoid spinning.'));
        break;
      }

    } finally {
      await removeCouncilWorktrees(handles, worktreeOpts);
    }
  }

  const finalConv = convergence.summarize();
  logger.info(chalk.bold(`\n── Parallel Council Complete ────────────────────────`));
  logger.info(`Rounds run:      ${Math.min(maxRounds, maxRounds)}`);
  logger.info(`Total merges:    ${chalk.bold(String(totalMerged))}`);
  logger.info(`Converged dims:  ${finalConv.converged}`);
  logger.info(`Stuck dims:      ${finalConv.stuck}`);
  if (finalConv.stuck > 0) {
    logger.info(chalk.yellow(`  Review these manually: ${finalConv.stuckDims.map(d => d.dimensionId).join(', ')}`));
  }
  logger.info(chalk.dim('Next: danteforge validate --all → danteforge compete'));

  if (options.json) {
    process.stdout.write(JSON.stringify({ totalMerged, maxRounds, convergence: finalConv }, null, 2) + '\n');
  }
}
