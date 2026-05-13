// compete-display.ts — display/formatting helpers extracted from compete.ts
// Separated to keep compete.ts under the 750-LOC hard cap.

import { logger } from '../../core/logger.js';
import {
  computeGapPriority,
  type CompeteMatrix,
  type MatrixDimension,
} from '../../core/compete-matrix.js';
import { mapDimIdToScoringDimension } from '../../core/ascend-engine.js';

// ── Formatting primitives ─────────────────────────────────────────────────────

export function formatScore(score: number): string {
  return score.toFixed(1);
}

export function gapBar(gap: number, maxGap = 10): string {
  const filled = Math.round((gap / maxGap) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export function formatTrend(dim: MatrixDimension): string {
  if (dim.sprint_history.length === 0) return '·';
  const last = dim.sprint_history[dim.sprint_history.length - 1]!;
  const delta = last.after - last.before;
  if (delta > 0) return `+${delta.toFixed(1)}↑`;
  if (delta < 0) return `${delta.toFixed(1)}↓`;
  return '→';
}

// ── Table renderer ─────────────────────────────────────────────────────────────
// Market dims (no auto-scorer) are tagged with [M] in the label column so users
// know which ones require `danteforge compete --amend` instead of forge cycles.

export function formatStatusTable(matrix: CompeteMatrix): string {
  const lines: string[] = [
    `\n## Competitive Matrix — ${matrix.project}`,
    `Overall self score: ${formatScore(matrix.overallSelfScore)}/10  |  Last updated: ${matrix.lastUpdated.slice(0, 10)}`,
    `\n${'Dimension'.padEnd(32)} ${'Self'.padEnd(6)} ${'Leader'.padEnd(8)} ${'Gap'.padEnd(6)} ${'Priority'.padEnd(10)} ${'Trend'.padEnd(8)} Status`,
    '─'.repeat(88),
  ];

  const sorted = [...matrix.dimensions].sort(
    (a, b) => computeGapPriority(b) - computeGapPriority(a),
  );

  for (const dim of sorted) {
    const leaderScore = Math.max(
      ...Object.entries(dim.scores).filter(([k]) => k !== 'self').map(([, v]) => v),
      0,
    );
    const priority = computeGapPriority(dim).toFixed(1);
    const statusIcon = dim.status === 'closed' ? '✓' : dim.status === 'in-progress' ? '⚡' : '·';
    const trend = formatTrend(dim);
    const isMarket = mapDimIdToScoringDimension(dim.id) === null;
    const rawLabel = isMarket ? `${dim.label.slice(0, 28)} [M]` : dim.label.slice(0, 31);
    lines.push(
      `${rawLabel.padEnd(32)} ${formatScore(dim.scores['self'] ?? 0).padEnd(6)} ${formatScore(leaderScore).padEnd(8)} ${formatScore(dim.gap_to_leader).padEnd(6)} ${priority.padEnd(10)} ${trend.padEnd(8)} ${statusIcon} ${dim.status}`,
    );
  }

  return lines.join('\n');
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
