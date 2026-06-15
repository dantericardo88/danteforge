// compete-display.ts — display/formatting helpers extracted from compete.ts
// Separated to keep compete.ts under the 750-LOC hard cap.

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { verifyValidation, type FrontierSpec } from '../../core/frontier-spec.js';
import {
  computeGapPriority,
  type CompeteMatrix,
  type MatrixDimension,
} from '../../core/compete-matrix.js';
import { mapDimIdToScoringDimension } from '../../core/ascend-engine.js';

// ── Formatting primitives ─────────────────────────────────────────────────────

/** A real project's matrix can carry an unscored field (null/undefined) — e.g. a freshly-added dim
 *  with no gap_to_leader yet. Display primitives must degrade to a visible em-dash marker, never crash
 *  on `.toFixed` of null (the "works on DanteForge, dies on DanteCode" overfitting class). */
const NA = '—';
function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }
function pad(s: string, padWidth: number): string { return s + ' '.repeat(Math.max(0, padWidth - s.length)); }

export function formatScore(score: number | null | undefined): string {
  return isNum(score) ? score.toFixed(1) : NA;
}

/** Color a score value based on threshold bands; pad plain spaces after so table alignment holds. */
function colorScore(score: number | null | undefined, padWidth = 0): string {
  if (!isNum(score)) return pad(chalk.dim(NA), padWidth);
  const s = score.toFixed(1);
  const colored =
    score >= 9 ? chalk.green(s) :
    score >= 7 ? chalk.cyan(s) :
    score >= 5 ? chalk.yellow(s) :
    chalk.red(s);
  return colored + ' '.repeat(Math.max(0, padWidth - s.length));
}

/** Color a gap value — small gaps are good (green), large gaps are bad (red). */
function colorGap(gap: number | null | undefined, padWidth = 0): string {
  if (!isNum(gap)) return pad(chalk.dim(NA), padWidth);
  const s = gap.toFixed(1);
  const colored =
    gap <= 0.5 ? chalk.green(s) :
    gap <= 1.5 ? chalk.yellow(s) :
    chalk.red(s);
  return colored + ' '.repeat(Math.max(0, padWidth - s.length));
}

/** Color a priority value — high priorities get bold red. */
function colorPriority(priority: number | null | undefined, padWidth = 0): string {
  if (!isNum(priority)) return pad(chalk.dim(NA), padWidth);
  const s = priority.toFixed(1);
  const colored =
    priority >= 4 ? chalk.bold.red(s) :
    priority >= 2 ? chalk.red(s) :
    priority >= 1 ? chalk.yellow(s) :
    chalk.dim(s);
  return colored + ' '.repeat(Math.max(0, padWidth - s.length));
}

export function gapBar(gap: number | null | undefined, maxGap = 10): string {
  if (!isNum(gap)) return chalk.dim('░'.repeat(10));
  const filled = Math.round((gap / maxGap) * 10);
  return chalk.red('█'.repeat(filled)) + chalk.dim('░'.repeat(10 - filled));
}

export function formatTrend(dim: MatrixDimension): string {
  if (!dim.sprint_history || dim.sprint_history.length === 0) return chalk.dim('·');
  // Filter out corrupted entries where scores exceeded realistic bounds
  const valid = dim.sprint_history.filter(e => e.before <= 10 && e.after <= 10);
  if (valid.length === 0) return chalk.dim('·');
  const last = valid[valid.length - 1]!;
  const delta = last.after - last.before;
  if (delta > 0.05) return chalk.green(`+${delta.toFixed(1)}↑`);
  if (delta < -0.05) return chalk.red(`${delta.toFixed(1)}↓`);
  return chalk.dim('→');
}

// ── Table renderer ─────────────────────────────────────────────────────────────
// Market dims (no auto-scorer) are tagged with [M] in the label column so users
// know which ones require `danteforge compete --amend` instead of forge cycles.

/** Grading-integrity #9: a self-score above the frontier gate (8.0) is an UNVERIFIED claim until the
 *  frontier-review court validates it — "every self:9 was fiction" until proven. Returns true when the
 *  displayed self exceeds 8.0 without a validated frontier_spec, so the table can badge it honestly. */
function isSelfUnverified(dim: MatrixDimension): boolean {
  const self = dim.scores['self'] ?? 0;
  if (self <= 8.0) return false;
  // court-audit #7: trust the VERIFIABLE court receipt, not the bare status string — a hand-edited /
  // forged / stale `status:'validated'` (no valid validated_by) must still be badged as unverified.
  const dd = dim as unknown as { id: string; frontier_spec?: FrontierSpec };
  const spec = dd.frontier_spec;
  if (!spec || spec.status !== 'validated') return true;
  return !verifyValidation(dd.id, spec);
}

export function formatStatusTable(matrix: CompeteMatrix): string {
  const overallColored = colorScore(matrix.overallSelfScore);
  const unverified = matrix.dimensions.filter(isSelfUnverified);
  const header = [
    chalk.bold(`\n  Competitive Matrix — ${matrix.project}`),
    chalk.dim(`  Overall: ${overallColored}${chalk.dim('/10')}  |  Last updated: ${matrix.lastUpdated.slice(0, 10)}`),
    unverified.length > 0
      ? chalk.yellow(`  ⚠ ${unverified.length} dim(s) show self > 8.0 that the court has NOT validated (marked ? — unverified claims, not confirmed 9s)`)
      : '',
    '',
    chalk.dim('  ' + 'Dimension'.padEnd(32) + ' Self   Leader  Gap    Priority  Trend    Status'),
    chalk.dim('  ' + '─'.repeat(84)),
  ].filter(l => l !== '');

  const sorted = [...matrix.dimensions].sort(
    (a, b) => computeGapPriority(b) - computeGapPriority(a),
  );

  const rows: string[] = [];
  for (const dim of sorted) {
    // Exclude 'self' AND 'derived' — neither is a competitor; 'derived' had masqueraded as the leader.
    const leaderScore = Math.max(
      ...Object.entries(dim.scores).filter(([k]) => k !== 'self' && k !== 'derived').map(([, v]) => v),
      0,
    );
    const priority = computeGapPriority(dim);
    const statusIcon =
      dim.status === 'closed' ? chalk.green('✓') :
      dim.status === 'in-progress' ? chalk.cyan('⚡') :
      chalk.dim('·');
    const trend = formatTrend(dim);
    const isMarket = mapDimIdToScoringDimension(dim.id) === null;
    const rawLabel = isMarket ? `${dim.label.slice(0, 28)} [M]` : dim.label.slice(0, 31);
    const selfScore = dim.scores['self'] ?? 0;
    // A trailing '?' marks an unverified self>8 (kept outside the padded score cell so columns align).
    const unverifiedMark = isSelfUnverified(dim) ? chalk.yellow('?') : ' ';

    rows.push(
      `  ${rawLabel.padEnd(32)} ${colorScore(selfScore, 5)}${unverifiedMark}${colorScore(leaderScore, 8)}${colorGap(dim.gap_to_leader, 7)}${colorPriority(priority, 10)}${trend.padEnd(9)} ${statusIcon} ${chalk.dim(dim.status)}`,
    );
  }

  return [...header, ...rows].join('\n');
}

// ── Sprint output helpers ─────────────────────────────────────────────────────

export function logSprintGaps(
  next: MatrixDimension,
  selfScore: number,
  sprintTarget: number,
  harvestFrom: string,
  ossLeaderScore: number,
  csLeaderScore: number,
  hasOssGap: boolean,
  hasClosedGap: boolean,
): void {
  logger.info(`\nCHL Sprint — ${next.label}`);
  if (hasClosedGap) {
    logger.info(`Gold standard gap: ${formatScore(selfScore)} → ${formatScore(csLeaderScore)} (${next.closed_source_leader}) — what users pay for`);
  }
  if (hasOssGap) {
    logger.info(`Harvestable gap:   ${formatScore(selfScore)} → ${formatScore(ossLeaderScore)} (${next.oss_leader}) — what OSS has solved`);
  }
  if (!hasOssGap && !hasClosedGap) {
    const leaderScore = Math.max(
      ...Object.entries(next.scores).filter(([k]) => k !== 'self').map(([, v]) => v),
      0,
    );
    logger.info(`Gap: ${formatScore(selfScore)} → ${formatScore(leaderScore)} (${next.leader})`);
  }
  if (hasOssGap && hasClosedGap) {
    logger.info(`\nSprint goal: Close harvestable gap first (${formatScore(selfScore)} → ${formatScore(sprintTarget)}).`);
    logger.info(`Harvest from: ${harvestFrom} (open-source, MIT/Apache licensed).`);
    logger.info(`Gold standard ceiling: ${next.closed_source_leader} at ${formatScore(csLeaderScore)}.`);
  }
}

export function buildHarvestBriefPrompt(
  next: MatrixDimension,
  selfScore: number,
  sprintTarget: number,
  harvestFrom: string,
  ossSearchContext: string,
  hasOssGap: boolean,
  hasClosedGap: boolean,
  csLeaderScore: number,
): string {
  return [
    `You are helping close a competitive gap in this project using the Competitive Harvest Loop (CHL).`,
    ossSearchContext ? `\n## Real OSS discovery results (use these — do not hallucinate)\n${ossSearchContext}` : '',
    ``,
    `## Dimension to close`,
    `Name: ${next.label}`,
    `Current self score: ${formatScore(selfScore)}/10`,
    hasOssGap ? `OSS leader: ${harvestFrom} at ${formatScore(sprintTarget)}/10 (open-source — harvestable this sprint)` : '',
    hasClosedGap ? `Gold standard: ${next.closed_source_leader} at ${formatScore(csLeaderScore)}/10 (long-term target)` : '',
    ``,
    `## Task`,
    `1. Identify 2-3 open-source projects (MIT/Apache-2.0 license only) that best implement "${next.label}".`,
    hasOssGap ? `   Priority: ${harvestFrom} is the known OSS leader — focus on what specific patterns to extract from it.` : '',
    `2. For each project: one sentence on what SPECIFIC pattern to harvest (not general features).`,
    `3. Write a concise /inferno masterplan goal: "Close ${next.label} gap from ${formatScore(selfScore)} to ${formatScore(sprintTarget)}. Harvest from: ${harvestFrom}. Key patterns: [X, Y, Z]."`,
    ``,
    `Output ONLY: the OSS project bullets, then the masterplan goal line. No preamble.`,
  ].filter(Boolean).join('\n');
}

export function logSprintOutput(harvestBrief: string, masterplanPrompt: string, nextId: string): void {
  logger.info('\n## OSS Harvest Brief');
  if (harvestBrief) logger.info(harvestBrief);
  logger.info('\n## /inferno Masterplan Goal');
  logger.info(masterplanPrompt);
  logger.info('\nRun this with:');
  logger.info(`  danteforge inferno "${masterplanPrompt}"`);
  logger.info(`\nAfter the sprint, update the matrix:`);
  logger.info(`  danteforge compete --rescore "${nextId}=<new_score>[,<commit_sha>]"`);
}
