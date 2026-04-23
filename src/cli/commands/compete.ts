// compete — Competitive Harvest Loop (CHL) command
// Codifies the 6-phase CHL process as a first-class DanteForge primitive:
//   1. INVENTORY  → --init: bootstrap matrix from competitor scan
//   2. GAP        → (default): show ranked gap table + recommended next sprint
//   3. SOURCE     → --sprint: identify top gap, generate harvest brief + /inferno prompt
//   4. SPRINT     → user runs /inferno with the generated masterplan
//   5. CERTIFY    → --rescore: update self-score after sprint, seal with commit SHA
//   6. LOOP       → back to GAP display for the next dimension

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState } from '../../core/state.js';
import { readLatestVerifyReceipt, type VerifyReceipt } from '../../core/verify-receipts.js';
import {
  loadMatrix,
  saveMatrix,
  computeGapPriority,
  getNextSprintDimension,
  updateDimensionScore,
  computeOverallScore,
  bootstrapMatrixFromComparison,
  getMatrixPath,
  checkMatrixStaleness,
  removeCompetitor,
  dropDimension,
  type CompeteMatrix,
  type MatrixDimension,
} from '../../core/compete-matrix.js';
import {
  scanCompetitors,
  type CompetitorScanOptions,
  type CompetitorComparison,
} from '../../core/competitor-scanner.js';
import { computeHarshScore, computeStrictDimensions, type HarshScorerOptions } from '../../core/harsh-scorer.js';
import { callLLM } from '../../core/llm.js';
import { applyStrictOverrides } from '../../core/ascend-engine.js';
import { confirmMatrix } from '../../core/matrix-confirm.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompeteEvidence {
  dimensionId: string;
  label: string;
  scoreBefore: number;
  scoreAfter: number;
  delta: number;
  verifyStatus: 'pass' | 'skipped';
  verifyTimestamp?: string;
  commit?: string;
  timestamp: string;
}

export interface CompeteOptions {
  init?: boolean;               // --init: bootstrap matrix from competitor scan
  sprint?: boolean;             // --sprint: find top gap, generate /inferno masterplan
  auto?: boolean;               // --auto: automated sprint + rescore loop
  rescore?: string;             // --rescore "dim_id=score" or "dim_id=score,sha"
  report?: boolean;             // --report: full CHL markdown report
  json?: boolean;               // --json: machine-readable output
  skipVerify?: boolean;         // --skip-verify: bypass CERTIFY gate
  validate?: boolean;           // --validate: cross-check matrix vs harsh-scorer
  cwd?: string;
  // Injection seams for testing
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _saveMatrix?: (matrix: CompeteMatrix, cwd: string) => Promise<void>;
  _scanCompetitors?: (opts: CompetitorScanOptions) => Promise<CompetitorComparison>;
  _harshScore?: (opts: HarshScorerOptions) => Promise<import('../../core/harsh-scorer.js').HarshScoreResult>;
  _callLLM?: (prompt: string) => Promise<string>;
  _writeReport?: (content: string, reportPath: string) => Promise<void>;
  _readVerifyReceipt?: (cwd: string) => Promise<VerifyReceipt | null>;
  _writeEvidence?: (record: CompeteEvidence, evidencePath: string) => Promise<void>;
  _webSearch?: (query: string) => Promise<string>;  // real OSS discovery, pre-populates harvest brief
  _now?: () => string;
  // --auto seams
  _runInferno?: (goal: string, cwd: string) => Promise<void>;
  _postSprintScore?: (opts: HarshScorerOptions) => Promise<import('../../core/harsh-scorer.js').HarshScoreResult>;
  _stdout?: (line: string) => void;
  maxCycles?: number;  // max auto-sprint loop iterations (default: 5)
  _computeStrictDims?: typeof computeStrictDimensions;
  yes?: boolean;
  _confirmMatrix?: typeof import('../../core/matrix-confirm.js').confirmMatrix;
  removeCompetitor?: string;
  dropDimension?: string;
  edit?: boolean;
}

export interface CompeteResult {
  action: 'status' | 'init' | 'sprint' | 'rescore' | 'report' | 'validate' | 'auto';
  matrixPath: string;
  overallScore?: number;
  nextDimension?: MatrixDimension;
  masterplanPrompt?: string;
  dimensionsUpdated?: number;
  victoryMessage?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatScore(score: number): string {
  return score.toFixed(1);
}

function gapBar(gap: number, maxGap = 10): string {
  const filled = Math.round((gap / maxGap) * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function formatTrend(dim: MatrixDimension): string {
  if (dim.sprint_history.length === 0) return '·';
  const last = dim.sprint_history[dim.sprint_history.length - 1]!;
  const delta = last.after - last.before;
  if (delta > 0) return `+${delta.toFixed(1)}↑`;
  if (delta < 0) return `${delta.toFixed(1)}↓`;
  return '→';
}

function formatStatusTable(matrix: CompeteMatrix): string {
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
    lines.push(
      `${(dim.label).slice(0, 31).padEnd(32)} ${formatScore(dim.scores['self'] ?? 0).padEnd(6)} ${formatScore(leaderScore).padEnd(8)} ${formatScore(dim.gap_to_leader).padEnd(6)} ${priority.padEnd(10)} ${trend.padEnd(8)} ${statusIcon} ${dim.status}`,
    );
  }

  return lines.join('\n');
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function actionInit(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const scanFn = options._scanCompetitors ?? scanCompetitors;
  const harshScoreFn = options._harshScore ?? computeHarshScore;

  logger.info('Scanning competitors to bootstrap CHL matrix...');

  // Get current project scores via harsh scorer
  let ourScores: import('../../core/harsh-scorer.js').HarshScoreResult | null = null;
  try {
    ourScores = await harshScoreFn({ cwd });
  } catch {
    logger.warn('Could not compute self-scores, using defaults.');
  }

  const state = await loadState({ cwd }).catch(() => null);

  const comparison = await scanFn({
    ourScores: ourScores?.dimensions ?? ({} as Record<import('../../core/harsh-scorer.js').ScoringDimension, number>),
    projectContext: {
      projectName: state?.project ?? path.basename(cwd),
      userDefinedCompetitors: state?.competitors as string[] | undefined,
    },
  });

  const project = comparison.projectName || state?.project || path.basename(cwd);
  const matrix = bootstrapMatrixFromComparison(comparison, project);

  await saveFn(matrix, cwd);

  logger.success(`Matrix initialized: ${matrix.dimensions.length} dimensions, overall ${formatScore(matrix.overallSelfScore)}/10`);
  // Show two-matrix split
  if (matrix.competitors_closed_source.length > 0 || matrix.competitors_oss.length > 0) {
    logger.info(`  Closed-source competitors: ${matrix.competitors_closed_source.join(', ') || '(none)'} (${matrix.competitors_closed_source.length} total)`);
    logger.info(`  OSS competitors: ${matrix.competitors_oss.join(', ') || '(none)'} (${matrix.competitors_oss.length} total)`);
  }
  logger.info(`Matrix: ${matrixPath}`);
  logger.info(`Next: run \`danteforge compete\` to see the gap table, then \`danteforge compete --sprint\` to start closing gaps.`);
  logger.warn(`\n⚠  Score yourself harshly. If these gaps feel small, they're wrong.`);
  logger.info(`   Generous scores produce roadmaps. Hyper-critical scores produce urgency.`);
  logger.info(`   Cursor users are paying $20+/mo — they need a real reason to switch.`);
  logger.info(`   Adjust scores in .danteforge/compete/matrix.json before running --sprint.`);
  logger.info(`   0.0 = not built at all. 9.0 = Cursor-level execution. 5.0 = basic/functional.`);

  return {
    action: 'init',
    matrixPath,
    overallScore: matrix.overallSelfScore,
    dimensionsUpdated: matrix.dimensions.length,
  };
}

async function actionStatus(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));

  const matrix = await loadFn(cwd);

  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` to bootstrap from a competitor scan.');
    logger.info('The Competitive Harvest Loop (CHL) tracks your gaps against competitors across 18 dimensions.');
    return { action: 'status', matrixPath };
  }

  const table = formatStatusTable(matrix);
  logger.info(table);

  const next = getNextSprintDimension(matrix);
  if (next) {
    const priority = computeGapPriority(next).toFixed(1);
    logger.info(`\n→ Next sprint: "${next.label}" (gap: ${formatScore(next.gap_to_leader)}, priority: ${priority})`);
    logger.info(`  Run: danteforge compete --sprint`);
  } else {
    logger.success('\n✓ All dimensions closed. Matrix complete!');
  }

  return {
    action: 'status',
    matrixPath,
    overallScore: matrix.overallSelfScore,
    nextDimension: next ?? undefined,
  };
}

function logSprintGaps(
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

function buildHarvestBriefPrompt(
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

async function displayCoflOperatorPanel(matrix: CompeteMatrix, next: MatrixDimension): Promise<void> {
  try {
    const { classifyCompetitorRoles, scoreOperatorLeverage } = await import('../../core/cofl-engine.js');
    const partition = classifyCompetitorRoles(
      matrix.competitors_closed_source ?? [],
      matrix.competitors_oss ?? [],
    );
    const entries = scoreOperatorLeverage([{
      id: next.id,
      label: next.label,
      gap_to_closed_source_leader: next.gap_to_closed_source_leader ?? next.gap_to_leader,
      gap_to_oss_leader: next.gap_to_oss_leader ?? 0,
      oss_leader: next.oss_leader ?? '',
      weight: next.weight ?? 1,
      frequency: (next as unknown as { frequency?: string }).frequency ?? 'medium',
    }], partition);
    const entry = entries[0];
    if (entry) {
      logger.info('\n## COFL Operator Leverage');
      logger.info(`Leverage score:    ${entry.leverageScore.toFixed(2)}`);
      logger.info(`Operator visible:  ${entry.operatorVisibleLift.toFixed(1)}/10`);
      logger.info(`OSS borrowable:    ${entry.borrowableFromOSS ? '✓ Yes — run /inferno to harvest' : '✗ No direct OSS pattern available'}`);
      if (partition.referenceTeachers.length > 0 || partition.specialistTeachers.length > 0) {
        logger.info(`Teacher set:       ${[...partition.referenceTeachers, ...partition.specialistTeachers].join(', ')}`);
      }
      if (partition.directPeers.length > 0) {
        logger.info(`Direct peers:      ${partition.directPeers.join(', ')}`);
      }
      logger.info('');
      logger.info('Run `danteforge cofl --auto` to run the full 10-phase competitive loop.');
    }
  } catch { /* best-effort — cofl-engine not available or matrix incomplete */ }
}

interface SprintLeaders {
  hasOssGap: boolean; hasClosedGap: boolean;
  ossLeaderScore: number; csLeaderScore: number;
  sprintTarget: number; harvestFrom: string;
}

function resolveSprintLeaders(next: ReturnType<typeof getNextSprintDimension> & object): SprintLeaders {
  const hasOssGap = !!(next.gap_to_oss_leader > 0 && next.oss_leader && next.oss_leader !== 'unknown');
  const hasClosedGap = !!(next.gap_to_closed_source_leader > 0 && next.closed_source_leader && next.closed_source_leader !== 'unknown');
  const ossLeaderScore = next.scores[next.oss_leader] ?? 0;
  const csLeaderScore = next.scores[next.closed_source_leader] ?? 0;
  const sprintTarget = hasOssGap ? ossLeaderScore : next.next_sprint_target;
  const harvestFrom = hasOssGap ? next.oss_leader : next.leader;
  return { hasOssGap, hasClosedGap, ossLeaderScore, csLeaderScore, sprintTarget, harvestFrom };
}

async function generateSprintBrief(
  next: ReturnType<typeof getNextSprintDimension> & object,
  selfScore: number,
  leaders: SprintLeaders,
  callLlm: typeof callLLM,
  webSearch?: (q: string) => Promise<string>,
): Promise<{ harvestBrief: string; masterplanPrompt: string }> {
  const { sprintTarget, harvestFrom, hasOssGap, hasClosedGap, csLeaderScore } = leaders;
  let ossSearchContext = '';
  if (webSearch) {
    try { ossSearchContext = await webSearch(`"${next.label}" open source tool MIT Apache github`); } catch { /* best-effort */ }
  }
  const harvestPrompt = buildHarvestBriefPrompt(next, selfScore, sprintTarget, harvestFrom, ossSearchContext, hasOssGap, hasClosedGap, csLeaderScore);
  const fallback = `Close "${next.label}" gap from ${formatScore(selfScore)} to ${formatScore(sprintTarget)}. Harvest from: ${harvestFrom}.`;
  try {
    const response = await callLlm(harvestPrompt);
    const goalLine = response.split('\n').find(l =>
      (l.toLowerCase().includes('close') && l.toLowerCase().includes('gap')) ||
      l.toLowerCase().includes('harvest from'),
    );
    return { harvestBrief: response, masterplanPrompt: goalLine?.trim() ?? fallback };
  } catch {
    return { harvestBrief: '', masterplanPrompt: fallback };
  }
}

async function markDimensionInProgress(
  matrix: Awaited<ReturnType<typeof loadMatrix>>,
  nextId: string,
  harvestFrom: string,
  hasOssGap: boolean,
  saveFn: (m: NonNullable<typeof matrix>, c: string) => Promise<void>,
  cwd: string,
): Promise<void> {
  if (!matrix) return;
  const dim = matrix.dimensions.find(d => d.id === nextId);
  if (dim) {
    if (dim.status === 'not-started') dim.status = 'in-progress';
    if (hasOssGap && !dim.harvest_source) dim.harvest_source = harvestFrom;
    matrix.lastUpdated = new Date().toISOString();
    await saveFn(matrix, cwd);
  }
}

function logSprintOutput(harvestBrief: string, masterplanPrompt: string, nextId: string): void {
  logger.info('\n## OSS Harvest Brief');
  if (harvestBrief) logger.info(harvestBrief);
  logger.info('\n## /inferno Masterplan Goal');
  logger.info(masterplanPrompt);
  logger.info('\nRun this with:');
  logger.info(`  danteforge inferno "${masterplanPrompt}"`);
  logger.info(`\nAfter the sprint, update the matrix:`);
  logger.info(`  danteforge compete --rescore "${nextId}=<new_score>[,<commit_sha>]"`);
}

async function actionSprint(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const callLlm = options._callLLM ?? callLLM;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'sprint', matrixPath };
  }

  const next = getNextSprintDimension(matrix);
  if (!next) {
    logger.success('All dimensions closed — matrix complete! Run `danteforge compete --init` to refresh from a new competitor scan.');
    return { action: 'sprint', matrixPath };
  }

  const selfScore = next.scores['self'] ?? 0;
  const leaders = resolveSprintLeaders(next);
  logSprintGaps(next, selfScore, leaders.sprintTarget, leaders.harvestFrom, leaders.ossLeaderScore, leaders.csLeaderScore, leaders.hasOssGap, leaders.hasClosedGap);
  logger.info(`\nGenerating harvest brief + /inferno masterplan...`);

  const { harvestBrief, masterplanPrompt } = await generateSprintBrief(next, selfScore, leaders, callLlm, options._webSearch);
  await markDimensionInProgress(matrix, next.id, leaders.harvestFrom, leaders.hasOssGap, saveFn, cwd);
  logSprintOutput(harvestBrief, masterplanPrompt, next.id);
  await displayCoflOperatorPanel(matrix, next);

  return { action: 'sprint', matrixPath, overallScore: matrix.overallSelfScore, nextDimension: next, masterplanPrompt };
}

function parseRescore(rescore: string): { dimensionId: string; score: number; commit?: string } {
  // Format: "dim_id=7.5" or "dim_id=7.5,abc123sha"
  const [idPart, rest] = rescore.split('=');
  if (!idPart || !rest) {
    throw new Error(`Invalid --rescore format. Use: "dimension_id=score" or "dimension_id=score,commit_sha"`);
  }
  const [scorePart, commit] = rest.split(',');
  const score = parseFloat(scorePart ?? '');
  if (isNaN(score) || score < 0 || score > 10) {
    throw new Error(`Score must be a number between 0 and 10, got: "${scorePart}"`);
  }
  return { dimensionId: idPart.trim(), score, commit: commit?.trim() };
}

async function actionRescore(options: CompeteOptions, cwd: string, rescore: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const receiptFn = options._readVerifyReceipt ?? ((c) => readLatestVerifyReceipt(c));
  const writeFn = options._writeEvidence ?? (async (record: CompeteEvidence, evidencePath: string) => {
    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await fs.writeFile(evidencePath, JSON.stringify(record, null, 2), 'utf8');
  });

  const { dimensionId, score, commit } = parseRescore(rescore);

  // ── CERTIFY gate ─────────────────────────────────────────────────────────────
  let receipt: VerifyReceipt | null = null;
  if (!options.skipVerify) {
    receipt = await receiptFn(cwd);
    if (!receipt) {
      logger.error('CERTIFY BLOCKED: No verify receipt found.');
      logger.info('Run `npm run verify` (or `danteforge verify`) first to certify this sprint.');
      logger.info(`Then re-run: danteforge compete --rescore "${rescore}"`);
      logger.info(`Override: danteforge compete --rescore "${rescore}" --skip-verify`);
      return { action: 'rescore', matrixPath };
    }
    if (receipt.status === 'fail') {
      logger.error(`CERTIFY BLOCKED: Last verify run had failures.`);
      logger.info(`Verify status: ${receipt.status} | ${receipt.counts.failures} failure(s)`);
      logger.info('Fix all test/typecheck failures, run `danteforge verify`, then retry.');
      logger.info(`Override: danteforge compete --rescore "${rescore}" --skip-verify`);
      return { action: 'rescore', matrixPath };
    }
    if (receipt.status === 'warn') {
      logger.warn(`Verify has warnings (${receipt.counts.warnings}). Score recorded, but fix warnings before next sprint.`);
    }
  } else {
    logger.warn('--skip-verify: CERTIFY gate bypassed. Score recorded without verify receipt.');
  }

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'rescore', matrixPath };
  }

  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) {
    const ids = matrix.dimensions.map(d => d.id).join(', ');
    logger.error(`Dimension "${dimensionId}" not found. Available: ${ids}`);
    return { action: 'rescore', matrixPath };
  }

  const before = dim.scores['self'] ?? 0;
  updateDimensionScore(matrix, dimensionId, score, commit);
  matrix.overallSelfScore = computeOverallScore(matrix);
  await saveFn(matrix, cwd);

  // ── Write PDSE evidence record ────────────────────────────────────────────────
  const evidence: CompeteEvidence = {
    dimensionId,
    label: dim.label,
    scoreBefore: before,
    scoreAfter: score,
    delta: score - before,
    verifyStatus: options.skipVerify ? 'skipped' : 'pass',
    verifyTimestamp: receipt?.timestamp,
    commit,
    timestamp: new Date().toISOString(),
  };
  const evidencePath = path.join(cwd, '.danteforge', 'evidence', 'compete', `${Date.now()}-${dimensionId}.json`);
  try {
    await writeFn(evidence, evidencePath);
  } catch {
    // Best-effort — evidence write never blocks the score update
  }

  const delta = score - before;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  logger.success(`${dim.label}: ${formatScore(before)} → ${formatScore(score)} (${deltaStr})`);
  logger.info(`Overall: ${formatScore(matrix.overallSelfScore)}/10`);
  if (commit) logger.info(`Commit: ${commit}`);
  if (dim.status === 'closed') logger.success(`✓ Gap closed on "${dim.label}"!`);

  const next = getNextSprintDimension(matrix);
  if (next) {
    logger.info(`\nNext sprint: "${next.label}" (gap: ${formatScore(next.gap_to_leader)})`);
  }

  return {
    action: 'rescore',
    matrixPath,
    overallScore: matrix.overallSelfScore,
    nextDimension: next ?? undefined,
    dimensionsUpdated: 1,
  };
}

async function actionReport(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
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

async function actionValidate(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const harshScoreFn = options._harshScore ?? computeHarshScore;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'validate', matrixPath };
  }

  // Get latest harsh-scorer output for cross-reference (best-effort)
  let harshDimensions: Record<string, number> | undefined;
  try {
    const result = await harshScoreFn({ cwd });
    harshDimensions = result.dimensions as Record<string, number>;
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

// ── Main Entry ────────────────────────────────────────────────────────────────

export async function actionAutoSprint(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const matrixPath = getMatrixPath(cwd);
  const maxCycles = options.maxCycles ?? 5;

  const runInferno = options._runInferno ?? defaultRunInferno;
  const postSprintScoreFn = options._postSprintScore ?? (options._harshScore ?? computeHarshScore);

  const matrix = await loadFn(cwd);
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

    const goal = `Improve "${next.label}" dimension to match or exceed ${topCompetitor} (${topScore.toFixed(1)}/10)`;
    try {
      await runInferno(goal, cwd);

      const postResult = await postSprintScoreFn({ cwd });
      await applyStrictOverrides(postResult, cwd, options._computeStrictDims ?? computeStrictDimensions);
      const newSelfScore = postResult.displayScore;

      // Update matrix dimension score (mutates in place, scores are 0-10 scale)
      updateDimensionScore(matrix, next.id, newSelfScore);
      matrix.overallSelfScore = computeOverallScore(matrix);
      await saveFn(matrix, cwd);

      if (newSelfScore >= topScore) {
        victoryMessage = `Victory — ${next.label} now ahead of ${topCompetitor} (${newSelfScore.toFixed(1)} vs ${topScore.toFixed(1)})`;
        emit(`  ${victoryMessage}`);
      } else {
        const remaining = topScore - newSelfScore;
        emit(`  Progress: ${selfScoreBefore.toFixed(1)} → ${newSelfScore.toFixed(1)}  (${remaining.toFixed(1)} to close gap)`);
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

export async function compete(options: CompeteOptions = {}): Promise<CompeteResult> {
  const cwd = options.cwd ?? process.cwd();
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));

  try {
    if (options.removeCompetitor) {
      const matrix = await loadFn(cwd);
      if (!matrix) { logger.error('No matrix found. Run `danteforge compete --init` first.'); return { action: 'status', matrixPath: getMatrixPath(cwd) }; }
      removeCompetitor(matrix, options.removeCompetitor);
      await saveFn(matrix, cwd);
      logger.success(`Removed "${options.removeCompetitor}" from matrix. Gaps recomputed.`);
      return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
    }

    if (options.dropDimension) {
      const matrix = await loadFn(cwd);
      if (!matrix) { logger.error('No matrix found. Run `danteforge compete --init` first.'); return { action: 'status', matrixPath: getMatrixPath(cwd) }; }
      dropDimension(matrix, options.dropDimension);
      await saveFn(matrix, cwd);
      logger.success(`Dropped dimension "${options.dropDimension}" from matrix.`);
      return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
    }

    if (options.edit) {
      const matrix = await loadFn(cwd);
      if (!matrix) { logger.error('No matrix found. Run `danteforge compete --init` first.'); return { action: 'status', matrixPath: getMatrixPath(cwd) }; }
      await confirmMatrix(matrix, { cwd, _isTTY: true }); // force TTY mode for --edit
      await saveFn(matrix, cwd);
      return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
    }

    if (options.init) return await actionInit(options, cwd);
    if (options.auto || (options.sprint && options.auto)) return await actionAutoSprint(options, cwd);
    if (options.sprint) return await actionSprint(options, cwd);
    if (options.rescore) return await actionRescore(options, cwd, options.rescore);
    if (options.report) return await actionReport(options, cwd);
    if (options.validate) return await actionValidate(options, cwd);
    return await actionStatus(options, cwd);
  } catch (err) {
    logger.error(`compete failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
