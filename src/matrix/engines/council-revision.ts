// Matrix Kernel — CouncilRevision
//
// Replaces the text-debate loop with a revision-then-rejudge cycle for
// coding agents. After SPLIT/FAIL, instead of asking the builder to argue
// in text, give it the FAIL judge's blocking concerns and let it do what
// coding agents do best: fix the code. Re-run judges on the revised diff.
//
// Flow per cycle:
//   1. Self-inspect  — builder reads its diff + judge feedback, produces text assessment
//   2. Revise        — builder addresses blocking concerns in the same worktree
//   3. Re-judge      — original judges evaluate the cumulative revised diff
//   4. PASS → done; SPLIT/FAIL → next cycle (up to maxCycles)
//
// Production callsite: council-merge-court.ts (replaces runDebate on SPLIT/FAIL).
// Injection seams (_makeBuilderAdapter, _makeJudgeAdapter) allow unit tests
// to override subprocess spawning.
import { logger } from '../../core/logger.js';
import { COUNCIL_PROFILES } from './council-member-profiles.js';
import { GeminiCLIAdapter } from '../adapters/gemini-cli-adapter.js';
import { GrokBuildAdapter } from '../adapters/grok-build-adapter.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { AgentAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentLease } from '../types/lease.js';
import { captureWorktreeDiff, makeReadOnlyLease } from './council-worktree.js';
import type { CouncilWorktreeOpts } from './council-worktree.js';
import type { CouncilMemberId } from './council-merge-court.js';
import { parseVerdict } from './council-verdict-parser.js';
import type { MemberVerdict } from './council-verdict-parser.js';
import {
  recordCouncilRevisionFrontierReceipt,
  runRevisionProofCommands,
  type RecordCouncilRevisionReceiptResult,
  type RevisionProofCommandResult,
} from './council-revision-proof.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RevisionOptions {
  builderId: CouncilMemberId;
  judgeIds: CouncilMemberId[];
  initialVerdicts: MemberVerdict[];
  goal: string;
  /** Original diff for context in the self-inspection prompt. */
  diff: string;
  worktreePath: string;
  worktreeOpts: CouncilWorktreeOpts;
  /** Revision cycles before giving up (default: 1). */
  maxCycles?: number;
  /** Runtime proof commands run after revision and before rejudge. */
  proofCommands?: string[];
  /** Matrix dimension receiving this revision evidence. */
  dimensionId?: string;
  /** Frontier target used in the emitted score-evidence receipt. */
  targetScore?: number;
  /** Injection seam: override builder adapter creation. */
  _makeBuilderAdapter?: (id: CouncilMemberId, wp: WorkPacket) => AgentAdapter;
  /** Injection seam: override judge adapter creation. */
  _makeJudgeAdapter?: (id: CouncilMemberId, wp: WorkPacket) => AgentAdapter;
}

export interface RevisionCycle {
  cycle: number;
  selfAssessment: string;
  revisedDiff: string;
  proofCommands: RevisionProofCommandResult[];
  frontierReceipt?: RecordCouncilRevisionReceiptResult;
  rejudgeVerdicts: MemberVerdict[];
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
}

export interface RevisionResult {
  cycles: RevisionCycle[];
  finalVerdicts: MemberVerdict[];
  finalConsensus: 'PASS' | 'FAIL' | 'SPLIT';
  /** The last revised diff — what judges actually evaluated. Use this for merging, not the original diff. */
  finalDiff: string;
  frontierReceipts: RecordCouncilRevisionReceiptResult[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveConsensus(verdicts: MemberVerdict[]): 'PASS' | 'FAIL' | 'SPLIT' {
  if (verdicts.length === 0) return 'FAIL';
  const passes = verdicts.filter(v => v.verdict === 'PASS').length;
  const fails  = verdicts.filter(v => v.verdict === 'FAIL').length;
  if (passes > fails) return 'PASS';
  if (fails > passes) return 'FAIL';
  return 'SPLIT';
}

function makeReviewerLabels(judgeIds: CouncilMemberId[]): Map<CouncilMemberId, string> {
  const labels = new Map<CouncilMemberId, string>();
  for (const judgeId of judgeIds) {
    if (!labels.has(judgeId)) labels.set(judgeId, `Reviewer-${labels.size + 1}`);
  }
  return labels;
}

/** Full picture: what each judge said, separated into preserve vs fix buckets. */
function extractAllJudgeFeedback(
  verdicts: MemberVerdict[],
  reviewerLabels: Map<CouncilMemberId, string>,
): { preserveContext: string; fixContext: string } {
  const passes = verdicts.filter(v => v.verdict === 'PASS');
  const fails  = verdicts.filter(v => v.verdict === 'FAIL' || v.verdict === 'UNCLEAR');

  const preserveLines = passes.map(v => `[${reviewerLabels.get(v.judgeId) ?? 'Reviewer'} APPROVED]: ${v.reason}`);

  const fixLines = fails.flatMap(v => {
    const issueMatch = v.rawOutput.match(/BLOCKING_ISSUES:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
    const issues = issueMatch ? issueMatch[1]!.trim() : '';
    return [
      `[${reviewerLabels.get(v.judgeId) ?? 'Reviewer'} BLOCKED]: ${v.reason}`,
      ...(issues && issues.toLowerCase() !== 'none' ? [`  Issues: ${issues}`] : []),
    ];
  });

  return {
    preserveContext: preserveLines.join('\n') || '(no approvals yet)',
    fixContext: fixLines.join('\n') || '(no specific issues listed)',
  };
}

/** Compact peer-verdict summary for rejudge prompts (each judge sees what the other said). */
function peerVerdictSummary(
  verdicts: MemberVerdict[],
  excludeJudgeId: string,
  reviewerLabels: Map<CouncilMemberId, string>,
): string {
  return verdicts
    .filter(v => v.judgeId !== excludeJudgeId)
    .map(v => `[${reviewerLabels.get(v.judgeId) ?? 'Reviewer'}: ${v.verdict}] ${v.reason.slice(0, 200)}`)
    .join('\n') || '(no peer verdict available)';
}

function averageScoreSuggestion(verdicts: MemberVerdict[]): number | null {
  const scores = verdicts
    .map(v => v.scoreSuggestion)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100;
}

function changedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2]) files.add(match[2]);
  }
  return [...files].sort();
}

function formatProofCommands(results: RevisionProofCommandResult[]): string {
  if (results.length === 0) return '(no runtime proof commands configured)';
  return results.map((result) => [
    `COMMAND: ${result.command}`,
    `EXIT: ${result.exitCode}`,
    `STATUS: ${result.passed ? 'PASS' : 'FAIL'}`,
    `STDOUT: ${result.stdout.trim().slice(0, 1000) || '(empty)'}`,
    `STDERR: ${result.stderr.trim().slice(0, 1000) || '(empty)'}`,
  ].join('\n')).join('\n\n');
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSelfInspectPrompt(
  goal: string, diff: string, preserveContext: string, fixContext: string,
): string {
  return [
    `SELF-INSPECTION — you built this diff. Read ALL judge feedback below, both approvals and rejections.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `=== WHAT JUDGES APPROVED (preserve these aspects) ===`,
    preserveContext,
    ``,
    `=== WHAT JUDGES REJECTED (must fix these) ===`,
    fixContext,
    ``,
    `Your diff (first 2000 chars):`,
    diff.slice(0, 2000),
    ``,
    `DO NOT write any files. Output a structured multi-part self-assessment:`,
    `WHAT_WORKED: <aspects judges approved — what you will NOT change>`,
    `WHAT_TO_FIX: <specific code/test gaps the blocking judge identified>`,
    `FIX_PLAN: <concrete file-by-file changes you will make to address each blocking concern>`,
  ].join('\n');
}

function buildRevisionPrompt(
  goal: string, preserveContext: string, fixContext: string, selfAssessment: string, cycle: number,
): string {
  return [
    `REVISION CYCLE ${cycle} — address the blocking judge's concerns WITHOUT breaking what the approving judge liked.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `=== PRESERVE (approving judge — do NOT change these) ===`,
    preserveContext,
    ``,
    `=== FIX (blocking judge — must address ALL of these) ===`,
    fixContext,
    ``,
    `Your self-assessment and fix plan:`,
    selfAssessment.slice(0, 1200),
    ``,
    `Make targeted fixes to address ONLY the blocking concerns. Preserve everything the approving judge liked.`,
    `Do NOT add unrelated changes. Do NOT add stubs or TODOs.`,
    `When done, stop — do not emit JSON, changes are detected via git status.`,
  ].join('\n');
}

function buildRejudgePrompt(
  goal: string, revisedDiff: string, selfAssessment: string,
  priorRawOutput: string, judgeId: CouncilMemberId, peerSummary: string, cycle: number,
  proofCommands: RevisionProofCommandResult[],
): string {
  const persona = COUNCIL_PROFILES[judgeId]?.persona ?? judgeId;
  return [
    `REVISION RE-EVALUATION (cycle ${cycle}) — You are acting as: ${persona}`,
    ``,
    `The builder received ALL judge feedback (yours + peer) and has revised their implementation.`,
    `Re-evaluate the REVISED diff below. You may update your verdict.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `=== YOUR PRIOR VERDICT ===`,
    priorRawOutput.slice(0, 400) || '(not available)',
    ``,
    `=== PEER JUDGE VERDICT (your co-reviewer) ===`,
    peerSummary,
    ``,
    `=== BUILDER SELF-ASSESSMENT (what they changed and why) ===`,
    selfAssessment.slice(0, 800),
    ``,
    `=== REVISED DIFF (first 2500 chars) ===`,
    revisedDiff.slice(0, 2500),
    ``,
    `=== RUNTIME PROOF COMMANDS ===`,
    formatProofCommands(proofCommands),
    ``,
    `If the builder specifically addressed your blocking concerns, vote PASS.`,
    `Treat failing runtime proof as a blocking concern unless it is clearly unrelated to this revision.`,
    `If critical concerns remain unaddressed, vote FAIL with specific remaining issues.`,
    ``,
    `Output your UPDATED verdict in EXACTLY this format:`,
    `VERDICT: PASS`,
    `CONFIDENCE: HIGH`,
    `REASON: <one paragraph>`,
    `SCORE_SUGGESTION: <number 0-10>`,
    `BLOCKING_ISSUES: none`,
    `BLOCKING_CONCERNS: none`,
    `DISSENT: <note any remaining concerns even if passing>`,
    ``,
    `or VERDICT: FAIL with BLOCKING_ISSUES and BLOCKING_CONCERNS as bullet lists.`,
  ].join('\n');
}

// ── Adapter factories ─────────────────────────────────────────────────────────

function makeRevisionWorkPacket(objective: string, worktreePath: string): WorkPacket {
  return {
    id: `council-revision.${Date.now()}`,
    dimensionId: 'council-revision',
    objective,
    acceptanceCriteria: ['Address all blocking concerns raised by judges'],
    proof: { proofRequired: ['targeted fixes without stubs or TODOs'] },
    globalForbidden: ['.danteforge/compete/matrix.json', '.danteforge/score-proposals/**', 'node_modules/**'],
    context: { worktreePath },
  } as unknown as WorkPacket;
}


function makeWriteLease(worktreePath: string): AgentLease {
  return {
    id: `revision-write-lease.${Date.now()}`,
    worktreePath,
    allowedWritePaths: ['src/**', 'tests/**', '*.md', '*.json'],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['.danteforge/compete/matrix.json', '.danteforge/score-proposals/**', 'node_modules/**'],
  } as unknown as AgentLease;
}

function defaultMakeBuilderAdapter(id: CouncilMemberId, wp: WorkPacket): AgentAdapter {
  switch (id) {
    case 'codex':       return new CodexAdapter({ workPacket: wp });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket: wp });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket: wp, skipPermissions: true });
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket: wp });
  }
}

function defaultMakeJudgeAdapter(id: CouncilMemberId, wp: WorkPacket): AgentAdapter {
  switch (id) {
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket: wp, judgeMode: true });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket: wp, judgeMode: true });
    case 'codex':       return new CodexAdapter({ workPacket: wp, judgeMode: true });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket: wp, judgeMode: true });
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runRevision(opts: RevisionOptions): Promise<RevisionResult> {
  const { builderId, judgeIds, goal, diff, worktreePath, worktreeOpts } = opts;
  const maxCycles = opts.maxCycles ?? 1;
  const makeBuilder = opts._makeBuilderAdapter ?? defaultMakeBuilderAdapter;
  const makeJudge = opts._makeJudgeAdapter ?? defaultMakeJudgeAdapter;
  const effectiveJudgeIds = [...new Set(judgeIds.filter(id => id !== builderId))];
  const reviewerLabels = makeReviewerLabels(effectiveJudgeIds);
  const initialVerdicts = opts.initialVerdicts.filter(v => v.judgeId !== builderId);

  const result: RevisionResult = {
    cycles: [],
    finalVerdicts: [...initialVerdicts],
    finalConsensus: resolveConsensus(initialVerdicts),
    finalDiff: diff,
    frontierReceipts: [],
  };

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (resolveConsensus(result.finalVerdicts) === 'PASS') break;

    const consensusBefore = resolveConsensus(result.finalVerdicts);
    const scoreBefore = averageScoreSuggestion(result.finalVerdicts);
    const { preserveContext, fixContext } = extractAllJudgeFeedback(result.finalVerdicts, reviewerLabels);
    const preservedApprovals = result.finalVerdicts
      .filter(v => v.verdict === 'PASS')
      .map(v => `[${reviewerLabels.get(v.judgeId) ?? 'Reviewer'}] ${v.reason}`);
    const blockingConcerns = result.finalVerdicts
      .filter(v => v.verdict !== 'PASS')
      .flatMap(v => v.blockingConcerns.length > 0 ? v.blockingConcerns : [v.reason]);
    logger.info(`[revision] Cycle ${cycle}/${maxCycles}: ${builderId} addressing ${result.finalVerdicts.filter(v => v.verdict !== 'PASS').length} FAIL/UNCLEAR verdict(s)`);

    // 1. Self-inspection: builder reads ALL judge feedback (both PASS and FAIL)
    let selfAssessment = '(self-inspection skipped)';
    try {
      const inspectPrompt = buildSelfInspectPrompt(goal, diff, preserveContext, fixContext);
      const inspectWp = makeRevisionWorkPacket(inspectPrompt, worktreePath);
      const inspectAdapter = makeBuilder(builderId, { ...inspectWp, objective: inspectPrompt } as WorkPacket);
      const inspectLease = makeReadOnlyLease(worktreePath);
      const inspectResult = await runAdapter(inspectAdapter, { lease: inspectLease, cwd: worktreePath });
      selfAssessment = inspectResult.finalMessage?.slice(0, 1200) ?? '(no self-assessment output)';
      logger.info(`[revision] Cycle ${cycle}: ${builderId} self-assessment (${selfAssessment.length} chars)`);
    } catch (err) {
      logger.warn(`[revision] Cycle ${cycle}: ${builderId} self-inspection failed: ${String(err)}`);
    }

    // 2. Revision: builder addresses blocking concerns while preserving approvals
    try {
      const revisionPrompt = buildRevisionPrompt(goal, preserveContext, fixContext, selfAssessment, cycle);
      const revisionWp = makeRevisionWorkPacket(revisionPrompt, worktreePath);
      const revisionAdapter = makeBuilder(builderId, revisionWp);
      const writeLease = makeWriteLease(worktreePath);
      await runAdapter(revisionAdapter, { lease: writeLease, cwd: worktreePath });
      logger.info(`[revision] Cycle ${cycle}: ${builderId} revision complete`);
    } catch (err) {
      logger.warn(`[revision] Cycle ${cycle}: ${builderId} revision failed: ${String(err)}`);
    }

    // 3. Capture new cumulative diff (initial build + revision stacked)
    let revisedDiff = diff;
    try {
      const handle = { memberId: builderId, worktreePath, branchName: '' };
      revisedDiff = await captureWorktreeDiff(handle, worktreeOpts);
    } catch (err) {
      logger.warn(`[revision] Cycle ${cycle}: could not capture revised diff: ${String(err)}`);
    }

    const proofCommands = opts.proofCommands && opts.proofCommands.length > 0
      ? await runRevisionProofCommands(worktreePath, opts.proofCommands)
      : [];

    // 4. Re-judge: each judge sees their prior verdict AND what the peer judge said
    const rejudgeVerdicts = await Promise.all(
      effectiveJudgeIds.map(async (judgeId): Promise<MemberVerdict> => {
        const prior = result.finalVerdicts.find(v => v.judgeId === judgeId);
        const peers = peerVerdictSummary(result.finalVerdicts, judgeId, reviewerLabels);
        const rejudgePrompt = buildRejudgePrompt(goal, revisedDiff, selfAssessment, prior?.rawOutput ?? '', judgeId, peers, cycle, proofCommands);
        try {
          const rejudgeWp = makeRevisionWorkPacket(rejudgePrompt, worktreePath);
          const judgeAdapter = makeJudge(judgeId, { ...rejudgeWp, objective: rejudgePrompt } as WorkPacket);
          const readLease = makeReadOnlyLease(worktreePath);
          const judgeResult = await runAdapter(judgeAdapter, { lease: readLease, cwd: worktreePath });
          return parseVerdict(judgeId, judgeResult.finalMessage ?? '');
        } catch (err) {
          return prior ?? {
            judgeId, verdict: 'UNCLEAR', confidence: 'LOW',
            scoreSuggestion: null, reason: String(err),
            blockingConcerns: [], dissentSummary: '', rawOutput: '',
          };
        }
      }),
    );

    const cycleConsensus = resolveConsensus(rejudgeVerdicts);
    let frontierReceipt: RecordCouncilRevisionReceiptResult | undefined;
    if (proofCommands.length > 0) {
      try {
        frontierReceipt = await recordCouncilRevisionFrontierReceipt({
          cwd: worktreePath,
          receipt: {
            dimensionId: opts.dimensionId ?? 'council-revision',
            runId: `council-revision.${builderId}.cycle-${cycle}.${Date.now()}`,
            cycle,
            builderId,
            judgeIds: effectiveJudgeIds,
            consensusBefore,
            consensusAfter: cycleConsensus,
            scoreBefore,
            scoreAfter: averageScoreSuggestion(rejudgeVerdicts),
            targetScore: opts.targetScore ?? 9,
            proofCommands,
            preservedApprovals,
            blockingConcerns,
            changedFiles: changedFilesFromDiff(revisedDiff),
            originalDiff: diff,
            revisedDiff,
          },
        });
        result.frontierReceipts.push(frontierReceipt);
        logger.info(`[revision] Cycle ${cycle}: frontier receipt ${frontierReceipt.timeMachineCommitId}`);
      } catch (err) {
        logger.warn(`[revision] Cycle ${cycle}: could not write frontier receipt: ${String(err)}`);
      }
    }

    result.cycles.push({ cycle, selfAssessment, revisedDiff, proofCommands, frontierReceipt, rejudgeVerdicts, consensus: cycleConsensus });
    result.finalVerdicts = rejudgeVerdicts;
    result.finalConsensus = cycleConsensus;
    result.finalDiff = revisedDiff;

    logger.info(`[revision] Cycle ${cycle}: ${builderId} post-revision consensus = ${cycleConsensus}`);
    if (cycleConsensus === 'PASS') break;
  }

  return result;
}
