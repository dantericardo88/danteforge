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
import { captureWorktreeDiff } from './council-worktree.js';
import type { CouncilWorktreeOpts } from './council-worktree.js';
import type { CouncilMemberId, MemberVerdict } from './council-merge-court.js';

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

function parseVerdict(judgeId: CouncilMemberId, rawOutput: string): MemberVerdict {
  const up = rawOutput.toUpperCase();
  const verdict: 'PASS' | 'FAIL' | 'UNCLEAR' =
    up.includes('VERDICT: PASS') ? 'PASS' :
    up.includes('VERDICT: FAIL') ? 'FAIL' : 'UNCLEAR';
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
    up.includes('CONFIDENCE: HIGH') ? 'HIGH' :
    up.includes('CONFIDENCE: MEDIUM') ? 'MEDIUM' : 'LOW';
  const scoreMatch = rawOutput.match(/SCORE_SUGGESTION:\s*([\d.]+)/i);
  const scoreSuggestion = scoreMatch ? parseFloat(scoreMatch[1]!) : null;
  const reasonMatch = rawOutput.match(/REASON:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const reason = reasonMatch ? reasonMatch[1]!.trim().slice(0, 300) : rawOutput.slice(0, 200);
  const concernsMatch = rawOutput.match(/BLOCKING_CONCERNS:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const blockingConcerns = concernsMatch && concernsMatch[1]!.trim().toLowerCase() !== 'none'
    ? concernsMatch[1]!.trim().split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
    : [];
  const dissentMatch = rawOutput.match(/DISSENT:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const dissentSummary = dissentMatch && dissentMatch[1]!.trim().toLowerCase() !== 'none'
    ? dissentMatch[1]!.trim().slice(0, 300) : '';
  return { judgeId, verdict, confidence, scoreSuggestion, reason, blockingConcerns, dissentSummary, rawOutput };
}

function extractBlockingConcerns(verdicts: MemberVerdict[]): string {
  const lines = verdicts
    .filter(v => v.verdict === 'FAIL' || v.verdict === 'UNCLEAR')
    .flatMap(v => {
      const issueMatch = v.rawOutput.match(/BLOCKING_ISSUES:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
      const issues = issueMatch ? issueMatch[1]!.trim() : '';
      return [`[${v.judgeId}] ${v.reason}`, ...(issues && issues.toLowerCase() !== 'none' ? [issues] : [])];
    });
  return lines.join('\n') || '(no specific issues listed)';
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSelfInspectPrompt(goal: string, diff: string, blockingConcerns: string): string {
  return [
    `SELF-INSPECTION — you built this diff. Read it along with the judge feedback below.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `Judge blocking concerns:`,
    blockingConcerns,
    ``,
    `Your diff (first 2000 chars):`,
    diff.slice(0, 2000),
    ``,
    `DO NOT write any files. Output ONLY a structured self-assessment:`,
    `SELF_ASSESSMENT: <what you implemented, what the judges flagged, what you would specifically change>`,
  ].join('\n');
}

function buildRevisionPrompt(goal: string, blockingConcerns: string, selfAssessment: string, cycle: number): string {
  return [
    `REVISION CYCLE ${cycle} — address the judges' blocking concerns in this worktree.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `Blocking concerns to address:`,
    blockingConcerns,
    ``,
    `Your self-assessment:`,
    selfAssessment.slice(0, 800),
    ``,
    `Make targeted fixes ONLY to address the blocking concerns above.`,
    `Do NOT add unrelated changes. Do NOT add stubs or TODOs.`,
    `When done, stop — do not emit JSON, changes are detected via git status.`,
  ].join('\n');
}

function buildRejudgePrompt(
  goal: string, revisedDiff: string, selfAssessment: string,
  priorRawOutput: string, judgeId: CouncilMemberId, cycle: number,
): string {
  const persona = COUNCIL_PROFILES[judgeId]?.persona ?? judgeId;
  return [
    `REVISION RE-EVALUATION (cycle ${cycle}) — You are acting as: ${persona}`,
    ``,
    `The builder received your feedback and has revised their implementation.`,
    `Re-evaluate the REVISED diff below. You may update your verdict.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `Builder's self-assessment (what they changed and why):`,
    selfAssessment.slice(0, 600),
    ``,
    `Revised diff (first 2000 chars):`,
    revisedDiff.slice(0, 2000),
    ``,
    `Your prior verdict (for reference):`,
    priorRawOutput.slice(0, 300) || '(not available)',
    ``,
    `Output your UPDATED verdict in EXACTLY this format:`,
    `VERDICT: PASS`,
    `CONFIDENCE: HIGH`,
    `REASON: <one paragraph>`,
    `SCORE_SUGGESTION: <number 0-10>`,
    `BLOCKING_ISSUES: none`,
    `BLOCKING_CONCERNS: none`,
    `DISSENT: none`,
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

function makeReadOnlyLease(worktreePath: string): AgentLease {
  return {
    id: `revision-inspect-lease.${Date.now()}`,
    worktreePath,
    allowedWritePaths: [],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['**'],
  } as unknown as AgentLease;
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

    const blockingConcerns = extractBlockingConcerns(result.finalVerdicts);
    logger.info(`[revision] Cycle ${cycle}/${maxCycles}: ${builderId} addressing ${result.finalVerdicts.filter(v => v.verdict !== 'PASS').length} FAIL/UNCLEAR verdict(s)`);

    // 1. Self-inspection: builder reads its diff + judge feedback
    let selfAssessment = '(self-inspection skipped)';
    try {
      const inspectPrompt = buildSelfInspectPrompt(goal, diff, blockingConcerns);
      const inspectWp = makeRevisionWorkPacket(inspectPrompt, worktreePath);
      const inspectAdapter = makeBuilder(builderId, { ...inspectWp, objective: inspectPrompt } as WorkPacket);
      const inspectLease = makeReadOnlyLease(worktreePath);
      const inspectResult = await runAdapter(inspectAdapter, { lease: inspectLease, cwd: worktreePath });
      selfAssessment = inspectResult.finalMessage?.slice(0, 800) ?? '(no self-assessment output)';
      logger.info(`[revision] Cycle ${cycle}: ${builderId} self-assessment (${selfAssessment.length} chars)`);
    } catch (err) {
      logger.warn(`[revision] Cycle ${cycle}: ${builderId} self-inspection failed: ${String(err)}`);
    }

    // 2. Revision: builder addresses blocking concerns in the same worktree
    try {
      const revisionPrompt = buildRevisionPrompt(goal, blockingConcerns, selfAssessment, cycle);
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

    // 4. Re-judge: run original judges on the revised diff with self-assessment as context
    const rejudgeVerdicts = await Promise.all(
      judgeIds.map(async (judgeId): Promise<MemberVerdict> => {
        const prior = result.finalVerdicts.find(v => v.judgeId === judgeId);
        const rejudgePrompt = buildRejudgePrompt(goal, revisedDiff, selfAssessment, prior?.rawOutput ?? '', judgeId, cycle);
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
