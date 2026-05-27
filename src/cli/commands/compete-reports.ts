// compete-reports.ts — Report, validate, auto-sprint, and top-N dim actions.
// Split from compete.ts to keep files under the 750-LOC hard cap.
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import {
  loadMatrix,
  saveMatrix,
  computeGapPriority,
  getNextSprintDimension,
  updateDimensionScore,
  computeOverallScore,
  getMatrixPath,
  applyAdversarialCalibration,
  type CompeteMatrix,
  type MatrixDimension,
} from '../../core/compete-matrix.js';
import { computeHarshScore, computeStrictDimensions, type HarshScorerOptions } from '../../core/harsh-scorer.js';
import { applyStrictOverrides } from '../../core/ascend-engine.js';
import { confirmMatrix } from '../../core/matrix-confirm.js';
import { mergeScoreProposals, writeScoreProposal } from '../../core/matrix-development-engine.js';
import { formatScore, formatStatusTable, logSprintGaps, buildHarvestBriefPrompt, logSprintOutput } from './compete-display.js';
import { defaultEvidenceWriter, ensureMatrixOnDisk, parseRescore, proposeAndMergeScore, runCertifyGate, writeRescoreEvidence } from './compete-score-flow.js';
import { SCORING_DOCTRINE_SHORT } from '../../core/scoring-doctrine.js';
import type { CompeteOptions, CompeteResult, CompeteEvidence, NextDimEntry } from './compete.js';

export async function actionReport(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const reportPath = path.join(cwd, '.danteforge', 'compete', 'COMPETE_REPORT.md');

  const writeFn = options._writeReport ?? (async (content: string, p: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  });

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'report', matrixPath };
  }

  const sorted = [...matrix.dimensions].sort(
    (a, b) => computeGapPriority(b) - computeGapPriority(a),
  );

  const closedCount = matrix.dimensions.filter(d => d.status === 'closed').length;
  const sprintCount = matrix.dimensions.reduce((s, d) => s + d.sprint_history.length, 0);

  const lines: string[] = [
    `# Competitive Harvest Loop Report — ${matrix.project}`,
    `Generated: ${new Date().toISOString().slice(0, 10)}  |  Overall: ${formatScore(matrix.overallSelfScore)}/10`,
    `Dimensions: ${matrix.dimensions.length} total, ${closedCount} closed, ${sprintCount} sprints completed`,
    ``,
    `## Gap Matrix`,
    `| Dimension | Self | Leader | Gap | Priority | Status |`,
    `|-----------|------|--------|-----|----------|--------|`,
  ];

  for (const dim of sorted) {
    const leaderScore = Math.max(
      ...Object.entries(dim.scores).filter(([k]) => k !== 'self').map(([, v]) => v),
      0,
    );
    const trend = dim.sprint_history.length > 0 ? ' ↑' : '';
    lines.push(
      `| ${dim.label}${trend} | ${formatScore(dim.scores['self'] ?? 0)} | ${dim.leader} (${formatScore(leaderScore)}) | ${formatScore(dim.gap_to_leader)} | ${computeGapPriority(dim).toFixed(1)} | ${dim.status} |`,
    );
  }

  lines.push('', '## Sprint History');
  const allSprints = matrix.dimensions
    .flatMap(d => d.sprint_history.map(s => ({ ...s, label: d.label })))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (allSprints.length === 0) {
    lines.push('No sprints completed yet. Run `danteforge compete --sprint` to start.');
  } else {
    for (const s of allSprints) {
      const delta = s.after - s.before;
      const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
      lines.push(`- **${s.date}** ${s.label}: ${formatScore(s.before)} → ${formatScore(s.after)} (${deltaStr})${s.commit ? ` | ${s.commit.slice(0, 7)}` : ''}`);
    }
  }

  const next = getNextSprintDimension(matrix);
  if (next) {
    lines.push('', '## Recommended Next Sprint', `**${next.label}** — gap: ${formatScore(next.gap_to_leader)}, priority: ${computeGapPriority(next).toFixed(1)}`, `Run: \`danteforge compete --sprint\``);
  }

  const content = lines.join('\n');
  await writeFn(content, reportPath);

  logger.success(`COMPETE_REPORT.md written: ${reportPath}`);
  logger.info(content);

  return { action: 'report', matrixPath, overallScore: matrix.overallSelfScore };
}

export async function actionValidate(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const strictDimsFn = options._computeStrictDims ?? computeStrictDimensions;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'validate', matrixPath };
  }

  // Get latest harsh-scorer output for cross-reference (best-effort)
  // Apply strict overrides so autonomy/selfImprovement/convergence use the same
  // evidence path as measure --strict and compete --sync-scores.
  let harshDimensions: Record<string, number> | undefined;
  try {
    const result = await harshScoreFn({ cwd });
    await applyStrictOverrides(result, cwd, strictDimsFn);
    harshDimensions = result.displayDimensions as Record<string, number>;
  } catch { /* harsh score optional — age check still runs */ }

  const report = checkMatrixStaleness(matrix, harshDimensions);

  if (report.isStale) {
    logger.warn(`⚠  Matrix is ${report.daysOld} days old. Run \`compete --init\` to rescan competitors.`);
  } else {
    logger.info(`Matrix age: ${report.daysOld} day(s) — fresh.`);
  }

  if (report.driftedDimensions.length > 0) {
    logger.warn(`\n⚠  Score drift detected (matrix vs latest assessment):`);
    for (const d of report.driftedDimensions) {
      const direction = d.matrixScore > d.harshScore ? '↑ optimistic' : '↓ conservative';
      logger.info(`  ${d.label}: matrix=${formatScore(d.matrixScore)}, assessed=${formatScore(d.harshScore)} (${direction}, drift: ${d.drift.toFixed(1)})`);
    }
    logger.info(`\nTo sync drifted scores:`);
    for (const d of report.driftedDimensions) {
      logger.info(`  danteforge compete --rescore "${d.id}=${formatScore(d.harshScore)}" --skip-verify`);
    }
  } else if (harshDimensions) {
    logger.success('✓ Matrix scores align with latest assessment (no significant drift).');
  }

  return { action: 'validate', matrixPath, overallScore: matrix.overallSelfScore };
}

export async function actionSyncScores(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const strictDimsFn = options._computeStrictDims ?? computeStrictDimensions;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'validate', matrixPath };
  }

  let harshDimensions: Record<string, number> | undefined;
  try {
    const result = await harshScoreFn({ cwd });
    // Apply strict overrides so ceilings (e.g. enterpriseReadiness=9.0) are enforced
    await applyStrictOverrides(result, cwd, strictDimsFn);
    harshDimensions = result.displayDimensions as Record<string, number>;
  } catch {
    logger.error('Failed to run harsh scorer — cannot sync scores.');
    return { action: 'validate', matrixPath };
  }

  const report = checkMatrixStaleness(matrix, harshDimensions, 999, 0.2);
  if (report.driftedDimensions.length === 0) {
    logger.success('✓ All matrix self-scores are within 0.2 of live scorer — no sync needed.');
    return { action: 'validate', matrixPath, overallScore: matrix.overallSelfScore, dimensionsUpdated: 0 };
  }

  logger.info(`Syncing ${report.driftedDimensions.length} drifted dimension(s) from live scorer:`);
  await ensureMatrixOnDisk(matrix, cwd);
  let updated = 0;
  for (const d of report.driftedDimensions) {
    const dir = d.matrixScore > d.harshScore ? '↓' : '↑';
    logger.info(`  ${d.label}: ${formatScore(d.matrixScore)} → ${formatScore(d.harshScore)} (${dir})`);
    // Always emit a proposal — the direct-write injection-seam branch was removed
    // as part of closing the six bypasses (Phase E). Under outcome-derived scoring
    // the score field is read-only at the storage layer.
    await writeScoreProposal({
      cwd,
      dimension: d.id,
      score: d.harshScore,
      agent: 'compete-sync-scores',
      rationale: `Live strict scorer drift correction from ${formatScore(d.matrixScore)} to ${formatScore(d.harshScore)}.`,
    });
    updated++;
  }

  await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'compete-sync-scores' });
  const updatedMatrix = await loadMatrix(cwd) ?? matrix;
  logger.success(`Synced ${updated} dimension(s). Overall: ${formatScore(computeOverallScore(updatedMatrix))}/10`);
  return { action: 'validate', matrixPath, overallScore: computeOverallScore(updatedMatrix), dimensionsUpdated: updated };
}

// `actionCalibrate` + `scorerDimToMatrixId` were extracted to compete-calibrate.ts
// to keep this file under the 750 LOC hard cap. See that file for the harsh-scorer
// + adversarial-scorer + score-proposal pipeline.

// ── Main Entry ────────────────────────────────────────────────────────────────

export async function actionAutoSprint(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  emit(`[scoring-doctrine] ${SCORING_DOCTRINE_SHORT}`);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const matrixPath = getMatrixPath(cwd);
  const maxCycles = options.maxCycles ?? 5;

  const runInferno = options._runInferno ?? defaultRunInferno;
  const postSprintScoreFn = options._postSprintScore ?? (options._harshScore ?? computeHarshScore);

  let matrix = await loadFn(cwd);
  if (!matrix) {
    emit('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'auto', matrixPath };
  }

  if (!options.yes) {
    const confirmFn = options._confirmMatrix ?? confirmMatrix;
    const confirmed = await confirmFn(matrix, { cwd, _stdout: (l) => logger.info(l) });
    if (!confirmed) {
      logger.warn('[Compete] Auto-sprint aborted — competitive landscape not confirmed.');
      return { action: 'auto', matrixPath };
    }
  }

  let victoryMessage: string | undefined;
  let cyclesDone = 0;

  while (cyclesDone < maxCycles) {
    const next = getNextSprintDimension(matrix);
    if (!next) {
      emit('  All gaps closed!');
      break;
    }

    const selfScoreBefore = next.scores['self'] ?? 0;
    const topCompetitor = next.closed_source_leader ?? next.oss_leader ?? 'leader';
    const topScore = next.scores[topCompetitor] ?? 0;

    emit('');
    emit(`  Auto-sprint [${cyclesDone + 1}/${maxCycles}]: ${next.label}`);
    emit(`  Self: ${selfScoreBefore.toFixed(1)}  |  Target: ${topScore.toFixed(1)} (${topCompetitor})`);
    emit('');

    // Depth Doctrine: alternate breadth (inferno) and depth (validate) waves.
    const { getWaveGuard } = await import('../../core/wave-alternation.js');
    const waveGuard = getWaveGuard(cyclesDone);

    const goal = `Improve "${next.label}" dimension to match or exceed ${topCompetitor} (${topScore.toFixed(1)}/10)`;
    try {
      if (waveGuard.type === 'depth') {
        emit(`  DEPTH WAVE: running validate for ${next.label} instead of inferno`);
        const { runValidateCli } = await import('./validate.js');
        await runValidateCli({ dimId: next.id, forceCold: true, cwd }).catch(() => {});
      } else {
        await runInferno(goal, cwd);
      }

      const postResult = await postSprintScoreFn({ cwd });
      await applyStrictOverrides(postResult, cwd, options._computeStrictDims ?? computeStrictDimensions);
      // Bug A fix: prefer dimension-specific score over overall project score
      const toCamelCase = (s: string) => s.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
      const dimKey = toCamelCase(next.id) as import('../../core/harsh-scorer.js').ScoringDimension;
      const newSelfScore = postResult.displayDimensions?.[dimKey] ?? postResult.displayScore;

      // Phase E final migration: proposal flow is the single writer.
      await ensureMatrixOnDisk(matrix, cwd);
      await proposeAndMergeScore({
        cwd,
        dimensionId: next.id,
        score: newSelfScore,
        agent: 'compete-auto',
        rationale: `Post-inferno strict scorer for "${next.label}" (dim: ${dimKey}) returned ${newSelfScore.toFixed(1)}.`,
      });
      matrix = await loadMatrix(cwd) ?? matrix;

      // Bug B fix: never declare victory below target (default 9.0) even if competitor ceiling is lower
      const autoTarget = options.target ?? 9.0;
      const victoryThreshold = Math.max(topScore, autoTarget);
      if (newSelfScore >= victoryThreshold) {
        victoryMessage = `Victory — ${next.label} now leads ${topCompetitor} (${newSelfScore.toFixed(1)} ≥ ${victoryThreshold.toFixed(1)})`;
        emit(`  ${victoryMessage}`);
      } else {
        const remaining = victoryThreshold - newSelfScore;
        emit(`  Progress: ${selfScoreBefore.toFixed(1)} → ${newSelfScore.toFixed(1)}  (${remaining.toFixed(1)} to ${victoryThreshold.toFixed(1)} target)`);
      }
    } catch (err) {
      emit(`  Cycle failed (${next.label}): ${err instanceof Error ? err.message : String(err)} — continuing to next dimension`);
    }

    cyclesDone++;

    // Check for next gap after updating scores
    const nextGap = getNextSprintDimension(matrix);
    if (!nextGap) {
      emit('  All gaps closed!');
      break;
    }
    emit(`  Next gap: ${nextGap.label}`);
    emit('');
  }

  if (cyclesDone >= maxCycles) {
    emit(`  Max cycles (${maxCycles}) reached — run again to continue.`);
  }

  const remaining = getNextSprintDimension(matrix);
  return {
    action: 'auto',
    matrixPath,
    overallScore: matrix.overallSelfScore,
    nextDimension: remaining ?? undefined,
    victoryMessage,
  };
}

async function defaultRunInferno(goal: string, _cwd: string): Promise<void> {
  const { inferno } = await import('./magic.js');
  await inferno(goal);
}

// ── next-dims ─────────────────────────────────────────────────────────────────
// Outputs JSON of the N weakest dimensions below target, sorted by gap descending.
// Used by the goal-loop-matrix skill to know which dimensions to feed into /matrixdev.

export async function actionNextDims(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const loadFn = options._loadMatrix ?? ((c: string) => loadMatrix(c));
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const matrixPath = getMatrixPath(cwd);
  const target = options.target ?? 9.0;
  const n = options.nextDims ?? 3;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('No matrix found. Run `danteforge compete --init` first.');
    process.exitCode = 1;
    return { action: 'next-dims', matrixPath, nextDims: [] };
  }

  // Use live harsh scores so inflated matrix self-scores don't hide real gaps.
  // Apply strict dimension overrides (autonomy, selfImprovement, etc.) the same
  // way check-all-nine does — otherwise next-dims underreports fixed dimensions.
  const harshResult = await harshScoreFn({ cwd });
  if (!options._harshScore || options._computeStrictDims) {
    const strictDimsFn = options._computeStrictDims ?? computeStrictDimensions;
    await applyStrictOverrides(harshResult, cwd, strictDimsFn);
  }
  const dimKey = (id: string) => id as import('../../core/harsh-scorer.js').ScoringDimension;

  const entries: NextDimEntry[] = matrix.dimensions
    .filter(dim => {
      if (dim.ceiling !== undefined && dim.ceiling < target) return false;
      const score = harshResult.displayDimensions?.[dimKey(dim.id)] ?? dim.scores['self'] ?? 0;
      return score < target;
    })
    .map(dim => {
      const selfScore = harshResult.displayDimensions?.[dimKey(dim.id)] ?? dim.scores['self'] ?? 0;
      return {
        id: dim.id,
        label: dim.label ?? dim.id,
        selfScore,
        target,
        gap: target - selfScore,
        touches: dim.touches,
      };
    })
    .sort((a, b) => b.gap - a.gap)
    .slice(0, n);

  if (options.json) {
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
  } else {
    if (entries.length === 0) {
      logger.success(`All reachable dimensions are at ${target}+`);
    } else {
      logger.info(`Next ${entries.length} dimension(s) below ${target} (sorted by gap):`);
      for (const e of entries) {
        logger.info(`  ${e.label.padEnd(32)} self=${e.selfScore.toFixed(1)}  gap=${e.gap.toFixed(1)}`);
      }
    }
  }

  return { action: 'next-dims', matrixPath, overallScore: matrix.overallSelfScore, nextDims: entries };
}

// ── check-all-nine ─────────────────────────────────────────────────────────────
// Machine-readable verdict for Claude Code /goal integration.
// Exits 0 when all reachable dimensions are at or above target (default 9.0).
// Writes .danteforge/GOAL_STATUS.json so the /goal evaluator reads a file,
// not an LLM opinion.

export async function actionCheckAllNine(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const loadFn = options._loadMatrix ?? ((c: string) => loadMatrix(c));
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const matrixPath = getMatrixPath(cwd);
  const target = options.target ?? 9.0;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('No matrix found. Run `danteforge compete --init` first.');
    process.exitCode = 1;
    return { action: 'check-all-nine', matrixPath, allGreen: false };
  }

  let harshDims: Record<string, number> | undefined;
  try {
    const harshResult = await harshScoreFn({ cwd });
    // Apply strict dimension overrides when using the real scorer or an explicit test inject.
    // Skip when _harshScore is mocked without _computeStrictDims — the mock already has correct dims.
    if (!options._harshScore || options._computeStrictDims) {
      const strictDimsFn = options._computeStrictDims ?? computeStrictDimensions;
      await applyStrictOverrides(harshResult, cwd, strictDimsFn);
    }
    harshDims = harshResult.displayDimensions as Record<string, number>;
  } catch { /* best-effort — fall back to matrix self-scores */ }

  const toCamelCase = (s: string) => s.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());

  const failing: string[] = [];
  const blocked: string[] = [];
  const passing: string[] = [];

  for (const dim of matrix.dimensions) {
    if (dim.ceiling !== undefined && dim.ceiling < target) {
      blocked.push(`${dim.label ?? dim.id} (ceiling: ${dim.ceiling})`);
      continue;
    }
    const camelKey = toCamelCase(dim.id);
    const harshScore = harshDims?.[camelKey] ?? harshDims?.[dim.id];
    const selfScore = dim.scores['self'] ?? 0;
    const effectiveScore = harshScore ?? selfScore;
    if (effectiveScore >= target) {
      passing.push(dim.label ?? dim.id);
    } else {
      failing.push(`${dim.label ?? dim.id}: ${effectiveScore.toFixed(1)}`);
    }
  }

  const allGreen = failing.length === 0;
  try {
    const statusPath = path.join(cwd, '.danteforge', 'GOAL_STATUS.json');
    await fs.writeFile(statusPath, JSON.stringify({
      allGreen,
      target,
      passing: passing.length,
      failing: failing.length,
      blocked: blocked.length,
      total: matrix.dimensions.length,
      failingDimensions: failing,
      blockedDimensions: blocked,
      checkedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
  } catch { /* best-effort */ }

  if (allGreen) {
    logger.success(`✓ All ${passing.length} reachable dimensions at ${target}+ (${blocked.length} blocked by ceiling)`);
    process.exitCode = 0;
  } else {
    logger.warn(`✗ ${failing.length} dimension(s) below ${target}: ${failing.slice(0, 4).join(', ')}${failing.length > 4 ? ` (+${failing.length - 4} more)` : ''}`);
    if (blocked.length > 0) logger.info(`  Ceiling-blocked (excluded from check): ${blocked.length}`);
    logger.info('  Run `danteforge compete --auto --target 9.0` to close gaps.');
    logger.info('  Status written: .danteforge/GOAL_STATUS.json');
    process.exitCode = 1;
  }
  return { action: 'check-all-nine', matrixPath, overallScore: matrix.overallSelfScore, allGreen };
}

