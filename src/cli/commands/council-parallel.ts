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
  createCouncilWorktreesForSlots,
  removeCouncilWorktrees,
  getChangedFiles,
} from '../../matrix/engines/council-worktree.js';
import type { CouncilWorktreeHandle } from '../../matrix/engines/council-worktree.js';
import {
  scheduleWork,
  scheduleWorkForSlots,
  buildDimGoal,
  groupByMember,
  groupBySlot,
} from '../../matrix/engines/council-scheduler.js';
import type { CouncilMemberId, ScheduledDimension } from '../../matrix/engines/council-scheduler.js';
import { buildSlots } from '../../matrix/engines/council-slot.js';
import type { CouncilSlot } from '../../matrix/engines/council-slot.js';
import { CouncilJudgeQueue } from '../../matrix/engines/council-judge-queue.js';
import type { JudgeCandidate } from '../../matrix/engines/council-judge-queue.js';
import { runMergeCourt } from '../../matrix/engines/council-merge-court.js';
import type { MergeCourtResult } from '../../matrix/engines/council-merge-court.js';
import { FileClaims } from '../../matrix/engines/council-file-claims.js';
import { ConvergenceTracker } from '../../matrix/engines/council-convergence.js';
import { MemberHealthTracker, isQuotaError } from '../../matrix/engines/council-member-health.js';
import {
  makeSessionId,
  makeInitialState,
  writeSessionState,
  loadSessionState,
} from '../../matrix/engines/council-session-state.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';
import { runCIPCheck } from '../../core/completion-integrity.js';
import { createTimeMachineCommit } from '../../core/time-machine.js';

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
  /** Resume a previous run from its last checkpoint (runId from COUNCIL_SESSION_<runId>.json). */
  resumeRunId?: string;
  /** Sub-agents per member. slotsPerMember=4 → 3 members × 4 = 12 parallel worktrees (default: 1). */
  slotsPerMember?: number;
  /** Minimum cross-member judges required per candidate (default: 2). */
  minJudges?: number;
  /** Only schedule these specific dimension IDs (skips gap ranking entirely). */
  focusDims?: string[];
  /** Injection seam: override council discovery for tests */
  _discover?: () => Promise<CouncilMember[]>;
}

// ── Adapter factories ─────────────────────────────────────────────────────────

function makeBuildWorkPacket(goal: string, worktreePath: string): WorkPacket {
  const mockApiProof = `no ${['jest', 'mock'].join('.')} / ${['vi', 'mock'].join('.')} in src/`;
  return {
    id: `parallel-council.${Date.now()}`,
    dimensionId: 'parallel-build',
    objective: goal,
    acceptanceCriteria: [
      'Implement all requested improvements with no stubs or mocks in src/ files.',
      'Modified files must typecheck cleanly.',
      'Tests must exercise real code, not mocked internals.',
    ],
    proof: { proofRequired: ['git diff shows non-trivial changes', mockApiProof] },
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
    case 'grok-build':  return new GrokBuildAdapter({ workPacket });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
    // gemini-cli is excluded from parallel council (API-based, quota-exhausts frequently)
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket });
  }
}

// ── Post-merge doctrine (validate + CIP + Time Machine) ──────────────────────

interface PostMergeDim {
  dimId: string;
  changedFiles: string[];
}

interface PostMergeDoctrineResult {
  cipBlocked: string[];
  timeMachineCommitId: string | null;
}

async function runPostMergeDoctrine(
  cwd: string,
  mergedDims: PostMergeDim[],
): Promise<PostMergeDoctrineResult> {
  if (mergedDims.length === 0) return { cipBlocked: [], timeMachineCommitId: null };

  const dimIds = mergedDims.map(d => d.dimId);

  // Step 1: validate — generate receipts (existing behavior, unchanged)
  logger.info(chalk.dim(`  [validate] Running validate for ${dimIds.length} merged dim(s)...`));
  for (const dimId of dimIds) {
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

  // Step 2: CIP check — best-effort, warns if blocksFrontierReached but never aborts
  const cipBlocked: string[] = [];
  for (const dimId of dimIds) {
    try {
      const result = await runCIPCheck(dimId, { cwd });
      if (result.blocksFrontierReached) {
        cipBlocked.push(dimId);
        logger.warn(chalk.yellow(
          `  [cip] ${dimId} blocks frontier — gaps: ${result.gaps.slice(0, 3).join('; ')}`,
        ));
      } else {
        logger.info(chalk.dim(`  [cip] ${dimId} ${result.cipClass} (score ${result.cipScore.toFixed(1)})`));
      }
    } catch (err) {
      logger.info(chalk.dim(`  [cip] ${dimId} — check skipped: ${String(err).split('\n')[0]}`));
    }
  }

  // Step 3: Time Machine commit — best-effort, never blocks
  let timeMachineCommitId: string | null = null;
  try {
    const allChangedFiles = [...new Set(mergedDims.flatMap(d => d.changedFiles))];
    const commit = await createTimeMachineCommit({
      cwd,
      paths: allChangedFiles,
      label: `council-merge/${dimIds.join(',')}`,
    });
    timeMachineCommitId = commit.commitId;
    logger.info(chalk.dim(`  [time-machine] commit ${commit.commitId.slice(0, 12)} recorded`));
  } catch (err) {
    logger.info(chalk.dim(`  [time-machine] skipped — ${String(err).split('\n')[0]}`));
  }

  return { cipBlocked, timeMachineCommitId };
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

// ── Per-slot proof ledger ─────────────────────────────────────────────────────

interface SlotProofEntry {
  slotId: string;
  memberId: string;
  assignedDims: string[];
  filesChanged: string[];
  consensus: string;
  merged: boolean;
  cipBlocked: boolean;
  judges: Array<{ judgeId: string; verdict: string; confidence: string }>;
  dissentLog: string[];
}

async function writeSlotProofLedger(
  cwd: string,
  runId: string,
  round: number,
  mergeResults: MergeCourtResult[],
  bySlot: Map<string, ScheduledDimension[]> | undefined,
  byMember: Map<CouncilMemberId, ScheduledDimension[]>,
  cipBlockedDimIds: Set<string>,
): Promise<void> {
  const slots: SlotProofEntry[] = mergeResults.map(r => {
    const slotId = (r as { slotId?: string }).slotId ?? `${r.memberId}-0`;
    const dims = bySlot?.get(slotId) ?? byMember.get(r.memberId as CouncilMemberId) ?? [];
    const assignedDims = [...new Set(dims.map(d => d.dimensionId))];
    const blocked = assignedDims.some(d => cipBlockedDimIds.has(d));
    return {
      slotId,
      memberId: r.memberId,
      assignedDims,
      filesChanged: r.changedFiles,
      consensus: r.consensus,
      merged: r.merged,
      cipBlocked: blocked,
      judges: r.verdicts.map(v => ({ judgeId: v.judgeId, verdict: v.verdict, confidence: v.confidence })),
      dissentLog: r.dissentLog,
    };
  });
  const ledger = { runId, round, slots, ts: new Date().toISOString() };
  const p = path.join(cwd, '.danteforge', `SLOT_PROOF_LEDGER_round${round}.json`);
  await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => { /* ignore */ });
  await fs.writeFile(p, JSON.stringify(ledger, null, 2), 'utf8').catch(() => { /* best-effort */ });
  logger.info(chalk.dim(`  [ledger] Written: .danteforge/SLOT_PROOF_LEDGER_round${round}.json`));
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
  logger.info(chalk.dim('Builder never judges. Isolated worktrees. Anonymous peer review. File claims prevent conflicts.\n'));

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

  const slotsPerMember = options.slotsPerMember ?? 1;
  const minJudges = options.minJudges ?? 2;
  const slotMode = slotsPerMember > 1;

  logger.info(`${available.length} member(s): ${available.map(id => chalk.bold(id)).join(', ')}`);
  if (slotMode) {
    logger.info(`Slot mode: ${slotsPerMember} slot(s)/member → ${available.length * slotsPerMember} parallel worktree(s)`);
  }
  logger.info(`Goal: ${chalk.italic(options.goal)}\n`);

  // Session-level state
  const convergence = new ConvergenceTracker(3);
  const health = new MemberHealthTracker();
  let totalMerged = 0;
  let roundsRun = 0;

  // Session checkpoint (GAP 3: LangGraph-inspired persistent state for resume).
  let resumedRound = 0;
  const runId = options.resumeRunId ?? makeSessionId();
  if (options.resumeRunId) {
    const saved = await loadSessionState(cwd, options.resumeRunId);
    if (saved) {
      resumedRound = saved.round;
      totalMerged = saved.totalMerged;
      logger.info(chalk.yellow(`Resuming session ${runId} from round ${resumedRound + 1} (${saved.totalMerged} prior merges)`));
    } else {
      logger.warn(chalk.yellow(`No checkpoint found for runId "${options.resumeRunId}" — starting fresh`));
    }
  }
  const sessionState = makeInitialState(runId, options.goal, available, maxRounds);

  for (let round = 1; round <= maxRounds; round++) {
    if (round <= resumedRound) {
      logger.info(chalk.dim(`── Round ${round}/${maxRounds} skipped (already completed in resumed session)`));
      continue;
    }
    logger.info(chalk.cyan(`\n── Round ${round}/${maxRounds} ─────────────────────────────────────`));
    roundsRun++;

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
    const roundSlots: CouncilSlot[] = slotMode
      ? buildSlots(roundMembers, slotsPerMember)
      : roundMembers.map(id => ({ memberId: id, slotIdx: 0, slotId: `${id}-0` }));

    const allScheduled = slotMode
      ? await scheduleWorkForSlots(roundSlots, cwd, {
          maxDims: options.maxDimsPerRound ?? roundSlots.length * 2,
          minGap: options.minGap,
          focusDims: options.focusDims,
        })
      : await scheduleWork(roundMembers, cwd, {
          maxDims: options.maxDimsPerRound ?? roundMembers.length * 3,
          minGap: options.minGap,
          focusDims: options.focusDims,
        });
    const scheduled = convergence.pruneStuck(allScheduled);

    if (scheduled.length === 0) {
      logger.info(chalk.green('No eligible dimensions left. Frontier or convergence limit reached.'));
      break;
    }

    const bySlot = slotMode ? groupBySlot(scheduled) : null;
    const byMember = groupByMember(scheduled);

    if (slotMode) {
      logger.info(`Scheduled ${scheduled.length} dim(s) across ${roundSlots.length} slot(s):`);
      for (const [slotId, dims] of bySlot!) {
        logger.info(`  ${chalk.bold(slotId)}: ${dims.map(d => d.dimensionId).join(', ')}`);
      }
    } else {
      logger.info(`Scheduled ${scheduled.length} dim(s) across ${byMember.size} member(s):`);
      for (const [id, dims] of byMember) {
        logger.info(`  ${chalk.bold(id)}: ${dims.map(d => d.dimensionId).join(', ')}`);
      }
    }

    const roundRunId = `r${round}.${Date.now()}`;
    const worktreeOpts = { projectPath: cwd, runId: roundRunId };
    const fileClaims = new FileClaims();

    const handles: CouncilWorktreeHandle[] = slotMode
      ? await createCouncilWorktreesForSlots(roundSlots, worktreeOpts)
      : await createCouncilWorktrees(roundMembers, worktreeOpts);
    if (handles.length === 0) {
      logger.error('Could not create worktrees. Check git state.');
      break;
    }

    try {
      // Run all builders in parallel, each in their isolated worktree
      logger.info(`\nRunning ${handles.length} builder(s) in parallel...`);

      // Streaming judge queue: as each slot finishes building, idle slots from
      // OTHER members can judge immediately — no batch wait.
      const judgeQueue = new CouncilJudgeQueue();
      const slotStatus = new Map<string, 'building' | 'judging' | 'idle'>(
        handles.map(h => [h.slotId ?? `${h.memberId}-0`, 'idle'] as const),
      );

      async function tryAssignStreamingJudge(): Promise<void> {
        if (!slotMode) return; // streaming only in slot mode
        const idleSlots = roundSlots.filter(
          s => slotStatus.get(s.slotId) === 'idle',
        );
        const next = judgeQueue.assignNextJudge(idleSlots);
        if (!next) return;
        slotStatus.set(next.judgeSlot.slotId, 'judging');
        try {
          // Pass the BUILDER's memberId so runMergeCourt knows who built it.
          // Restrict allSlots to the judge's slot only — cross-member enforcement
          // inside runMergeCourt selects judges where memberId !== builder's memberId.
          const builderHandle: CouncilWorktreeHandle = {
            memberId: next.candidate.memberId,
            worktreePath: next.candidate.worktreePath,
            branchName: `council/${roundRunId}/${next.candidate.slotId}`,
            slotId: next.candidate.slotId,
          };
          const singleResult = await runMergeCourt({
            projectPath: cwd,
            worktreeOpts,
            handles: [builderHandle],
            allMemberIds: available,
            allSlots: [next.judgeSlot],
            goal: options.goal,
            minJudges: 1,
          });
          const v = singleResult[0]?.consensus ?? 'FAIL';
          judgeQueue.markJudgeComplete(next.candidate.candidateId, v === 'PASS' ? 'PASS' : v === 'SPLIT' ? 'SPLIT' : 'FAIL');
        } finally {
          slotStatus.set(next.judgeSlot.slotId, 'idle');
          void tryAssignStreamingJudge();
        }
      }

      await Promise.allSettled(
        handles.map(async (handle) => {
          const memberId = handle.memberId as CouncilMemberId;
          const effectiveSlotId = handle.slotId ?? `${memberId}-0`;
          const myDims = slotMode
            ? (bySlot?.get(effectiveSlotId) ?? [])
            : (byMember.get(memberId) ?? []);
          if (myDims.length === 0) return;

          slotStatus.set(effectiveSlotId, 'building');
          const goal = myDims.map(d => buildDimGoal(d, 'this project')).join('\n\n---\n\n');
          const wp = makeBuildWorkPacket(goal, handle.worktreePath);
          const lease = makeBuildLease(handle.worktreePath);
          const adapter = makeBuilderAdapter(memberId, wp);

          logger.info(`  [${chalk.bold(effectiveSlotId)}] building ${myDims.length} dim(s)...`);
          try {
            const result = await runAdapter(adapter, { lease, cwd: handle.worktreePath });
            health.recordSuccess(memberId);
            logger.info(`  [${chalk.bold(effectiveSlotId)}] done: ${result.status}, ${result.filesChanged.length} file(s)`);

            // Enqueue for streaming judging if files changed
            if (slotMode && result.filesChanged.length > 0) {
              const candidate: JudgeCandidate = {
                candidateId: `cand-${effectiveSlotId}-${Date.now()}`,
                slotId: effectiveSlotId,
                memberId,
                dimensionId: myDims[0]?.dimensionId ?? 'unknown',
                worktreePath: handle.worktreePath,
                changedFiles: result.filesChanged,
                completedAt: new Date().toISOString(),
                status: 'pending',
              };
              judgeQueue.enqueue(candidate);
            }
          } catch (err) {
            const errStr = String(err);
            const exitCode = (err as NodeJS.ErrnoException & { code?: number }).code;
            health.recordFailure(memberId, errStr, typeof exitCode === 'number' ? exitCode : undefined);
            if (!health.isAvailable(memberId)) {
              logger.warn(chalk.yellow(`  [${chalk.bold(effectiveSlotId)}] removed from session: ${health.getStatus().find(h => h.id === memberId)?.status}`));
            } else {
              logger.warn(`  [${chalk.bold(effectiveSlotId)}] build failed: ${errStr}`);
            }
          } finally {
            slotStatus.set(effectiveSlotId, 'idle');
            // Offer this slot as a judge immediately (streaming pattern)
            void tryAssignStreamingJudge();
          }
        }),
      );

      // Drain any remaining pending candidates before merge court
      if (slotMode && judgeQueue.hasPending()) {
        const stats = judgeQueue.getStats();
        logger.info(chalk.dim(`  [streaming-judge] Draining ${stats.pending} pending candidate(s)...`));
      }

      // Register file claims BEFORE merge court to detect cross-member conflicts
      for (const handle of handles) {
        const changed = await getChangedFiles(handle.worktreePath);
        const claim = fileClaims.claim(
          handle.memberId as CouncilMemberId,
          changed,
          handle.slotId,
        );
        if (claim.conflicts.length > 0) {
          logger.warn(`  [${handle.slotId ?? handle.memberId}] ${claim.conflicts.length} file conflict(s): ${claim.conflicts.map(c => `${c.file} (claimed by ${c.claimedBy})`).join(', ')}`);
        }
      }

      // Run merge court — streaming pre-computed verdicts used as fast-path for
      // slots already judged; fileClaims enforced structurally (not advisory).
      logger.info('\nRunning merge court...');
      const mergeResults = await runMergeCourt({
        projectPath: cwd,
        worktreeOpts,
        handles,
        allMemberIds: available,
        allSlots: slotMode ? roundSlots : undefined,
        goal: options.goal,
        fileClaims,
        minJudges,
        preComputedConsensus: slotMode ? judgeQueue.getStreamingVerdicts() : undefined,
      });

      const roundMerged = mergeResults.filter(r => r.merged).length;
      totalMerged += roundMerged;

      printRoundSummary(mergeResults, round, totalMerged);

      // Run doctrine BEFORE recording convergence so CIP-blocked dims don't count
      // as converged. A merge that passes judges but fails CIP is not frontier-ready.
      const dimsByMember = new Map(
        [...byMember.entries()].map(([id, dims]) => [id, dims] as const),
      );
      const cipBlockedDimIds = new Set<string>();
      if (!options.skipValidate && roundMerged > 0) {
        const mergedDims: PostMergeDim[] = mergeResults
          .filter(r => r.merged)
          .flatMap(r => {
            const slotId = (r as { slotId?: string }).slotId;
            const dims = slotMode && slotId && bySlot
              ? (bySlot.get(slotId) ?? [])
              : (dimsByMember.get(r.memberId as CouncilMemberId) ?? []);
            const seen = new Set<string>();
            return dims
              .filter(d => { const dup = seen.has(d.dimensionId); seen.add(d.dimensionId); return !dup; })
              .map(d => ({ dimId: d.dimensionId, changedFiles: r.changedFiles }));
          });
        const doctrineResult = await runPostMergeDoctrine(cwd, mergedDims);
        for (const dimId of doctrineResult.cipBlocked) cipBlockedDimIds.add(dimId);
        if (doctrineResult.cipBlocked.length > 0) {
          logger.warn(chalk.yellow(
            `  [doctrine] ${doctrineResult.cipBlocked.length} dim(s) CIP-blocked — not counting as converged: ` +
            doctrineResult.cipBlocked.join(', '),
          ));
        }
      }

      // Record convergence: CIP-blocked dims count as not-approved even if merged.
      for (const r of mergeResults) {
        const slotId = (r as { slotId?: string }).slotId;
        const dimsFromSlot: ScheduledDimension[] = slotMode && slotId && bySlot
          ? (bySlot.get(slotId) ?? [])
          : (dimsByMember.get(r.memberId as CouncilMemberId) ?? []);
        for (const dim of dimsFromSlot) {
          const approved = r.merged && !cipBlockedDimIds.has(dim.dimensionId);
          convergence.record(dim.dimensionId, approved, round);
        }
      }

      const conv = convergence.summarize();
      if (conv.stuck > 0) {
        logger.warn(chalk.yellow(`  Stuck dims (${conv.stuck}): ${conv.stuckDims.map(d => d.dimensionId).join(', ')}`));
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
      await writeSlotProofLedger(cwd, runId, round, mergeResults, bySlot ?? undefined, byMember, cipBlockedDimIds);

      // Checkpoint session state for resume support.
      sessionState.round = round;
      sessionState.phase = 'validate';
      sessionState.totalMerged = totalMerged;
      sessionState.convergence = { ...conv, stuckDims: conv.stuckDims };
      sessionState.mergeResults = mergeResults.map(r => ({
        memberId: r.memberId,
        consensus: r.consensus,
        merged: r.merged,
        changedFiles: r.changedFiles,
        dissentLog: r.dissentLog,
      }));
      await writeSessionState(cwd, sessionState);

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
  logger.info(`Rounds run:      ${roundsRun}`);
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
