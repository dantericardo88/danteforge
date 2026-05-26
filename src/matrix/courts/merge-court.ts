// Matrix Kernel — Merge Court (Phase 11 of PRD §22)
//
// Arbitrates which candidate branches enter the main branch. Inputs the gate
// reports, red-team reports, taste-gate requests for each candidate. Outputs
// MergeDecisions with reasoning and score deltas.
//
// Reuses (per Phase 0 audit):
//   - matrix-development-engine.ts:mergeScoreProposals (extend, don't replace)
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import type { AgentLease } from '../types/lease.js';
import type { WorkPacket } from '../types/work-graph.js';
import type {
  MergeCandidate,
  MergeDecision,
  MergeDecisionOutcome,
  MergeScoreDelta,
} from '../types/merge.js';
import type { GateReport, RedTeamReport, TasteGateRequest } from '../types/gate.js';
import type { ConflictReport } from '../types/conflict.js';
import { isBlockingStatus } from './taste-gate.js';
import { isBlockingConflict } from '../engines/conflict-radar.js';
import { scanForStubs, type StubScanResult } from './no-stub-scanner.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';
import type { SecurityCourtOptions } from './security-red-team.js';
import {
  runCapabilityTest,
  applyScoreCap,
  type CapabilityTestVerdict,
} from '../engines/capability-test-runner.js';
import type { CapabilityTestEntry } from '../types/capability-test.js';
import { CAPABILITY_TEST_SCORE_CAP } from '../types/capability-test.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface MergeCourtInput {
  candidate: MergeCandidate;
  lease: AgentLease;
  workPacket: WorkPacket;
  gateReport: GateReport;
  redTeamReport?: RedTeamReport;
  tasteGateRequest?: TasteGateRequest;
  /** Capability test entry for the dimension this packet addresses. */
  capabilityTest?: CapabilityTestEntry;
}

export interface RunMergeCourtOptions {
  candidates: MergeCourtInput[];
  conflictReport: ConflictReport;
  /** Base path for resolving relative filesChanged paths. Defaults to process.cwd(). */
  cwd?: string;
  /** Injection seam: replaces git-merge command runner for tests. */
  _runMerge?: (input: MergeCourtInput) => Promise<{ success: boolean; error?: string }>;
  /** Injection seam: replaces Time Machine commit creation. */
  _createTimeMachineCommit?: (input: MergeCourtInput) => Promise<{ eventId: string }>;
  /** Injection seam: replaces LOC violation check for tests. */
  _checkLocViolations?: (filesChanged: string[], cwd: string) => Promise<{ file: string; loc: number }[]>;
  /** Injection seam: replaces security court for tests. */
  _runSecurityCourt?: (filesChanged: string[], cwd: string, opts: SecurityCourtOptions) => Promise<{ recommendation: string; blockedBy: string[]; criticalCount: number }>;
  /** Injection seam: replaces capability_test runner for tests. */
  _runCapabilityTest?: (input: MergeCourtInput, cwd: string) => CapabilityTestVerdict;
  /** Injection seam: replaces stub scanner for tests. */
  _scanForStubs?: (files: string[], worktreeRoot: string) => Promise<StubScanResult>;
  _now?: () => string;
}

export interface MergeCourtResult {
  decisions: MergeDecision[];
  approvedCount: number;
  rejectedCount: number;
  blockedCount: number;
}

/**
 * Rank candidates and emit MergeDecisions. Approves at most one branch per
 * conflicting cluster; subsequent candidates that overlap with an approved
 * branch are marked SUPERSEDED_BY_BETTER_BRANCH.
 */
export async function runMergeCourt(
  options: RunMergeCourtOptions,
): Promise<MergeCourtResult> {
  const now = options._now ?? (() => new Date().toISOString());
  const decisions: MergeDecision[] = [];

  const ranked = rankCandidates(options.candidates);
  const approvedPaths = new Set<string>();

  const locCheckFn = options._checkLocViolations ?? checkLocViolations;
  const baseCwd = options.cwd ?? process.cwd();
  const securityCourtFn = options._runSecurityCourt ?? defaultRunSecurityCourt;
  const capabilityTestFn = options._runCapabilityTest ?? defaultRunCapabilityTest;
  const stubScanFn = options._scanForStubs ?? defaultScanForStubs;

  for (const candidate of ranked) {
    // LOC gate: block any candidate that introduced a .ts/.tsx file exceeding 750 lines
    const locViolations = await locCheckFn(candidate.candidate.filesChanged ?? [], baseCwd);
    if (locViolations.length > 0) {
      const detail = locViolations.map(v => `${v.file} (${v.loc} lines)`).join(', ');
      decisions.push(buildDecision(
        candidate,
        'BLOCKED_BY_POLICY',
        `LOC limit exceeded — split before merging: ${detail}`,
        undefined,
        now,
      ));
      continue;
    }

    // Zero-tolerance stub gate: block any candidate with TODO/stub/mock/not-implemented patterns.
    // No mocks. No stubs. No TODOs. Code without receipts is a hypothesis.
    const stubResult = await stubScanFn(candidate.candidate.filesChanged ?? [], baseCwd);
    if (!stubResult.ok) {
      const detail = stubResult.findings.slice(0, 3)
        .map(f => `${f.filePath}:${f.line} (${f.kind})`)
        .join('; ');
      const more = stubResult.findings.length > 3 ? ` + ${stubResult.findings.length - 3} more` : '';
      decisions.push(buildDecision(
        candidate,
        'BLOCKED_BY_POLICY',
        `Zero-tolerance: stub/TODO/mock patterns found — ${detail}${more}. Remove all stubs and implement real code.`,
        undefined,
        now,
      ));
      continue;
    }

    // Security gate: block any candidate with CRITICAL OWASP findings
    const securityResult = await securityCourtFn(candidate.candidate.filesChanged ?? [], baseCwd, {});
    if (securityResult.recommendation === 'block_merge') {
      const detail = securityResult.blockedBy.slice(0, 3).join('; ');
      decisions.push(buildDecision(
        candidate,
        'BLOCKED_BY_SECURITY',
        `Security court blocked: ${securityResult.criticalCount} CRITICAL finding(s) — ${detail}`,
        undefined,
        now,
      ));
      continue;
    }

    // Capability gate: if proposed score > 5.0, capability_test must pass.
    const capabilityVerdict = capabilityTestFn(candidate, baseCwd);
    const proposedAfter = candidate.candidate.scoreDelta?.after;
    if (proposedAfter !== undefined && proposedAfter > CAPABILITY_TEST_SCORE_CAP) {
      if (!capabilityVerdict.allowed) {
        const cappedScore = applyScoreCap(proposedAfter, capabilityVerdict);
        decisions.push(buildDecision(
          candidate,
          'BLOCKED_BY_POLICY',
          `capability_test gate: proposed score ${proposedAfter} exceeds ${CAPABILITY_TEST_SCORE_CAP} cap. ${capabilityVerdict.reason} Capped at ${cappedScore}.`,
          candidate.candidate.scoreDelta
            ? { ...candidate.candidate.scoreDelta, after: cappedScore }
            : undefined,
          now,
        ));
        continue;
      }
    }

    const outcome = arbitrate(candidate, options.conflictReport, approvedPaths);
    if (outcome === 'APPROVED') {
      const runMergeFn = options._runMerge ?? ((input: MergeCourtInput) => defaultRunMerge(input, baseCwd));
      const mergeResult = await runMergeFn(candidate);
      if (!mergeResult.success) {
        decisions.push(buildDecision(candidate, 'NEEDS_REPAIR', `merge failed: ${mergeResult.error ?? 'unknown'}`, undefined, now));
        continue;
      }
      const tm = options._createTimeMachineCommit
        ? await options._createTimeMachineCommit(candidate)
        : { eventId: `tm.event.${candidate.candidate.candidateId}.${stamp(now())}` };
      const decision = buildDecision(
        candidate,
        'APPROVED',
        'all gates passed; merge applied',
        candidate.candidate.scoreDelta,
        now,
        tm.eventId,
      );
      decisions.push(decision);
      for (const p of candidate.lease.allowedWritePaths) approvedPaths.add(p);
    } else {
      decisions.push(buildDecision(candidate, outcome, reasonFor(outcome, candidate), undefined, now));
    }
  }

  const approvedCount = decisions.filter(d => d.decision === 'APPROVED').length;
  const rejectedCount = decisions.filter(d => d.decision === 'REJECTED').length;
  const blockedCount = decisions.length - approvedCount - rejectedCount;

  return { decisions, approvedCount, rejectedCount, blockedCount };
}

export async function writeMergeDecisions(
  decisions: MergeDecision[],
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.mergeDecisions);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), decisions }, null, 2), 'utf8');
  return outPath;
}

// ── LOC gate ────────────────────────────────────────────────────────────────

const LOC_HARD_CAP = 750;

async function checkLocViolations(
  filesChanged: string[],
  cwd: string,
): Promise<{ file: string; loc: number }[]> {
  const violations: { file: string; loc: number }[] = [];
  for (const f of filesChanged) {
    if (!f.endsWith('.ts') && !f.endsWith('.tsx')) continue;
    try {
      const abs = path.isAbsolute(f) ? f : path.join(cwd, f);
      const content = await fs.readFile(abs, 'utf8');
      const loc = content.split('\n').length;
      if (loc > LOC_HARD_CAP) violations.push({ file: f, loc });
    } catch { /* best-effort — skip unreadable or missing files */ }
  }
  return violations;
}

// ── Ranking + arbitration ───────────────────────────────────────────────────

function rankCandidates(candidates: MergeCourtInput[]): MergeCourtInput[] {
  return [...candidates].sort((a, b) => {
    // 1. Higher score delta first
    const scoreA = a.candidate.scoreDelta?.after ?? 0;
    const scoreB = b.candidate.scoreDelta?.after ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    // 2. Lower risk first
    const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    const riskA = riskOrder[a.candidate.riskLevel ?? 'low'];
    const riskB = riskOrder[b.candidate.riskLevel ?? 'low'];
    if (riskA !== riskB) return riskA - riskB;
    // 3. Smaller blast radius first
    const blastA = a.candidate.blastRadius ?? 0;
    const blastB = b.candidate.blastRadius ?? 0;
    return blastA - blastB;
  });
}

function arbitrate(
  input: MergeCourtInput,
  conflictReport: ConflictReport,
  approvedPaths: Set<string>,
): MergeDecisionOutcome {
  // No-diff check (kernel discipline rule):
  // Reject any candidate that produced zero file changes unless the work
  // packet explicitly opts in to no-diff outcomes via `allowEmptyDiff`.
  // Without this, an autonomous loop could close gaps with empty
  // embedded-complete calls — defeating the purpose of merge-court.
  const filesChanged = input.candidate.filesChanged ?? [];
  if (!input.candidate.allowEmptyDiff && filesChanged.length === 0) {
    return 'REJECTED';
  }

  // Gate report status
  if (input.gateReport.status === 'failed') return 'REJECTED';

  // Red team
  if (input.redTeamReport) {
    if (input.redTeamReport.recommendation === 'block_merge') return 'BLOCKED_BY_RED_TEAM';
    if (input.redTeamReport.recommendation === 'require_human_review') return 'NEEDS_HUMAN_REVIEW';
  }

  // Taste gate
  if (input.tasteGateRequest && isBlockingStatus(input.tasteGateRequest.status)) {
    if (input.tasteGateRequest.status === 'approved') {
      // approved — proceed
    } else {
      return 'BLOCKED_BY_TASTE_GATE';
    }
  }

  // Conflicts
  for (const c of conflictReport.conflicts) {
    if (!isBlockingConflict(c)) continue;
    if (c.workPacketIds?.includes(input.workPacket.id)) return 'BLOCKED_BY_CONFLICT';
    if (c.leaseIds?.includes(input.lease.id)) return 'BLOCKED_BY_CONFLICT';
  }

  // Supersession: already-approved branch overlaps on owned paths
  for (const p of input.lease.allowedWritePaths) {
    if (approvedPaths.has(p)) return 'SUPERSEDED_BY_BETTER_BRANCH';
  }

  return 'APPROVED';
}

function reasonFor(outcome: MergeDecisionOutcome, input: MergeCourtInput): string {
  switch (outcome) {
    case 'REJECTED': {
      const filesChanged = input.candidate.filesChanged ?? [];
      if (!input.candidate.allowEmptyDiff && filesChanged.length === 0) {
        return 'No substantive diff — agent produced zero file changes for a packet that requested work.';
      }
      return `Gate report status: ${input.gateReport.status}`;
    }
    case 'BLOCKED_BY_RED_TEAM':
      return `Red team blocked: ${input.redTeamReport?.findings.map(f => f.detail).slice(0, 2).join('; ') ?? 'unspecified'}`;
    case 'NEEDS_HUMAN_REVIEW':
      return 'Red team requires human review';
    case 'BLOCKED_BY_TASTE_GATE':
      return `Taste gate status: ${input.tasteGateRequest?.status ?? 'unknown'}`;
    case 'BLOCKED_BY_CONFLICT':
      return 'Blocked by HIGH/CRITICAL conflict in radar';
    case 'SUPERSEDED_BY_BETTER_BRANCH':
      return 'Earlier-ranked branch covered the same paths';
    case 'NEEDS_REPAIR':
      return 'Merge attempt failed';
    case 'BLOCKED_BY_POLICY':
      return 'Policy gate blocked merge';
    case 'BLOCKED_BY_REGRESSION':
      return 'Post-merge regression detected';
    case 'BLOCKED_BY_SECURITY':
      return 'Security court blocked: CRITICAL OWASP finding in changed files';
    default:
      return '';
  }
}

function buildDecision(
  input: MergeCourtInput,
  outcome: MergeDecisionOutcome,
  reason: string,
  scoreDelta: MergeScoreDelta | undefined,
  now: () => string,
  timeMachineEventId?: string,
): MergeDecision {
  return {
    id: `merge.${input.candidate.candidateId}.${stamp(now())}`,
    candidateId: input.candidate.candidateId,
    leaseId: input.lease.id,
    branch: input.lease.branch,
    decision: outcome,
    reason,
    scoreDelta,
    timeMachineEventId,
    createdAt: now(),
    decidedBy: 'merge-court',
  };
}

async function defaultRunMerge(
  input: MergeCourtInput,
  cwd: string,
): Promise<{ success: boolean; error?: string }> {
  const branch = input.lease.branch;
  if (!branch) return { success: false, error: 'no branch in lease — cannot merge' };
  try {
    await execFileAsync(
      'git',
      ['merge', '--no-ff', branch, '-m', `merge-court: ${input.candidate.candidateId}`],
      { cwd, timeout: 60_000 },
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err).split('\n')[0] };
  }
}

function defaultRunCapabilityTest(input: MergeCourtInput, cwd: string): CapabilityTestVerdict {
  return runCapabilityTest({
    dimensionId: input.workPacket.dimensionId,
    capabilityTest: input.capabilityTest,
    cwd,
  });
}

async function defaultScanForStubs(files: string[], worktreeRoot: string): Promise<StubScanResult> {
  try {
    return scanForStubs({ files, worktreeRoot });
  } catch {
    return { ok: true, findings: [] }; // best-effort — never block on scanner error
  }
}

async function defaultRunSecurityCourt(
  filesChanged: string[],
  cwd: string,
  opts: SecurityCourtOptions,
): Promise<{ recommendation: string; blockedBy: string[]; criticalCount: number }> {
  try {
    const { runSecurityCourt } = await import('./security-red-team.js');
    return runSecurityCourt(filesChanged, cwd, opts);
  } catch {
    return { recommendation: 'allow_merge', blockedBy: [], criticalCount: 0 };
  }
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
