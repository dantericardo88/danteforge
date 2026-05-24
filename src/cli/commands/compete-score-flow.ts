import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../core/logger.js';
import { readLatestVerifyReceipt } from '../../core/verify-receipts.js';
import { mergeScoreProposals, writeScoreProposal } from '../../core/matrix-development-engine.js';
import { saveMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';

import type { CompeteEvidence, CompeteOptions, CompeteResult } from './compete.js';

/**
 * Persist the in-memory matrix to disk before the proposal+merge flow runs.
 * The proposal flow (`writeScoreProposal` → `mergeScoreProposals`) reads the
 * matrix from disk via `requireMatrix(cwd)` — there is no in-memory variant.
 * In production this is effectively a no-op (matrix already loaded from disk,
 * serialize back to same path). In tests with injected `_loadMatrix`, this
 * materializes the test fixture so the proposal flow operates on the right
 * input. Always overwrites: tests sharing a tmpDir that swap matrices between
 * cases get the right one for each call.
 */
export async function ensureMatrixOnDisk(matrix: CompeteMatrix, cwd: string): Promise<void> {
  await saveMatrix(matrix, cwd);
}

export function parseRescore(rescore: string): { dimensionId: string; score: number; commit?: string } {
  const [idPart, rest] = rescore.split('=');
  if (!idPart || !rest) throw new Error('Invalid --rescore format. Use: dim_id=7.5 or dim_id=7.5,commitsha');
  const [scorePart, commit] = rest.split(',');
  const score = Number(scorePart);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error('Score must be a number between 0 and 10.');
  }
  return { dimensionId: idPart.trim(), score, ...(commit ? { commit: commit.trim() } : {}) };
}

export async function runCertifyGate(
  rescore: string,
  options: CompeteOptions,
  cwd: string,
  matrixPath: string,
): Promise<{ receipt: Awaited<ReturnType<typeof readLatestVerifyReceipt>>; blocked: boolean; result?: CompeteResult }> {
  if (options.skipVerify) {
    logger.warn('--skip-verify: CERTIFY gate bypassed. Score recorded without verify receipt.');
    return { receipt: null, blocked: false };
  }
  const readReceipt = options._readVerifyReceipt ?? readLatestVerifyReceipt;
  const receipt = await readReceipt(cwd);
  if (!receipt) {
    logger.error('CERTIFY BLOCKED: No verify receipt found.');
    logger.info('Run `npm run verify` (or `danteforge verify`) first to certify this sprint.');
    logger.info(`Then re-run: danteforge compete --rescore "${rescore}"`);
    logger.info(`Override: danteforge compete --rescore "${rescore}" --skip-verify`);
    return { receipt: null, blocked: true, result: { action: 'rescore', matrixPath } };
  }
  if (receipt.status === 'fail') {
    logger.error('CERTIFY BLOCKED: Last verify run had failures.');
    logger.info(`Verify status: ${receipt.status} | ${receipt.counts.failures} failure(s)`);
    logger.info('Fix all test/typecheck failures, run `danteforge verify`, then retry.');
    logger.info(`Override: danteforge compete --rescore "${rescore}" --skip-verify`);
    return { receipt: null, blocked: true, result: { action: 'rescore', matrixPath } };
  }
  if (receipt.status === 'warn') {
    logger.warn(`Verify has warnings (${receipt.counts.warnings}). Score recorded, but fix warnings before next sprint.`);
  }
  return { receipt, blocked: false };
}

export async function writeRescoreEvidence(
  evidence: CompeteEvidence,
  cwd: string,
  writeFn: (record: CompeteEvidence, p: string) => Promise<void>,
): Promise<string> {
  const evidencePath = path.join(cwd, '.danteforge', 'evidence', 'compete', `${Date.now()}-${evidence.dimensionId}.json`);
  try { await writeFn(evidence, evidencePath); } catch { /* best-effort */ }
  return path.relative(cwd, evidencePath).replace(/\\/g, '/');
}

export function defaultEvidenceWriter(record: CompeteEvidence, evidencePath: string): Promise<void> {
  return fs.mkdir(path.dirname(evidencePath), { recursive: true })
    .then(() => fs.writeFile(evidencePath, JSON.stringify(record, null, 2), 'utf8'));
}

export async function proposeAndMergeScore(options: {
  cwd: string;
  dimensionId: string;
  score: number;
  agent: string;
  rationale: string;
  evidence?: string;
  commit?: string;
}): Promise<void> {
  await writeScoreProposal({
    cwd: options.cwd,
    dimension: options.dimensionId,
    score: options.score,
    agent: options.agent,
    rationale: options.rationale,
    evidence: options.evidence,
    commit: options.commit,
  });
  await mergeScoreProposals({ cwd: options.cwd, policy: 'harsh-min', agent: options.agent });
}
