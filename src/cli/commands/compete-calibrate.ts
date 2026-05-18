// compete-calibrate.ts — Adversarial calibration for the CHL matrix
//
// Extracted from compete.ts to keep that file under the 750 LOC hard cap.
// Drives the harsh-scorer + adversarial-scorer pipeline, identifies inflated
// dimensions (self-score significantly above adversarial verdict), and either
// applies the corrections directly (when test seams are present) or routes
// them through the matrix-development-engine score-proposal flow.

import { logger } from '../../core/logger.js';
import {
  loadMatrix,
  saveMatrix,
  applyAdversarialCalibration,
  computeOverallScore,
  getMatrixPath,
} from '../../core/compete-matrix.js';
import { computeHarshScore, computeStrictDimensions } from '../../core/harsh-scorer.js';
import { applyStrictOverrides } from '../../core/ascend-engine.js';
import { mergeScoreProposals, writeScoreProposal } from '../../core/matrix-development-engine.js';
import { formatScore } from './compete-display.js';
import type { CompeteOptions, CompeteResult } from './compete.js';

/** Map scorer camelCase dimension IDs to matrix snake_case IDs. */
export function scorerDimToMatrixId(scorerDim: string): string {
  return scorerDim.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export async function actionCalibrate(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const strictDimsFn = options._computeStrictDims ?? computeStrictDimensions;
  const { generateAdversarialScore } = await import('../../core/adversarial-scorer-dim.js');
  const adversarialFn = options._generateAdversarialScore ?? generateAdversarialScore;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'calibrate', matrixPath };
  }

  logger.info('Running harsh scorer for baseline scores...');
  let harshResult: import('../../core/harsh-scorer.js').HarshScoreResult;
  try {
    harshResult = await harshScoreFn({ cwd });
    await applyStrictOverrides(harshResult, cwd, strictDimsFn);
  } catch {
    logger.error('Harsh scorer failed — cannot calibrate.');
    return { action: 'calibrate', matrixPath };
  }

  logger.info('Running adversarial scorer (hostile review)...');
  let adversarialResult: import('../../core/adversarial-scorer-dim.js').AdversarialScoreResult;
  try {
    adversarialResult = await adversarialFn(harshResult, { cwd });
  } catch {
    logger.error('Adversarial scorer failed — cannot calibrate.');
    return { action: 'calibrate', matrixPath };
  }

  // Build a map: matrixDimId → { harshScore, adversarialScore, verdict, rationale }
  const adversarialByMatrixId = new Map<string, { harsh: number; adv: number; rationale: string }>();
  const harshDims = harshResult.displayDimensions as Record<string, number>;
  for (const dimScore of adversarialResult.dimensions) {
    const matrixId = scorerDimToMatrixId(dimScore.dimension);
    const harshScore = harshDims[dimScore.dimension] ?? (harshDims[matrixId] ?? 0);
    adversarialByMatrixId.set(matrixId, {
      harsh: harshScore,
      adv: dimScore.adversarialScore,
      rationale: dimScore.rationale,
    });
  }

  // Collect inflated dimensions
  const inflated: Array<{ id: string; label: string; before: number; after: number; adv: number }> = [];
  for (const dim of matrix.dimensions) {
    const entry = adversarialByMatrixId.get(dim.id);
    if (!entry) continue;
    const selfScore = dim.scores['self'] ?? 0;
    const divergence = entry.adv - selfScore;
    if (divergence <= -1.5) {
      const consensus = Math.round(((entry.harsh + entry.adv) / 2) * 10) / 10;
      inflated.push({ id: dim.id, label: dim.label, before: selfScore, after: consensus, adv: entry.adv });
    }
  }

  if (inflated.length === 0) {
    logger.success('✓ No inflated dimensions found — matrix scores are trusted by adversarial review.');
    return { action: 'calibrate', matrixPath, overallScore: matrix.overallSelfScore, dimensionsUpdated: 0 };
  }

  // Show diff table
  logger.info(`\nAdversarial calibration will adjust ${inflated.length} dimension(s):\n`);
  logger.info('  Dimension                         Before  Adversary  Consensus');
  logger.info('  ' + '─'.repeat(66));
  for (const d of inflated) {
    const label = d.label.padEnd(34);
    logger.info(`  ${label}  ${formatScore(d.before).padStart(5)}  ${formatScore(d.adv).padStart(8)}  ${formatScore(d.after).padStart(9)}`);
  }
  logger.info('');

  if (!options.yes) {
    logger.info('Run with --yes to apply these corrections.');
    return { action: 'calibrate', matrixPath, overallScore: matrix.overallSelfScore, dimensionsUpdated: 0 };
  }

  // Apply via proposal-only path. The injection-seam branch that mutated matrix
  // directly via applyAdversarialCalibration + saveMatrix was removed as part of
  // closing the six bypass surfaces (Phase E). Under outcome-derived scoring
  // the score field is read-only at the storage layer; all changes flow through
  // proposals so they emit Time Machine commits and pass the harden gate.
  let updated = 0;
  for (const d of inflated) {
    const entry = adversarialByMatrixId.get(d.id)!;
    await writeScoreProposal({
      cwd,
      dimension: d.id,
      score: d.after,
      agent: 'compete-calibrate',
      rationale: `Adversarial inflated verdict: ${entry.rationale}`,
    });
    updated++;
  }

  await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'compete-calibrate' });
  const updatedMatrix = await loadMatrix(cwd) ?? matrix;
  logger.success(`Calibrated ${updated} dimension(s). Overall: ${formatScore(computeOverallScore(updatedMatrix))}/10`);
  return { action: 'calibrate', matrixPath, overallScore: computeOverallScore(updatedMatrix), dimensionsUpdated: updated };
}
