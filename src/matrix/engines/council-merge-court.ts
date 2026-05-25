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
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { GeminiCLIAdapter } from '../adapters/gemini-cli-adapter.js';
import { GrokBuildAdapter } from '../adapters/grok-build-adapter.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentLease } from '../types/lease.js';
import type { CouncilWorktreeHandle } from './council-worktree.js';
import { captureWorktreeDiff, getChangedFiles } from './council-worktree.js';
import type { CouncilWorktreeOpts } from './council-worktree.js';
import { runDebate } from './council-debate.js';
import type { FileClaims } from './council-file-claims.js';

const execFileAsync = promisify(execFile);

export type CouncilMemberId = 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code';

export interface MemberVerdict {
  judgeId: CouncilMemberId;
  verdict: 'PASS' | 'FAIL' | 'UNCLEAR';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  scoreSuggestion: number | null;
  reason: string;
  rawOutput: string;
}

export interface MergeCourtResult {
  memberId: CouncilMemberId;
  worktreePath: string;
  changedFiles: string[];
  verdicts: MemberVerdict[];
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
  merged: boolean;
  mergeError?: string;
}

export interface MergeCourtOptions {
  projectPath: string;
  worktreeOpts: CouncilWorktreeOpts;
  handles: CouncilWorktreeHandle[];
  allMemberIds: CouncilMemberId[];
  goal: string;
  /** When provided, builders whose ALL changed files are claimed by another member are skipped. */
  fileClaims?: FileClaims;
}

// ── Verdict parsing (self-contained — no import from CLI layer) ───────────────

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

  return { judgeId, verdict, confidence, scoreSuggestion, reason, rawOutput };
}

function resolveConsensus(verdicts: MemberVerdict[]): 'PASS' | 'FAIL' | 'SPLIT' {
  if (verdicts.length === 0) return 'FAIL';
  const passes = verdicts.filter(v => v.verdict === 'PASS').length;
  const fails  = verdicts.filter(v => v.verdict === 'FAIL').length;
  if (passes > fails) return 'PASS';
  if (fails > passes) return 'FAIL';
  return 'SPLIT';
}

// ── Judge adapter factory (judge-mode only) ───────────────────────────────────

function makeJudgeWorkPacket(goal: string, diff: string, worktreePath: string): WorkPacket {
  const diffSnippet = diff.slice(0, 4000);
  return {
    id: `merge-court.${Date.now()}`,
    dimensionId: 'council-review',
    objective: [
      `You are an independent code reviewer. READ ONLY — do NOT make changes.`,
      ``,
      `Evaluate whether the following diff correctly implements: ${goal}`,
      ``,
      `DIFF (first 4000 chars):`,
      diffSnippet || '(no diff — builder made no changes)',
      ``,
      `Output your verdict in EXACTLY this format:`,
      `VERDICT: PASS`,
      `CONFIDENCE: HIGH`,
      `REASON: <one paragraph>`,
      `SCORE_SUGGESTION: <number 0-10>`,
      `BLOCKING_ISSUES: none`,
      ``,
      `or VERDICT: FAIL with BLOCKING_ISSUES as a bullet list.`,
      `Be harsh. Only PASS if the implementation is real and non-trivial.`,
    ].join('\n'),
    acceptanceCriteria: ['Rendered verdict with VERDICT, CONFIDENCE, REASON, SCORE_SUGGESTION, BLOCKING_ISSUES'],
    proof: { proofRequired: ['verdict output'] },
    globalForbidden: ['**'],
    context: { worktreePath },
  } as unknown as WorkPacket;
}

function makeReadOnlyLease(worktreePath: string): AgentLease {
  return {
    id: `merge-court-lease.${Date.now()}`,
    worktreePath,
    allowedWritePaths: [],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['**'],
  } as unknown as AgentLease;
}

function makeJudgeAdapter(id: CouncilMemberId, workPacket: WorkPacket) {
  switch (id) {
    case 'gemini-cli':  return new GeminiCLIAdapter({ workPacket, judgeMode: true });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket, judgeMode: true });
    case 'codex':       return new CodexAdapter({ workPacket, judgeMode: true });
    case 'claude-code': return new ClaudeCodeAdapter({ workPacket, judgeMode: true });
  }
}

// ── Merge via git apply ───────────────────────────────────────────────────────

async function applyDiffToMain(diff: string, projectPath: string): Promise<void> {
  if (!diff.trim()) return;
  const tmpFile = path.join(os.tmpdir(), `council-patch-${Date.now()}.patch`);
  try {
    await fs.writeFile(tmpFile, diff, 'utf8');
    await execFileAsync('git', ['apply', '--whitespace=nowarn', '--3way', tmpFile], {
      cwd: projectPath, timeout: 60_000,
    });
  } finally {
    await fs.unlink(tmpFile).catch(() => { /* ignore */ });
  }
}

// ── Main merge court entry point ──────────────────────────────────────────────

export async function runMergeCourt(opts: MergeCourtOptions): Promise<MergeCourtResult[]> {
  const results: MergeCourtResult[] = [];

  for (const handle of opts.handles) {
    const builderId = handle.memberId as CouncilMemberId;

    const diff = await captureWorktreeDiff(handle, opts.worktreeOpts);
    const changedFiles = await getChangedFiles(handle.worktreePath);

    if (changedFiles.length === 0) {
      logger.info(`[merge-court] ${builderId}: no changes — skipping judge phase`);
      results.push({ memberId: builderId, worktreePath: handle.worktreePath,
        changedFiles: [], verdicts: [], consensus: 'FAIL', merged: false });
      continue;
    }

    // File-claim gate: if all changed files are already claimed by another member, skip merge.
    if (opts.fileClaims) {
      const allClaimed = changedFiles.every(f => opts.fileClaims!.hasConflict(builderId as CouncilMemberId, [f]));
      if (allClaimed) {
        logger.warn(`[merge-court] ${builderId}: all ${changedFiles.length} file(s) claimed by other members — skipping (structural gate)`);
        results.push({ memberId: builderId, worktreePath: handle.worktreePath,
          changedFiles, verdicts: [], consensus: 'FAIL', merged: false,
          mergeError: 'all files claimed by other council members' });
        continue;
      }
    }

    const judgeIds = opts.allMemberIds.filter(id => id !== builderId);
    logger.info(`[merge-court] ${builderId}: ${changedFiles.length} file(s) changed → ${judgeIds.length} judge(s)`);

    const workPacket = makeJudgeWorkPacket(opts.goal, diff, handle.worktreePath);
    const lease = makeReadOnlyLease(handle.worktreePath);

    const verdicts = await Promise.all(
      judgeIds.map(async (judgeId): Promise<MemberVerdict> => {
        try {
          const adapter = makeJudgeAdapter(judgeId, workPacket);
          const result = await runAdapter(adapter, { lease, cwd: handle.worktreePath });
          return parseVerdict(judgeId, result.finalMessage ?? '');
        } catch (err) {
          return { judgeId, verdict: 'UNCLEAR', confidence: 'LOW',
            scoreSuggestion: null, reason: String(err), rawOutput: '' };
        }
      }),
    );

    let finalVerdicts = verdicts;
    let consensus = resolveConsensus(verdicts);

    // If initial verdict is FAIL or SPLIT, offer the builder a structured
    // rebuttal — judges may change their verdict after hearing the explanation.
    if ((consensus === 'FAIL' || consensus === 'SPLIT') && judgeIds.length > 0) {
      logger.info(`[merge-court] ${builderId}: ${consensus} — starting debate (up to 2 rounds)`);
      try {
        const transcript = await runDebate({
          builderId,
          judgeIds,
          initialVerdicts: verdicts,
          goal: opts.goal,
          diff,
          worktreePath: handle.worktreePath,
          maxRounds: 2,
        });
        finalVerdicts = transcript.finalVerdicts;
        consensus = transcript.finalConsensus;
        logger.info(`[merge-court] ${builderId}: post-debate consensus = ${consensus} (${transcript.rounds.length} round(s))`);
      } catch (err) {
        logger.warn(`[merge-court] ${builderId}: debate failed — using initial verdict: ${String(err)}`);
      }
    }

    let merged = false;
    let mergeError: string | undefined;

    if (consensus === 'PASS') {
      try {
        await applyDiffToMain(diff, opts.projectPath);
        merged = true;
        logger.info(`[merge-court] ✓ ${builderId}: PASS — diff applied to main working tree`);
      } catch (err) {
        mergeError = String(err);
        logger.warn(`[merge-court] ✗ ${builderId}: diff application failed: ${mergeError}`);
      }
    } else {
      logger.info(`[merge-court] ${builderId}: ${consensus} — changes isolated in worktree ${handle.worktreePath}`);
    }

    results.push({ memberId: builderId, worktreePath: handle.worktreePath,
      changedFiles, verdicts: finalVerdicts, consensus, merged, mergeError });
  }

  return results;
}
