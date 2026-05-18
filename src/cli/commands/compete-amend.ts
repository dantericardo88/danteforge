// compete-amend.ts — manual score amendment handlers extracted from compete.ts
// Handles --amend (single dim) and --amend-file (batch JSON) operations.
//
// Phase E migration (final): both handlers write score PROPOSALS only. The
// historical loadFn/saveFn injection seams are preserved in the signature for
// backward compatibility but saveFn is no longer invoked. The proposal flow
// (writeScoreProposal → mergeScoreProposals) is the single source of score
// change events. Under outcome-derived scoring (Phase F+G), the score field
// on dims with outcomes is computed at loadMatrix time anyway — any direct
// write would be overwritten on the next read.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import {
  computeOverallScore,
  computeUnweightedComposite,
  getMatrixPath,
  loadMatrix,
  type CompeteMatrix,
} from '../../core/compete-matrix.js';
import { writeScoreProposal, mergeScoreProposals } from '../../core/matrix-development-engine.js';
import { ensureMatrixOnDisk } from './compete-score-flow.js';

type LoadFn = (cwd: string) => Promise<CompeteMatrix | null>;
type SaveFn = (matrix: CompeteMatrix, cwd: string) => Promise<void>;
type AmendResult = { action: 'status'; matrixPath: string; overallScore: number | undefined };

export async function handleAmend(
  rawArg: string,
  loadFn: LoadFn,
  saveFn: SaveFn,
  cwd: string,
): Promise<AmendResult> {
  void saveFn; // preserved for backward-compatible signature; not invoked under proposal-only flow
  const eqIdx = rawArg.indexOf('=');
  if (eqIdx === -1) {
    logger.error('--amend format: dim_id=score e.g. "semantic_memory=5.5"');
    process.exit(1);
  }
  const dimId = rawArg.slice(0, eqIdx).trim();
  const score = parseFloat(rawArg.slice(eqIdx + 1).trim());
  if (!dimId || isNaN(score) || score < 0 || score > 10) {
    logger.error('Score must be a number 0–10');
    process.exit(1);
  }
  const matrix = await loadFn(cwd);
  if (!matrix) { logger.error('No matrix. Run: danteforge compete --init'); process.exit(1); }
  const dim = matrix.dimensions.find(d => d.id === dimId);
  if (!dim) {
    logger.error(`Dim "${dimId}" not found. Run: danteforge compete to list dims.`);
    process.exit(1);
  }
  const before = dim.scores['self'] ?? 0;

  await ensureMatrixOnDisk(matrix, cwd);
  await writeScoreProposal({
    cwd, dimension: dimId, score,
    agent: 'compete-amend',
    rationale: `Manual amendment via --amend ${dimId}=${score}`,
  });
  await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'compete-amend' });

  // Reload matrix to surface the final (possibly clamped-by-gate) score.
  const merged = (await loadMatrix(cwd)) ?? matrix;
  const after = merged.dimensions.find(d => d.id === dimId)?.scores['self'] ?? before;
  const composite = computeUnweightedComposite(merged);
  logger.success(`[compete] ${dimId}: ${before} → ${after} | Composite: ${composite}/10`);
  return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: computeOverallScore(merged) };
}

export async function handleAmendFile(
  filePath: string,
  loadFn: LoadFn,
  saveFn: SaveFn,
  cwd: string,
): Promise<AmendResult> {
  void saveFn; // preserved for backward-compatible signature
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(cwd, filePath), 'utf-8');
  } catch {
    logger.error(`Cannot read file: ${filePath}`);
    process.exit(1);
  }

  let entries: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    entries = parsed as Record<string, unknown>;
  } catch {
    logger.error('--amend-file must be a JSON object: { "dim_id": score, ... }');
    process.exit(1);
  }

  const matrix = await loadFn(cwd);
  if (!matrix) { logger.error('No matrix. Run: danteforge compete --init'); process.exit(1); }

  await ensureMatrixOnDisk(matrix, cwd);

  let updated = 0;
  let skipped = 0;
  for (const [dimId, rawScore] of Object.entries(entries)) {
    const score = typeof rawScore === 'number' ? rawScore : parseFloat(String(rawScore));
    if (isNaN(score) || score < 0 || score > 10) {
      logger.warn(`  [amend-file] "${dimId}": score must be 0–10, skipping`);
      skipped++;
      continue;
    }
    const dim = matrix.dimensions.find(d => d.id === dimId);
    if (!dim) {
      logger.warn(`  [amend-file] "${dimId}": dim not found, skipping`);
      skipped++;
      continue;
    }
    const before = dim.scores['self'] ?? 0;
    await writeScoreProposal({
      cwd, dimension: dimId, score,
      agent: 'compete-amend-file',
      rationale: `Batch amendment from ${filePath}: ${dimId}=${score}`,
    });
    logger.info(`  [amend-file] ${dimId}: ${before} → ${score} (proposed)`);
    updated++;
  }

  if (updated > 0) {
    await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'compete-amend-file' });
    const merged = (await loadMatrix(cwd)) ?? matrix;
    const composite = computeUnweightedComposite(merged);
    logger.success(`[compete] ${updated} dim(s) proposed, ${skipped} skipped | Composite: ${composite}/10`);
    return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: computeOverallScore(merged) };
  } else {
    logger.warn('[compete] No dims updated');
  }

  return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
}
