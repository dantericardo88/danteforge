// compete-amend.ts — manual score amendment handlers extracted from compete.ts
// Handles --amend (single dim) and --amend-file (batch JSON) mutations.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import {
  updateDimensionScore,
  computeOverallScore,
  computeUnweightedComposite,
  getMatrixPath,
  type CompeteMatrix,
} from '../../core/compete-matrix.js';

type LoadFn = (cwd: string) => Promise<CompeteMatrix | null>;
type SaveFn = (matrix: CompeteMatrix, cwd: string) => Promise<void>;
type AmendResult = { action: 'status'; matrixPath: string; overallScore: number | undefined };

export async function handleAmend(
  rawArg: string,
  loadFn: LoadFn,
  saveFn: SaveFn,
  cwd: string,
): Promise<AmendResult> {
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
  updateDimensionScore(matrix, dimId, score);
  matrix.overallSelfScore = computeOverallScore(matrix);
  await saveFn(matrix, cwd);
  const composite = computeUnweightedComposite(matrix);
  logger.success(`[compete] ${dimId}: ${before} → ${dim.scores['self']} | Composite: ${composite}/10`);
  return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
}

export async function handleAmendFile(
  filePath: string,
  loadFn: LoadFn,
  saveFn: SaveFn,
  cwd: string,
): Promise<AmendResult> {
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
    updateDimensionScore(matrix, dimId, score);
    logger.info(`  [amend-file] ${dimId}: ${before} → ${dim.scores['self']}`);
    updated++;
  }

  if (updated > 0) {
    matrix.overallSelfScore = computeOverallScore(matrix);
    await saveFn(matrix, cwd);
    const composite = computeUnweightedComposite(matrix);
    logger.success(`[compete] ${updated} dim(s) updated, ${skipped} skipped | Composite: ${composite}/10`);
  } else {
    logger.warn('[compete] No dims updated');
  }

  return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
}
