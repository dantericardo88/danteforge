// Matrix Kernel — CouncilDebate
//
// Structured deliberation after a FAIL or SPLIT merge-court verdict.
// Flow per round:
//   1. Extract BLOCKING_ISSUES from failing judge verdicts
//   2. Builder responds with a REBUTTAL (explain what was done / propose fix)
//   3. Each judge sees the rebuttal and re-evaluates, may change verdict
//   4. If new consensus is PASS, stop; otherwise continue up to maxRounds
//
// Injection seam (_runPrompt) lets tests override the subprocess calls.
// Production path spawns adapters in judgeMode with debate-specific prompts.
import { logger } from '../../core/logger.js';
import { COUNCIL_PROFILES } from './council-member-profiles.js';
import { GeminiCLIAdapter } from '../adapters/gemini-cli-adapter.js';
import { GrokBuildAdapter } from '../adapters/grok-build-adapter.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentLease } from '../types/lease.js';
import type { CouncilMemberId } from './council-merge-court.js';
import { parseVerdict } from './council-verdict-parser.js';
import type { MemberVerdict } from './council-verdict-parser.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DebateRound {
  round: number;
  builderRebuttal: string;
  judgeUpdates: MemberVerdict[];
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
}

export interface DebateTranscript {
  builderId: CouncilMemberId;
  rounds: DebateRound[];
  finalConsensus: 'PASS' | 'FAIL' | 'SPLIT';
  finalVerdicts: MemberVerdict[];
}

export interface DebateOptions {
  builderId: CouncilMemberId;
  judgeIds: CouncilMemberId[];
  initialVerdicts: MemberVerdict[];
  goal: string;
  diff: string;
  worktreePath: string;
  maxRounds?: number;
  /**
   * Injection seam: spawn a member in judge/rebuttal mode and return raw output.
   * Production code builds a judgeMode adapter; tests inject a stub function.
   */
  _runPrompt?: (memberId: CouncilMemberId, prompt: string, cwd: string) => Promise<string>;
}

// ── Internal helpers (pure, no I/O) ──────────────────────────────────────────

function resolveConsensus(verdicts: MemberVerdict[]): 'PASS' | 'FAIL' | 'SPLIT' {
  if (verdicts.length === 0) return 'FAIL';
  const passes = verdicts.filter(v => v.verdict === 'PASS').length;
  const fails  = verdicts.filter(v => v.verdict === 'FAIL').length;
  if (passes > fails) return 'PASS';
  if (fails > passes) return 'FAIL';
  return 'SPLIT';
}


function extractBlockingIssues(verdicts: MemberVerdict[]): string {
  return verdicts
    .filter(v => v.verdict === 'FAIL')
    .map(v => {
      const m = v.rawOutput.match(/BLOCKING_ISSUES:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
      return `[${v.judgeId}] ${m ? m[1]!.trim() : v.reason}`;
    })
    .join('\n');
}

function buildRebuttalPrompt(goal: string, diff: string, blockingIssues: string, round: number): string {
  return [
    `DEBATE ROUND ${round} — BUILDER REBUTTAL`,
    ``,
    `You are the builder who produced this diff. The council judged it and found issues.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `Blocking issues raised:`,
    blockingIssues || '(no specific issues listed)',
    ``,
    `Diff (first 2000 chars):`,
    diff.slice(0, 2000),
    ``,
    `Explain what you implemented and why the blocking issues are addressed (or propose a concrete fix).`,
    `Be specific. Reference file names and function names from the diff.`,
    `Output format:`,
    `REBUTTAL: <your explanation>`,
  ].join('\n');
}

function buildReEvalPrompt(
  goal: string, diff: string, rebuttal: string,
  priorRawOutput: string, round: number, judgeId: CouncilMemberId,
): string {
  const persona = COUNCIL_PROFILES[judgeId]?.persona ?? judgeId;
  return [
    `DEBATE ROUND ${round} — JUDGE RE-EVALUATION`,
    `You are acting as: ${persona}`,
    ``,
    `You previously reviewed a diff. The builder has responded to your concerns.`,
    `Re-evaluate considering their rebuttal. You may change your verdict.`,
    ``,
    `Goal: ${goal}`,
    ``,
    `Diff (first 2000 chars):`,
    diff.slice(0, 2000),
    ``,
    `Builder's rebuttal:`,
    rebuttal.slice(0, 1500),
    ``,
    `Your prior verdict:`,
    priorRawOutput.slice(0, 500) || '(not available)',
    ``,
    `Output your UPDATED verdict in EXACTLY this format (all fields required):`,
    `VERDICT: PASS`,
    `CONFIDENCE: HIGH`,
    `REASON: <one paragraph>`,
    `SCORE_SUGGESTION: <number 0-10>`,
    `BLOCKING_ISSUES: none`,
    `BLOCKING_CONCERNS: none`,
    `DISSENT: none`,
    ``,
    `or VERDICT: FAIL with BLOCKING_ISSUES and BLOCKING_CONCERNS as bullet lists.`,
    `If you PASS but still have reservations, record them in DISSENT.`,
  ].join('\n');
}

// ── Production adapter factory (judge-mode only) ──────────────────────────────

function makeDebateWorkPacket(objective: string, cwd: string): WorkPacket {
  return {
    id: `council-debate.${Date.now()}`,
    dimensionId: 'council-debate',
    objective,
    acceptanceCriteria: ['Provide structured verdict or rebuttal output'],
    proof: { proofRequired: ['text output'] },
    globalForbidden: ['**'],
    context: { worktreePath: cwd },
  } as unknown as WorkPacket;
}

function makeReadOnlyLease(cwd: string): AgentLease {
  return {
    id: `debate-lease.${Date.now()}`,
    worktreePath: cwd,
    allowedWritePaths: [],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['**'],
  } as unknown as AgentLease;
}

function makeDebateAdapter(id: CouncilMemberId, wp: WorkPacket) {
  switch (id) {
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket: wp, judgeMode: true });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket: wp, judgeMode: true });
    case 'codex':       return new CodexAdapter({ workPacket: wp, judgeMode: true });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket: wp, judgeMode: true });
  }
}

async function defaultRunPrompt(
  memberId: CouncilMemberId,
  prompt: string,
  cwd: string,
): Promise<string> {
  const wp = makeDebateWorkPacket(prompt, cwd);
  const lease = makeReadOnlyLease(cwd);
  const adapter = makeDebateAdapter(memberId, wp);
  const result = await runAdapter(adapter, { lease, cwd });
  return result.finalMessage ?? '';
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runDebate(opts: DebateOptions): Promise<DebateTranscript> {
  const { builderId, judgeIds, goal, diff, worktreePath } = opts;
  const maxRounds = opts.maxRounds ?? 2;
  const runPrompt = opts._runPrompt ?? defaultRunPrompt;

  const transcript: DebateTranscript = {
    builderId,
    rounds: [],
    finalConsensus: resolveConsensus(opts.initialVerdicts),
    finalVerdicts: [...opts.initialVerdicts],
  };

  for (let round = 1; round <= maxRounds; round++) {
    if (resolveConsensus(transcript.finalVerdicts) === 'PASS') break;

    const blockingIssues = extractBlockingIssues(transcript.finalVerdicts);
    const rebuttalPrompt = buildRebuttalPrompt(goal, diff, blockingIssues, round);

    let builderRebuttal = '(no rebuttal)';
    try {
      builderRebuttal = await runPrompt(builderId, rebuttalPrompt, worktreePath);
      logger.info(`[debate] Round ${round}: ${builderId} rebuttal (${builderRebuttal.length} chars)`);
    } catch (err) {
      logger.warn(`[debate] Round ${round}: ${builderId} rebuttal failed: ${String(err)}`);
    }

    const judgeUpdates = await Promise.all(
      judgeIds.map(async (judgeId): Promise<MemberVerdict> => {
        const prior = transcript.finalVerdicts.find(v => v.judgeId === judgeId);
        const reEvalPrompt = buildReEvalPrompt(goal, diff, builderRebuttal, prior?.rawOutput ?? '', round, judgeId);
        try {
          const raw = await runPrompt(judgeId, reEvalPrompt, worktreePath);
          return parseVerdict(judgeId, raw);
        } catch (err) {
          return prior ?? {
            judgeId, verdict: 'UNCLEAR', confidence: 'LOW',
            scoreSuggestion: null, reason: String(err),
            blockingConcerns: [], dissentSummary: '', rawOutput: '',
          };
        }
      }),
    );

    const roundConsensus = resolveConsensus(judgeUpdates);
    transcript.rounds.push({ round, builderRebuttal, judgeUpdates, consensus: roundConsensus });
    transcript.finalVerdicts = judgeUpdates;
    transcript.finalConsensus = roundConsensus;

    logger.info(`[debate] Round ${round}: ${roundConsensus} — ${roundConsensus === 'PASS' ? 'PASS reached' : round < maxRounds ? 'continuing' : 'cap reached'}`);
    if (roundConsensus === 'PASS') break;
  }

  return transcript;
}
