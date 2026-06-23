// Matrix Kernel — CouncilMergeCourt
//
// After parallel builders complete in their worktrees, the merge court:
//   1. Captures the diff from each member's worktree (staged binary patch)
//   2. Dispatches judges from EVERY OTHER council member (builder-never-judges)
//   3. Merges approved diffs into the main working tree via `git apply`
//   4. Returns per-member results for audit and progress tracking
//
// Judges run in parallel per builder; builders are processed sequentially so
// `git apply` conflicts are caught one at a time.
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { COUNCIL_PROFILES } from './council-member-profiles.js';
import { GeminiCLIAdapter } from '../adapters/gemini-cli-adapter.js';
import { GrokBuildAdapter } from '../adapters/grok-build-adapter.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentLease } from '../types/lease.js';
import type { CouncilWorktreeHandle } from './council-worktree.js';
import { captureWorktreeDiff, collectChangedFilesForHandles, makeReadOnlyLease } from './council-worktree.js';
import type { CouncilWorktreeOpts } from './council-worktree.js';
import { runDebate } from './council-debate.js';
import { runRevision } from './council-revision.js';
import type { FileClaims } from './council-file-claims.js';
import { computeConsensus, assignVoteWeight } from './council-consensus.js';
import type { WeightedVote } from './council-consensus.js';
import type { CouncilSlot } from './council-slot.js';
import { buildAnonymousReviewPlan } from './council-review-plan.js';
import type { AnonymousReviewAssignment } from './council-review-plan.js';
import { parseVerdict } from './council-verdict-parser.js';
export type { MemberVerdict } from './council-verdict-parser.js';
import type { MemberVerdict } from './council-verdict-parser.js';

const execFileAsync = promisify(execFile);

export type CouncilMemberId = 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code';

export interface MergeCourtResult {
  memberId: CouncilMemberId;
  /** Slot that produced this result — undefined in non-slot mode. */
  slotId?: string;
  worktreePath: string;
  changedFiles: string[];
  verdicts: MemberVerdict[];
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
  merged: boolean;
  mergeError?: string;
  /** candidateId → builderId revealed after all verdicts collected (anonymous peer review). */
  anonymizationMap?: Record<string, string>;
  /** Anonymous cross-member review assignment used for this candidate. */
  reviewAssignment?: AnonymousReviewAssignment;
  /** Dissent from minority judges preserved even on PASS consensus. */
  dissentLog: string[];
}

export interface MergeCourtOptions {
  projectPath: string;
  worktreeOpts: CouncilWorktreeOpts;
  handles: CouncilWorktreeHandle[];
  allMemberIds: CouncilMemberId[];
  goal: string;
  /** When provided, builders whose ALL changed files are claimed by another member are skipped. */
  fileClaims?: FileClaims;
  /**
   * When provided (slot-aware mode), judges are selected from allSlots where
   * slot.memberId !== builder.memberId. Overrides allMemberIds-based judge selection.
   */
  allSlots?: CouncilSlot[];
  /** Minimum number of cross-member judges required (default: 2). */
  minJudges?: number;
  /**
   * When true, use revision-then-rejudge instead of text debate on SPLIT/FAIL.
   * Revision gives the builder a chance to fix blocking concerns and re-submit.
   * Default: true (revision is more natural for coding agents than text argument).
   */
  useRevision?: boolean;
  /** Revision cycles before giving up (default: 1). */
  revisionCycles?: number;
  /** Runtime proof commands that must run after a revision before rejudge. */
  revisionProofCommands?: string[];
  /**
   * Pre-computed streaming verdicts keyed by slotId. When provided, the merge
   * court skips the LLM judge phase for handles whose slotId has a PASS verdict
   * here — the streaming judge already approved this candidate.
   */
  preComputedConsensus?: Map<string, 'PASS' | 'FAIL' | 'SPLIT'>;
  /**
   * When true, collect verdicts but do NOT apply any diffs to the main working
   * tree. Used by the streaming judge phase — only the final merge court applies
   * diffs, preventing double-apply when a candidate gets both streaming and
   * final judging.
   */
  judgeOnly?: boolean;
  changedFilesByWorktree?: ReadonlyMap<string, string[]>;
}

// ── Judge adapter factory (judge-mode only) ───────────────────────────────────

function makeJudgeWorkPacket(
  goal: string, diff: string, worktreePath: string,
  persona: string, candidateId: string,
): WorkPacket {
  const diffSnippet = diff.slice(0, 4000);
  return {
    id: `merge-court.${Date.now()}`,
    dimensionId: 'council-review',
    objective: [
      `You are acting as: ${persona}`,
      `You are an independent code reviewer in an anonymous peer-review council.`,
      `The builder's identity is hidden (you are reviewing ${candidateId}).`,
      `READ ONLY — do NOT make any file changes.`,
      ``,
      `Evaluate whether ${candidateId}'s diff correctly implements: ${goal}`,
      ``,
      `DIFF (first 4000 chars):`,
      diffSnippet || '(no diff — builder made no changes)',
      ``,
      `Output your verdict in EXACTLY this format (all fields required):`,
      `VERDICT: PASS`,
      `CONFIDENCE: HIGH`,
      `REASON: <one paragraph>`,
      `SCORE_SUGGESTION: <number 0-10>`,
      `BLOCKING_ISSUES: none`,
      `BLOCKING_CONCERNS: none`,
      `DISSENT: none`,
      ``,
      `or VERDICT: FAIL with BLOCKING_ISSUES and BLOCKING_CONCERNS as bullet lists.`,
      `If you PASS but have reservations, put them in DISSENT — they are preserved in the audit log.`,
      `Be harsh through your ${persona} lens. Only PASS if the implementation is real and non-trivial.`,
    ].join('\n'),
    acceptanceCriteria: ['Rendered verdict with all required fields'],
    proof: { proofRequired: ['verdict output'] },
    globalForbidden: ['**'],
    context: { worktreePath },
  } as unknown as WorkPacket;
}


// Members with structurally-enforced read-only judge mode.
// Claude Code: --allowedTools Read,Glob,Grep
// Grok:        --permission-mode plan
// Codex:       --sandbox read-only (added to judge invocation in codex-adapter.ts)
const JUDGE_CAPABLE_MEMBERS = new Set<CouncilMemberId>(['claude-code', 'grok-build', 'gemini-cli', 'codex']);

function makeJudgeAdapter(id: CouncilMemberId, workPacket: WorkPacket) {
  switch (id) {
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket, judgeMode: true });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket, judgeMode: true });
    case 'codex':       return new CodexAdapter({ workPacket, judgeMode: true });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket, judgeMode: true });
  }
}

// ── Anonymous peer review helpers (Karpathy protocol) ────────────────────────

// ── Merge via git apply ───────────────────────────────────────────────────────

export async function applyDiffToMain(diff: string, projectPath: string): Promise<void> {
  if (!diff.trim()) return;
  // Use a project-relative temp dir to avoid os.tmpdir() paths with spaces on
  // Windows (e.g. C:\Users\My Name\AppData\Local\Temp) which break git apply.
  const tmpDir = path.join(projectPath, '.danteforge-worktrees', '.tmp-patches');
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `council-patch-${Date.now()}.patch`);
  try {
    await fs.writeFile(tmpFile, diff, 'utf8');

    // The files this patch touches, from git itself (authoritative even for renames/adds).
    const numstat = await execFileAsync('git', ['apply', '--numstat', tmpFile], { cwd: projectPath, timeout: 60_000 });
    const files = numstat.stdout.trim().split('\n').filter(Boolean)
      .map(l => l.split('\t')[2]).filter((f): f is string => !!f);

    // SAFETY PRECONDITION (live fleet-run-3e finding): never patch over local modifications.
    // A conflicted `git apply --3way` leaves conflict markers + unmerged index entries in the
    // MAIN tree (no MERGE_HEAD — nothing to abort), and cleanup-by-restore would destroy any
    // pre-existing uncommitted work in those files. Requiring them clean makes the rollback
    // below provably non-destructive; a dirty target is an honest merge failure (the
    // candidate's work stays on its council branch).
    if (files.length > 0) {
      const dirty = (await execFileAsync('git', ['status', '--porcelain', '--', ...files], { cwd: projectPath, timeout: 60_000 })).stdout.trim();
      if (dirty) {
        throw new Error(`refusing to apply council patch: target file(s) carry local modifications (would be destroyed on conflict rollback):\n${dirty}`);
      }
    }

    try {
      await execFileAsync('git', ['apply', '--whitespace=nowarn', '--3way', tmpFile], {
        cwd: projectPath, timeout: 60_000,
      });
    } catch (applyErr) {
      // --3way already wrote conflict markers + unmerged index entries before failing. The
      // touched files were verified CLEAN pre-apply, so restoring them to HEAD loses nothing —
      // the candidate's work is preserved on its branch. Patch-created files (absent from HEAD)
      // are unstaged and deleted.
      for (const f of files) {
        const inHead = await execFileAsync('git', ['cat-file', '-e', `HEAD:${f}`], { cwd: projectPath, timeout: 30_000 })
          .then(() => true).catch(() => false);
        if (inHead) {
          await execFileAsync('git', ['restore', '--staged', '--worktree', '--source=HEAD', '--', f], { cwd: projectPath, timeout: 30_000 }).catch(() => { /* best-effort per file */ });
        } else {
          await execFileAsync('git', ['rm', '--cached', '--force', '--', f], { cwd: projectPath, timeout: 30_000 }).catch(() => { /* not in index */ });
          await fs.unlink(path.join(projectPath, f)).catch(() => { /* not created */ });
        }
      }
      throw applyErr;
    }
  } finally {
    await fs.unlink(tmpFile).catch(() => { /* ignore */ });
  }
}

// ── Main merge court entry point ──────────────────────────────────────────────

export async function runMergeCourt(opts: MergeCourtOptions): Promise<MergeCourtResult[]> {
  const results: MergeCourtResult[] = [];

  const minJudges = opts.minJudges ?? 1;
  const reviewPlan = buildAnonymousReviewPlan({
    handles: opts.handles,
    allMemberIds: opts.allMemberIds,
    allSlots: opts.allSlots,
    minJudges,
    judgeCapableMembers: JUDGE_CAPABLE_MEMBERS,
  });
  const assignmentByWorktree = new Map(reviewPlan.assignments.map(assignment => [assignment.worktreePath, assignment]));
  const anonymizationMap = reviewPlan.anonymizationMap;
  const changedFilesByWorktree = opts.changedFilesByWorktree ?? await collectChangedFilesForHandles(opts.handles);

  for (const handle of opts.handles) {
    const builderId = handle.memberId as CouncilMemberId;
    const reviewAssignment = assignmentByWorktree.get(handle.worktreePath);
    const candidateId = reviewAssignment?.candidateId ?? builderId;

    const changedFiles = changedFilesByWorktree.get(handle.worktreePath) ?? [];

    if (changedFiles.length === 0) {
      logger.info(`[merge-court] ${candidateId} (${builderId}): no changes — skipping judge phase`);
      results.push({ memberId: builderId, slotId: handle.slotId, worktreePath: handle.worktreePath,
        changedFiles: [], verdicts: [], consensus: 'FAIL', merged: false,
        anonymizationMap, reviewAssignment, dissentLog: [] });
      continue;
    }

    // File-claim gate: if ANY changed file is already claimed by a conflicting slot,
    // skip the merge entirely. In slot mode, same-member different-slot also conflicts.
    if (opts.fileClaims) {
      const slotIdForCheck = handle.slotId;
      const anyConflict = changedFiles.some(f => opts.fileClaims!.hasConflict(builderId as CouncilMemberId, [f], slotIdForCheck));
      if (anyConflict) {
        const nConflict = changedFiles.filter(f => opts.fileClaims!.hasConflict(builderId as CouncilMemberId, [f], slotIdForCheck)).length;
        logger.warn(`[merge-court] ${builderId}: ${nConflict}/${changedFiles.length} file(s) conflict — skipping (structural gate)`);
        results.push({ memberId: builderId, slotId: handle.slotId, worktreePath: handle.worktreePath,
          changedFiles, verdicts: [], consensus: 'FAIL', merged: false,
          mergeError: `${nConflict} of ${changedFiles.length} file(s) claimed by conflicting slot`,
          anonymizationMap, reviewAssignment, dissentLog: [] });
        continue;
      }
    }

    let diff = await captureWorktreeDiff(handle, opts.worktreeOpts);

    // Streaming pre-computed verdict fast-path: if this slot was already judged by
    // the streaming judge queue and the verdict was PASS, skip re-judging — but
    // ONLY when minJudges <= 1 (streaming ran exactly 1 judge). When minJudges > 1
    // the final court still needs additional cross-member judges; the streaming vote
    // is treated as advisory, not conclusive.
    const slotId = handle.slotId ?? `${builderId}-0`;
    const preVerd = opts.preComputedConsensus?.get(slotId);
    const streamingJudgeId = reviewAssignment?.judgeMemberIds[0];
    if (preVerd === 'PASS' && streamingJudgeId && (opts.minJudges ?? 2) <= 1) {
      logger.info(`[merge-court] ${builderId} (${slotId}): streaming pre-approved — skipping re-judge`);
      const syntheticVerdict: MemberVerdict = {
        judgeId: streamingJudgeId,
        verdict: 'PASS', confidence: 'HIGH',
        scoreSuggestion: null, reason: 'Pre-approved by streaming judge queue',
        blockingConcerns: [], dissentSummary: '', rawOutput: '',
      };
      let merged = false;
      let mergeError: string | undefined;
      if (!opts.judgeOnly) {
        try {
          await applyDiffToMain(diff, opts.projectPath);
          merged = true;
          logger.info(`[merge-court] ${builderId}: merged (streaming pre-approved)`);
        } catch (err) {
          mergeError = String(err).split('\n')[0];
          logger.warn(`[merge-court] ${builderId}: merge failed — ${mergeError}`);
        }
      }
      results.push({
        memberId: builderId, slotId: handle.slotId, worktreePath: handle.worktreePath,
        changedFiles, verdicts: [syntheticVerdict], consensus: 'PASS', merged,
        mergeError, anonymizationMap, reviewAssignment, dissentLog: [],
      });
      continue;
    }

    // Review plan enforces anonymous labels, cross-member judges, and builder-never-judges.
    // Only members in JUDGE_CAPABLE_MEMBERS are eligible — those with structural read-only
    // enforcement (Claude Code: --allowedTools; Grok: --permission-mode plan).
    const judgeIds = reviewAssignment?.judgeMemberIds ?? [];
    if (reviewAssignment && !reviewAssignment.isStructurallyValid) {
      logger.warn(`[merge-court] ${candidateId}: ${reviewAssignment.violationReason}`);
    }
    logger.info(`[merge-court] ${candidateId}: ${changedFiles.length} file(s) → ${judgeIds.length} anonymous judge(s)`);

    const lease = makeReadOnlyLease(handle.worktreePath);

    const verdicts = await Promise.all(
      judgeIds.map(async (judgeId): Promise<MemberVerdict> => {
        const persona = COUNCIL_PROFILES[judgeId]?.persona ?? judgeId;
        const workPacket = makeJudgeWorkPacket(opts.goal, diff, handle.worktreePath, persona, candidateId);
        try {
          const adapter = makeJudgeAdapter(judgeId, workPacket);
          const result = await runAdapter(adapter, { lease, cwd: handle.worktreePath });
          return parseVerdict(judgeId, result.finalMessage ?? '');
        } catch (err) {
          return { judgeId, verdict: 'UNCLEAR', confidence: 'LOW',
            scoreSuggestion: null, reason: String(err),
            blockingConcerns: [], dissentSummary: '', rawOutput: '' };
        }
      }),
    );

    let finalVerdicts = verdicts;

    // Build weighted votes from raw verdicts for K-of-M consensus aggregation.
    const weightedVotes: WeightedVote[] = verdicts.map(v => ({
      judgeSlotId: `${v.judgeId}-0`,
      judgeMemberId: v.judgeId,
      builderMemberId: builderId,
      verdict: v.verdict,
      weight: assignVoteWeight(v.judgeId, builderId),
      confidence: v.confidence,
      reason: v.reason,
      dissentSummary: v.dissentSummary,
    }));
    const consensusResult = computeConsensus(weightedVotes, { minJudges, minPasses: minJudges });
    let consensus: 'PASS' | 'FAIL' | 'SPLIT' =
      consensusResult.verdict === 'PASS' ? 'PASS' :
      consensusResult.verdict === 'SPLIT' ? 'SPLIT' : 'FAIL';

    // Reveal builder identity and log full consensus summary (includes UNCLEAR-dominant reason).
    logger.info(`[merge-court] ${candidateId} revealed as ${builderId}: initial consensus = ${consensus} — ${consensusResult.summary}`);
    if (consensusResult.summary.includes('UNCLEAR-dominant')) {
      logger.warn(`[merge-court] ${builderId}: UNCLEAR-dominant — judges returned unstructured output. ` +
        `Check that agents are responding with "VERDICT: PASS" or "VERDICT: FAIL" in their output. ` +
        `If running on a new codebase, agents may need more context in the goal prompt.`);
    }

    // If initial verdict is FAIL or SPLIT, give the builder a chance to improve.
    // useRevision (default: true) → revision-then-rejudge (coding agents fix the code).
    // useRevision: false          → text debate fallback (original behaviour).
    const useRevision = opts.useRevision !== false;
    if ((consensus === 'FAIL' || consensus === 'SPLIT') && judgeIds.length > 0) {
      if (useRevision) {
        logger.info(`[merge-court] ${builderId}: ${consensus} — starting revision cycle`);
        try {
          const revResult = await runRevision({
            builderId,
            judgeIds,
            initialVerdicts: verdicts,
            goal: opts.goal,
            diff,
            worktreePath: handle.worktreePath,
            worktreeOpts: opts.worktreeOpts,
            maxCycles: opts.revisionCycles ?? 2,
            proofCommands: opts.revisionProofCommands ?? ['npm run test:council'],
            dimensionId: 'council-revision',
          });
          finalVerdicts = revResult.finalVerdicts;
          // Use the revised diff for merging — judges evaluated this, not the original.
          if (revResult.finalDiff && revResult.finalDiff !== diff) {
            diff = revResult.finalDiff;
            logger.info(`[merge-court] ${builderId}: using revised diff for merge (${diff.length} chars)`);
          }
          const revWeightedVotes: WeightedVote[] = revResult.finalVerdicts.map(v => ({
            judgeSlotId: `${v.judgeId}-0`,
            judgeMemberId: v.judgeId,
            builderMemberId: builderId,
            verdict: v.verdict,
            weight: assignVoteWeight(v.judgeId, builderId),
            confidence: v.confidence,
            reason: v.reason,
            dissentSummary: v.dissentSummary,
          }));
          const revConsensus = computeConsensus(revWeightedVotes, { minJudges, minPasses: minJudges });
          consensus = revConsensus.verdict === 'PASS' ? 'PASS' :
            revConsensus.verdict === 'SPLIT' ? 'SPLIT' : 'FAIL';
          logger.info(`[merge-court] ${builderId}: post-revision consensus = ${consensus} (${revResult.cycles.length} cycle(s))`);
        } catch (err) {
          logger.warn(`[merge-court] ${builderId}: revision failed — using initial verdict: ${String(err)}`);
        }
      } else {
        logger.info(`[merge-court] ${builderId}: ${consensus} — starting debate (up to 2 rounds)`);
        try {
          const transcript = await runDebate({
            builderId, judgeIds, initialVerdicts: verdicts,
            goal: opts.goal, diff, worktreePath: handle.worktreePath, maxRounds: 2,
          });
          finalVerdicts = transcript.finalVerdicts;
          const debateWeightedVotes: WeightedVote[] = transcript.finalVerdicts.map(v => ({
            judgeSlotId: `${v.judgeId}-0`, judgeMemberId: v.judgeId,
            builderMemberId: builderId, verdict: v.verdict,
            weight: assignVoteWeight(v.judgeId, builderId),
            confidence: v.confidence, reason: v.reason, dissentSummary: v.dissentSummary,
          }));
          const debateConsensus = computeConsensus(debateWeightedVotes, { minJudges, minPasses: minJudges });
          consensus = debateConsensus.verdict === 'PASS' ? 'PASS' :
            debateConsensus.verdict === 'SPLIT' ? 'SPLIT' : 'FAIL';
          logger.info(`[merge-court] ${builderId}: post-debate consensus = ${consensus} (${transcript.rounds.length} round(s))`);
        } catch (err) {
          logger.warn(`[merge-court] ${builderId}: debate failed — using initial verdict: ${String(err)}`);
        }
      }
    }

    // Collect dissent from minority judges (preserved even on PASS — Karpathy/Block pattern).
    const dissentLog = finalVerdicts
      .filter(v => v.dissentSummary)
      .map(v => `[${v.judgeId}] ${v.dissentSummary}`);
    if (consensus === 'PASS' && dissentLog.length > 0) {
      logger.info(`[merge-court] ${builderId}: PASS with ${dissentLog.length} dissent(s) logged`);
    }

    let merged = false;
    let mergeError: string | undefined;

    if (consensus === 'PASS' && !opts.judgeOnly) {
      try {
        await applyDiffToMain(diff, opts.projectPath);
        merged = true;
        logger.info(`[merge-court] ✓ ${builderId}: PASS — diff applied to main working tree`);
      } catch (err) {
        mergeError = String(err);
        logger.warn(`[merge-court] ✗ ${builderId}: diff application failed: ${mergeError}`);
      }
    } else if (consensus !== 'PASS') {
      logger.info(`[merge-court] ${builderId}: ${consensus} — changes isolated in worktree ${handle.worktreePath}`);
    } else {
      logger.info(`[merge-court] ${builderId}: PASS (judge-only — diff held for final court)`);
    }

    results.push({ memberId: builderId, slotId: handle.slotId, worktreePath: handle.worktreePath,
      changedFiles, verdicts: finalVerdicts, consensus, merged, mergeError,
      anonymizationMap, reviewAssignment, dissentLog });
  }

  return results;
}
