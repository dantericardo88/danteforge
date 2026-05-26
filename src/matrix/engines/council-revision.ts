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
  /** Injection seam: override builder adapter creation. */
  _makeBuilderAdapter?: (id: CouncilMemberId, wp: WorkPacket) => AgentAdapter;
  /** Injection seam: override judge adapter creation. */
  _makeJudgeAdapter?: (id: CouncilMemberId, wp: WorkPacket) => AgentAdapter;
}

export interface RevisionCycle {
  cycle: number;
  selfAssessment: string;
  revisedDiff: string;
  rejudgeVerdicts: MemberVerdict[];
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
}

export interface RevisionResult {
  cycles: RevisionCycle[];
  finalVerdicts: MemberVerdict[];
  finalConsensus: 'PASS' | 'FAIL' | 'SPLIT';
  /** The last revised diff — what judges actually evaluated. Use this for merging, not the original diff. */
  finalDiff: string;
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

/** Full picture: what each judge said, separated into preserve vs fix buckets. */
function extractAllJudgeFeedback(verdicts: MemberVerdict[]): { preserveContext: string; fixContext: string } {
  const passes = verdicts.filter(v => v.verdict === 'PASS');
  const fails  = verdicts.filter(v => v.verdict === 'FAIL' || v.verdict === 'UNCLEAR');

  const preserveLines = passes.map(v => `[${v.judgeId} APPROVED]: ${v.reason}`);

  const fixLines = fails.flatMap(v => {
    const issueMatch = v.rawOutput.match(/BLOCKING_ISSUES:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
    const issues = issueMatch ? issueMatch[1]!.trim() : '';
    return [
      `[${v.judgeId} BLOCKED]: ${v.reason}`,
      ...(issues && issues.toLowerCase() !== 'none' ? [`  Issues: ${issues}`] : []),
    ];
  });

  return {
    preserveContext: preserveLines.join('\n') || '(no approvals yet)',
    fixContext: fixLines.join('\n') || '(no specific issues listed)',
  };
}

/** Compact peer-verdict summary for rejudge prompts (each judge sees what the other said). */
function peerVerdictSummary(verdicts: MemberVerdict[], excludeJudgeId: string): string {
  return verdicts
    .filter(v => v.judgeId !== excludeJudgeId)
    .map(v => `[${v.judgeId}: ${v.verdict}] ${v.reason.slice(0, 200)}`)
    .join('\n') || '(no peer verdict available)';
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
    `If the builder specifically addressed your blocking concerns, vote PASS.`,
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

  const result: RevisionResult = {
    cycles: [],
    finalVerdicts: [...opts.initialVerdicts],
    finalConsensus: resolveConsensus(opts.initialVerdicts),
    finalDiff: diff,
  };

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    if (resolveConsensus(result.finalVerdicts) === 'PASS') break;

    const { preserveContext, fixContext } = extractAllJudgeFeedback(result.finalVerdicts);
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

    // 4. Re-judge: each judge sees their prior verdict AND what the peer judge said
    const rejudgeVerdicts = await Promise.all(
      judgeIds.map(async (judgeId): Promise<MemberVerdict> => {
        const prior = result.finalVerdicts.find(v => v.judgeId === judgeId);
        const peers = peerVerdictSummary(result.finalVerdicts, judgeId);
        const rejudgePrompt = buildRejudgePrompt(goal, revisedDiff, selfAssessment, prior?.rawOutput ?? '', judgeId, peers, cycle);
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
    result.cycles.push({ cycle, selfAssessment, revisedDiff, rejudgeVerdicts, consensus: cycleConsensus });
    result.finalVerdicts = rejudgeVerdicts;
    result.finalConsensus = cycleConsensus;
    result.finalDiff = revisedDiff;

    logger.info(`[revision] Cycle ${cycle}: ${builderId} post-revision consensus = ${cycleConsensus}`);
    if (cycleConsensus === 'PASS') break;
  }

  return result;
}
