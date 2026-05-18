import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  computeGapPriority,
  computeOverallScore,
  loadMatrix,
  updateDimensionScore,
  type CompeteMatrix,
  type MatrixDimension,
} from './compete-matrix.js';
import { createTimeMachineCommit, type CreateTimeMachineCommitOptions } from './time-machine.js';
import { logger } from './logger.js';
import {
  runCapabilityTest,
  applyScoreCap,
  type RunCapabilityTestOptions,
} from '../matrix/engines/capability-test-runner.js';
import type { CapabilityTestEntry } from '../matrix/types/capability-test.js';
import { CAPABILITY_TEST_SCORE_CAP } from '../matrix/types/capability-test.js';

export type MatrixMergePolicy = 'harsh-min' | 'latest' | 'manual';

export interface MatrixDevelopmentClaim {
  claimId: string;
  dimensionId: string;
  dimensionNumber: number;
  agent: string;
  claimedAt: string;
  baselineScore: number;
  matrixHash: string;
  claimPath: string;
}

export interface MatrixDevelopmentProposal {
  id: string;
  dimensionId: string;
  dimensionNumber: number;
  agent: string;
  proposedScore: number;
  baselineScore: number;
  rationale: string;
  evidence: string[];
  createdAt: string;
  baselineMatrixHash: string;
  commit?: string;
  proposalPath: string;
}

export interface MatrixDevelopmentMergeReceipt {
  id: string;
  policy: MatrixMergePolicy;
  agent: string;
  mergedAt: string;
  matrixHashBefore: string;
  matrixHashAfter: string;
  beforeTimeMachineCommitId?: string;
  afterTimeMachineCommitId?: string;
  proposalIds: string[];
  selectedProposalIds: string[];
  rejected: MatrixDevelopmentProposal[];
  merged: Array<{
    dimensionId: string;
    before: number;
    after: number;
    selectedProposalId: string;
    clampedByCeiling: boolean;
  }>;
  receiptPath: string;
}

export interface MatrixStatus {
  matrixPath: string;
  matrixHash: string;
  overallSelfScore: number;
  topDimensions: Array<{
    number: number;
    id: string;
    label: string;
    score: number;
    priority: number;
    ceiling?: number;
  }>;
}

export interface MatrixDevelopmentEngineOptions {
  cwd?: string;
  top?: number;
  _now?: () => string;
  _createTimeMachineCommit?: (options: CreateTimeMachineCommitOptions) => Promise<{ commitId: string }>;
}

const MATRIX_REL = '.danteforge/compete/matrix.json';
const CLAIM_DIR_REL = '.danteforge/dimension-claims';
const PROPOSAL_DIR_REL = '.danteforge/score-proposals';
const RECEIPT_DIR_REL = '.danteforge/score-proposals/merge-receipts';
const HISTORY_REL = '.danteforge/score-proposals/history.jsonl';
const LOCK_REL = '.danteforge/score-proposals/merge.lock';

function rel(...parts: string[]): string {
  return parts.join('/').replace(/\\/g, '/');
}

function abs(cwd: string, relPath: string): string {
  return path.join(cwd, relPath);
}

async function ensureDirs(cwd: string): Promise<void> {
  await fs.mkdir(abs(cwd, CLAIM_DIR_REL), { recursive: true });
  await fs.mkdir(abs(cwd, PROPOSAL_DIR_REL), { recursive: true });
  await fs.mkdir(abs(cwd, RECEIPT_DIR_REL), { recursive: true });
}

async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function hashFile(file: string): Promise<string> {
  const raw = await readTextIfExists(file);
  if (raw === null) throw new Error(`Missing ${MATRIX_REL}; run compete --init first.`);
  return createHash('sha256').update(raw).digest('hex');
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

function safeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function getScore(dim: MatrixDimension): number {
  return dim.scores.self ?? 0;
}

async function requireMatrix(cwd: string): Promise<CompeteMatrix> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error(`Missing ${MATRIX_REL}; run compete --init first.`);
  return matrix;
}

function resolveDimension(matrix: CompeteMatrix, idOrNumber: string | number): { dim: MatrixDimension; number: number } {
  if (typeof idOrNumber === 'number' || /^\d+$/.test(String(idOrNumber))) {
    const index = Number(idOrNumber) - 1;
    const dim = matrix.dimensions[index];
    if (!dim) throw new Error(`Dimension number ${idOrNumber} not found.`);
    return { dim, number: index + 1 };
  }

  const wanted = String(idOrNumber).toLowerCase();
  const dim = matrix.dimensions.find(d =>
    d.id.toLowerCase() === wanted || d.label.toLowerCase() === wanted,
  );
  if (!dim) throw new Error(`Dimension "${idOrNumber}" not found.`);
  return { dim, number: matrix.dimensions.indexOf(dim) + 1 };
}

async function listJsonFiles(cwd: string, relDir: string): Promise<string[]> {
  const dir = abs(cwd, relDir);
  try {
    const names = await fs.readdir(dir);
    return names.filter(name => name.endsWith('.json')).map(name => rel(relDir, name));
  } catch {
    return [];
  }
}

async function listClaimFiles(cwd: string): Promise<string[]> {
  try {
    const names = await fs.readdir(abs(cwd, CLAIM_DIR_REL));
    return names.filter(name => name !== '.gitkeep').map(name => rel(CLAIM_DIR_REL, name));
  } catch {
    return [];
  }
}

async function loadProposals(cwd: string): Promise<MatrixDevelopmentProposal[]> {
  const files = await listJsonFiles(cwd, PROPOSAL_DIR_REL);
  const proposals: MatrixDevelopmentProposal[] = [];
  for (const file of files) {
    if (file.includes('/merge-receipts/')) continue;
    proposals.push(JSON.parse(await fs.readFile(abs(cwd, file), 'utf8')) as MatrixDevelopmentProposal);
  }
  return proposals;
}

async function withMergeLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  await ensureDirs(cwd);
  const lockPath = abs(cwd, LOCK_REL);
  const handle = await fs.open(lockPath, 'wx').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Matrix merge already in progress: ${LOCK_REL}`);
    }
    throw error;
  });
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, claimedAt: new Date().toISOString() }, null, 2));
    return await fn();
  } finally {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  }
}

function chooseProposal(
  proposals: MatrixDevelopmentProposal[],
  policy: MatrixMergePolicy,
): MatrixDevelopmentProposal {
  if (policy === 'manual') {
    throw new Error('Manual merge policy requires an explicit implementation-specific selector.');
  }
  if (policy === 'latest') {
    return [...proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
  }
  return proposals.reduce((best, item) => item.proposedScore < best.proposedScore ? item : best);
}

function uniqueExistingPaths(cwd: string, paths: string[]): Promise<string[]> {
  return Promise.all([...new Set(paths)].map(async p => {
    const exists = await readTextIfExists(abs(cwd, p));
    return exists === null ? null : p;
  })).then(values => values.filter((p): p is string => p !== null));
}

export async function getMatrixStatus(options: MatrixDevelopmentEngineOptions = {}): Promise<MatrixStatus> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const matrix = await requireMatrix(cwd);
  const top = options.top ?? 4;
  const topDimensions = matrix.dimensions
    .map((dim, index) => ({
      number: index + 1,
      id: dim.id,
      label: dim.label,
      score: getScore(dim),
      priority: computeGapPriority(dim),
      ceiling: dim.ceiling,
    }))
    .filter(dim => dim.score < (dim.ceiling ?? 9))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, top);

  return {
    matrixPath: MATRIX_REL,
    matrixHash: await hashFile(abs(cwd, MATRIX_REL)),
    overallSelfScore: matrix.overallSelfScore,
    topDimensions,
  };
}

export async function claimDimension(options: MatrixDevelopmentEngineOptions & {
  dimension: string | number;
  agent: string;
}): Promise<MatrixDevelopmentClaim> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  await ensureDirs(cwd);
  const matrix = await requireMatrix(cwd);
  const { dim, number } = resolveDimension(matrix, options.dimension);
  const claim: MatrixDevelopmentClaim = {
    claimId: `claim_${randomUUID()}`,
    dimensionId: dim.id,
    dimensionNumber: number,
    agent: options.agent,
    claimedAt: options._now?.() ?? new Date().toISOString(),
    baselineScore: getScore(dim),
    matrixHash: await hashFile(abs(cwd, MATRIX_REL)),
    claimPath: rel(CLAIM_DIR_REL, `${safeSegment(dim.id)}-${safeSegment(options.agent)}.lock`),
  };
  await writeJsonAtomic(abs(cwd, claim.claimPath), claim);
  return claim;
}

export async function writeScoreProposal(options: MatrixDevelopmentEngineOptions & {
  dimension: string | number;
  score: number;
  agent: string;
  rationale: string;
  evidence?: string | string[];
  commit?: string;
}): Promise<MatrixDevelopmentProposal> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  await ensureDirs(cwd);
  const matrix = await requireMatrix(cwd);
  const { dim, number } = resolveDimension(matrix, options.dimension);
  const proposalId = `proposal_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const proposal: MatrixDevelopmentProposal = {
    id: proposalId,
    dimensionId: dim.id,
    dimensionNumber: number,
    agent: options.agent,
    proposedScore: Math.max(0, Math.min(10, options.score)),
    baselineScore: getScore(dim),
    rationale: options.rationale,
    evidence: Array.isArray(options.evidence) ? options.evidence : options.evidence ? [options.evidence] : [],
    createdAt: options._now?.() ?? new Date().toISOString(),
    baselineMatrixHash: await hashFile(abs(cwd, MATRIX_REL)),
    ...(options.commit ? { commit: options.commit } : {}),
    proposalPath: rel(PROPOSAL_DIR_REL, `${proposalId}.json`),
  };
  await writeJsonAtomic(abs(cwd, proposal.proposalPath), proposal);
  return proposal;
}

export async function mergeScoreProposals(options: MatrixDevelopmentEngineOptions & {
  policy?: MatrixMergePolicy;
  agent?: string;
  /** Injection seam: replaces capability_test runner for tests. */
  _runCapabilityTest?: (opts: RunCapabilityTestOptions) => ReturnType<typeof runCapabilityTest>;
  /** Injection seam: replaces harden gate for tests. */
  _runHardenGate?: (opts: import('../matrix/types/harden-check.js').RunHardenGateOptions) => Promise<import('../matrix/types/harden-check.js').HardenVerdict>;
  /** Operator-only: bypasses the harden gate. Should NEVER be set in production crusades. */
  _skipHardenGate?: boolean;
} = {}): Promise<MatrixDevelopmentMergeReceipt> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  return withMergeLock(cwd, async () => {
    const policy = options.policy ?? 'harsh-min';
    const agent = options.agent ?? 'matrix-engine';
    const proposals = await loadProposals(cwd);
    if (proposals.length === 0) throw new Error('No score proposals to merge.');

    const proposalPaths = proposals.map(p => p.proposalPath);
    const evidencePaths = proposals.flatMap(p => p.evidence);
    const beforeSnapshotPaths = await uniqueExistingPaths(cwd, [
      MATRIX_REL,
      ...proposalPaths,
      ...await listClaimFiles(cwd),
      ...evidencePaths,
    ]);
    const createCommit = options._createTimeMachineCommit ?? createTimeMachineCommit;
    const beforeTm = await createCommit({
      cwd,
      paths: beforeSnapshotPaths,
      label: 'matrix merge before',
      causalLinks: {
        materials: proposalPaths,
        inputDependencies: proposals.map(p => ({
          verdictId: p.id,
          paths: [p.proposalPath, ...p.evidence],
          commitIds: [],
        })),
      },
    });

    const matrix = await requireMatrix(cwd);
    const hashBefore = await hashFile(abs(cwd, MATRIX_REL));
    const byDim = new Map<string, MatrixDevelopmentProposal[]>();
    for (const proposal of proposals) {
      const group = byDim.get(proposal.dimensionId) ?? [];
      group.push(proposal);
      byDim.set(proposal.dimensionId, group);
    }

    const selected = new Set<string>();
    const merged: MatrixDevelopmentMergeReceipt['merged'] = [];
    for (const [dimensionId, group] of byDim) {
      const proposal = chooseProposal(group, policy);
      const dim = matrix.dimensions.find(d => d.id === dimensionId);
      if (!dim) continue;
      const before = getScore(dim);

      // capability_test gate: clamp scores > 5.0 if test absent or fails
      let finalScore = proposal.proposedScore;
      if (finalScore > CAPABILITY_TEST_SCORE_CAP) {
        const capTest = (dim as unknown as Record<string, unknown>).capability_test as CapabilityTestEntry | undefined;
        const capRunFn = options._runCapabilityTest ?? runCapabilityTest;
        const verdict = capRunFn({ dimensionId, capabilityTest: capTest, cwd });
        finalScore = applyScoreCap(finalScore, verdict);
        if (!verdict.allowed) {
          logger.warn(`[score-gate] ${dimensionId}: ${verdict.reason}`);
        } else {
          logger.success(`[score-gate] ${dimensionId}: capability_test passed ✓ — score ${proposal.proposedScore} accepted`);
        }
      }

      // Phase C harden gate: sibling check that fires at score ≥ 7.0.
      // Verifies the code is actually reached by production, claims match reality,
      // and there are no hidden hardcoded fallbacks. Deterministic — no LLM judgment.
      const { HARDEN_GATE_THRESHOLD, applyHardenCap: applyHCap } = await import('../matrix/types/harden-check.js');
      if (finalScore >= HARDEN_GATE_THRESHOLD && !options._skipHardenGate) {
        const { runHardenGate: defaultHardenGate } = await import('../matrix/engines/hardener.js');
        const hardenFn = options._runHardenGate ?? defaultHardenGate;
        try {
          const hVerdict = await hardenFn({ dimensionId, dim, cwd });
          finalScore = applyHCap(finalScore, hVerdict);
          if (!hVerdict.allowed) {
            const failed = hVerdict.checks.filter(c => !c.passed && !c.skipped).map(c => c.check).join(', ');
            logger.warn(`[harden-gate] ${dimensionId}: capped at ${finalScore} — failed: ${failed}`);
          } else {
            logger.success(`[harden-gate] ${dimensionId}: all checks passed ✓ — score ${proposal.proposedScore} stands at ${finalScore}`);
          }
        } catch (err) {
          // Best-effort: if the gate itself crashes, do not block the merge but log loudly.
          logger.warn(`[harden-gate] ${dimensionId}: gate threw — ${err instanceof Error ? err.message : String(err)}; proceeding without harden cap`);
        }
      }

      updateDimensionScore(matrix, dimensionId, finalScore, proposal.commit);
      const after = getScore(dim);
      const last = dim.sprint_history[dim.sprint_history.length - 1] as unknown as Record<string, unknown> | undefined;
      if (last) {
        last.proposalIds = group.map(p => p.id);
        last.selectedProposalId = proposal.id;
      }
      selected.add(proposal.id);
      merged.push({
        dimensionId,
        before,
        after,
        selectedProposalId: proposal.id,
        clampedByCeiling: after !== finalScore || finalScore !== proposal.proposedScore,
      });
    }
    matrix.lastUpdated = new Date().toISOString();
    matrix.overallSelfScore = computeOverallScore(matrix);
    await writeJsonAtomic(abs(cwd, MATRIX_REL), matrix);

    const rejected = proposals.filter(p => !selected.has(p.id));
    const receiptId = `merge_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const receiptPath = rel(RECEIPT_DIR_REL, `${receiptId}.json`);
    const receipt: MatrixDevelopmentMergeReceipt = {
      id: receiptId,
      policy,
      agent,
      mergedAt: options._now?.() ?? new Date().toISOString(),
      matrixHashBefore: hashBefore,
      matrixHashAfter: await hashFile(abs(cwd, MATRIX_REL)),
      beforeTimeMachineCommitId: beforeTm.commitId,
      proposalIds: proposals.map(p => p.id),
      selectedProposalIds: [...selected],
      rejected,
      merged,
      receiptPath,
    };

    for (const item of merged) {
      const dim = matrix.dimensions.find(d => d.id === item.dimensionId);
      const last = dim?.sprint_history[dim.sprint_history.length - 1] as unknown as Record<string, unknown> | undefined;
      if (last) {
        last.mergeReceipt = receiptPath;
        last.timeMachineCommitId = beforeTm.commitId;
      }
    }
    await writeJsonAtomic(abs(cwd, MATRIX_REL), matrix);
    await writeJsonAtomic(abs(cwd, receiptPath), receipt);
    await fs.appendFile(abs(cwd, HISTORY_REL), `${JSON.stringify(receipt)}\n`, 'utf8');

    const afterSnapshotPaths = await uniqueExistingPaths(cwd, [MATRIX_REL, HISTORY_REL, receiptPath]);
    const afterTm = await createCommit({
      cwd,
      paths: afterSnapshotPaths,
      label: 'matrix merge after',
      causalLinks: {
        materials: [beforeTm.commitId, ...proposalPaths],
        products: [MATRIX_REL, HISTORY_REL, receiptPath],
        sourceCommitIds: [beforeTm.commitId],
        rejectedClaims: rejected.map(p => ({
          verdictId: p.id,
          status: 'unsupported',
          claim: `Proposed score ${p.proposedScore} for ${p.dimensionId} rejected by ${policy} policy.`,
        })),
      },
    });
    receipt.afterTimeMachineCommitId = afterTm.commitId;
    await writeJsonAtomic(abs(cwd, receiptPath), receipt);

    for (const proposal of proposals) await fs.rm(abs(cwd, proposal.proposalPath), { force: true });
    return receipt;
  });
}

export async function runDimensionAscentCycle(options: MatrixDevelopmentEngineOptions & {
  dimension: string | number;
  agent: string;
  score: number;
  rationale: string;
  evidence?: string | string[];
  policy?: MatrixMergePolicy;
}): Promise<MatrixDevelopmentMergeReceipt> {
  await claimDimension(options);
  await writeScoreProposal(options);
  return mergeScoreProposals(options);
}
