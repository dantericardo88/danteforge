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
import type { VerifyReceipt } from '../../core/verify-receipts.js';
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
  excludeDimension,
  includeDimension,
  applyAdversarialCalibration,
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
import { mergeScoreProposals, writeScoreProposal } from '../../core/matrix-development-engine.js';
import { formatScore, formatStatusTable, logSprintGaps, buildHarvestBriefPrompt, logSprintOutput } from './compete-display.js';
import { handleAmend, handleAmendFile } from './compete-amend.js';
import { defaultEvidenceWriter, parseRescore, proposeAndMergeScore, runCertifyGate, writeRescoreEvidence } from './compete-score-flow.js';
import { actionCalibrate } from './compete-calibrate.js';

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
  syncScores?: boolean;         // --sync-scores: auto-apply live scorer values to matrix self-scores
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
  amend?: string;            // --amend "dim_id=score": manually set a market dim self-score
  amendFile?: string;        // --amend-file <path>: batch-update market dim scores from JSON
  removeCompetitor?: string;
  dropDimension?: string;
  excludeDimension?: string;
  includeDimension?: string;
  edit?: boolean;
  reset?: boolean;           // --reset: replace competitors in the matrix (requires --preset or --use-canonical)
  useCanonical?: boolean;    // --use-canonical: resolve the project's preset automatically (coding-assistant for DanteCode, dev-tool-optimizer for DanteForge, etc.)
  preset?: string;           // --preset <name>: explicit preset (coding-assistant | dev-tool-optimizer | agent-framework)
  calibrate?: boolean;       // --calibrate: run adversarial scorer and apply inflated-verdict corrections
  checkAllNine?: boolean;    // --check-all-nine: exit 0 if all dims ≥ target, else exit 1
  nextDims?: number;         // --next-dims <n>: output JSON of n weakest dimensions below target
  target?: number;           // --target <n>: override 9.0 threshold for check-all-nine, auto-sprint, and next-dims
  // Injection seam for calibrate testing
  _generateAdversarialScore?: (
    selfResult: import('../../core/harsh-scorer.js').HarshScoreResult,
    opts: import('../../core/adversarial-scorer-dim.js').AdversarialScorerDimOptions,
  ) => Promise<import('../../core/adversarial-scorer-dim.js').AdversarialScoreResult>;
}

export interface CompeteResult {
  action: 'status' | 'init' | 'sprint' | 'rescore' | 'report' | 'validate' | 'auto' | 'sync-scores' | 'calibrate' | 'check-all-nine' | 'next-dims';
  matrixPath: string;
  overallScore?: number;
  nextDimension?: MatrixDimension;
  masterplanPrompt?: string;
  dimensionsUpdated?: number;
  victoryMessage?: string;
  allGreen?: boolean;
  nextDims?: NextDimEntry[];
}

export interface NextDimEntry {
  id: string;
  label: string;
  selfScore: number;
  target: number;
  gap: number;
  touches?: string[];
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

async function actionReset(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('No matrix found to reset. Run `danteforge compete --init` to bootstrap a fresh one.');
    return { action: 'status', matrixPath };
  }

  // Resolve the target preset:
  //   1. --preset <name> (explicit, highest priority)
  //   2. --use-canonical → resolve via project identity (package.json / state.project)
  //   3. Neither → reject with a hint
  const { resolveProjectPreset, getPeerPreset, isPeerPreset } = await import('../../core/peer-presets.js');
  let presetName: string | null = null;
  let presetReason = '';

  if (options.preset) {
    if (!isPeerPreset(options.preset)) {
      logger.error(`Unknown preset: "${options.preset}". Valid presets: coding-assistant, dev-tool-optimizer, agent-framework.`);
      return { action: 'status', matrixPath };
    }
    presetName = options.preset;
    presetReason = `explicit --preset ${options.preset}`;
  } else if (options.useCanonical) {
    const state = await loadState({ cwd }).catch(() => null);
    const resolution = await resolveProjectPreset(cwd, state ?? undefined);
    if (!resolution.preset) {
      logger.error(`[compete --reset] Could not resolve a preset for this project. ${resolution.reason}`);
      logger.info('  Pass --preset <name> explicitly (coding-assistant | dev-tool-optimizer | agent-framework).');
      return { action: 'status', matrixPath };
    }
    presetName = resolution.preset;
    presetReason = `auto-resolved via ${resolution.reason}`;
  } else {
    logger.warn('[compete --reset] No reset target. Pass --preset <name> or --use-canonical (auto-detects).');
    return { action: 'status', matrixPath, overallScore: matrix.overallSelfScore };
  }

  // Back up the current matrix before mutating
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(path.dirname(matrixPath), `matrix.pre-${stamp}.json`);
    await fs.copyFile(matrixPath, backupPath);
    logger.info(`[compete --reset] Backup written: ${backupPath}`);
  } catch (err) {
    logger.warn(`[compete --reset] Backup failed (${err instanceof Error ? err.message : String(err)}). Continuing.`);
  }

  const peers = getPeerPreset(presetName as Parameters<typeof getPeerPreset>[0]);
  matrix.competitors = peers;
  matrix.competitors_oss = peers;
  matrix.competitors_closed_source = [];
  await saveFn(matrix, cwd);

  logger.success(`Matrix reset with ${peers.length} peers from "${presetName}" preset (${presetReason}). Old matrix saved as matrix.pre-*.json.`);
  logger.info(`  Peers: ${peers.slice(0, 6).join(', ')}${peers.length > 6 ? ', ...' : ''}`);
  logger.info(`  Run \`danteforge universe --refresh\` to rebuild the feature universe against the new peers.`);
  return { action: 'status', matrixPath, overallScore: matrix.overallSelfScore };
}

async function actionStatus(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));

  let matrix = await loadFn(cwd);

  if (!matrix) {
    logger.info('No CHL matrix found. Run `danteforge compete --init` to bootstrap from a competitor scan.');
    logger.info('The Competitive Harvest Loop (CHL) tracks your gaps against competitors across 20 dimensions.');
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

async function actionSprint(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const callLlm = options._callLLM ?? callLLM;

  let matrix = await loadFn(cwd);
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

async function actionRescore(options: CompeteOptions, cwd: string, rescore: string): Promise<CompeteResult> {
  const matrixPath = getMatrixPath(cwd);
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));
  const writeFn = options._writeEvidence ?? defaultEvidenceWriter;

  const { dimensionId, score, commit } = parseRescore(rescore);
  const { receipt, blocked, result: gateResult } = await runCertifyGate(rescore, options, cwd, matrixPath);
  if (blocked) return gateResult!;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('No CHL matrix found. Run `danteforge compete --init` first.');
    return { action: 'rescore', matrixPath };
  }

  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) {
    logger.error(`Dimension "${dimensionId}" not found. Available: ${matrix.dimensions.map(d => d.id).join(', ')}`);
    return { action: 'rescore', matrixPath };
  }

  const before = dim.scores['self'] ?? 0;
  const evidenceRel = await writeRescoreEvidence({
    dimensionId, label: dim.label, scoreBefore: before, scoreAfter: score,
    delta: score - before, verifyStatus: options.skipVerify ? 'skipped' : 'pass',
    verifyTimestamp: receipt?.timestamp, commit, timestamp: new Date().toISOString(),
  }, cwd, writeFn);
  if (options._loadMatrix || options._saveMatrix) {
    updateDimensionScore(matrix, dimensionId, score, commit);
    matrix.overallSelfScore = computeOverallScore(matrix);
    await saveFn(matrix, cwd);
  } else {
    await proposeAndMergeScore({
      cwd,
      dimensionId,
      score,
      agent: 'compete-rescore',
      rationale: `compete --rescore ${dimensionId}=${score}`,
      evidence: evidenceRel,
      commit,
    });
  }

  const updatedMatrix = (options._loadMatrix || options._saveMatrix) ? matrix : await loadMatrix(cwd) ?? matrix;
  const updatedDim = updatedMatrix.dimensions.find(d => d.id === dimensionId) ?? dim;

  const delta = score - before;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  logger.success(`${dim.label}: ${formatScore(before)} → ${formatScore(score)} (${deltaStr})`);
  logger.info(`Overall: ${formatScore(updatedMatrix.overallSelfScore)}/10`);
  if (commit) logger.info(`Commit: ${commit}`);
  if (dim.status === 'closed') logger.success(`✓ Gap closed on "${dim.label}"!`);
  const next = getNextSprintDimension(updatedMatrix);
  if (next) logger.info(`\nNext sprint: "${next.label}" (gap: ${formatScore(next.gap_to_leader)})`);

  return { action: 'rescore', matrixPath, overallScore: updatedMatrix.overallSelfScore, nextDimension: next ?? undefined, dimensionsUpdated: 1 };
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

async function actionSyncScores(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
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
  let updated = 0;
  for (const d of report.driftedDimensions) {
    const dir = d.matrixScore > d.harshScore ? '↓' : '↑';
    logger.info(`  ${d.label}: ${formatScore(d.matrixScore)} → ${formatScore(d.harshScore)} (${dir})`);
    if (options._loadMatrix || options._saveMatrix) {
      updateDimensionScore(matrix, d.id, d.harshScore);
    } else {
      await writeScoreProposal({
        cwd,
        dimension: d.id,
        score: d.harshScore,
        agent: 'compete-sync-scores',
        rationale: `Live strict scorer drift correction from ${formatScore(d.matrixScore)} to ${formatScore(d.harshScore)}.`,
      });
    }
    updated++;
  }

  if (options._loadMatrix || options._saveMatrix) {
    matrix.lastUpdated = new Date().toISOString();
    await saveFn(matrix, cwd);
  } else {
    await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'compete-sync-scores' });
  }
  const updatedMatrix = (options._loadMatrix || options._saveMatrix) ? matrix : await loadMatrix(cwd) ?? matrix;
  logger.success(`Synced ${updated} dimension(s). Overall: ${formatScore(computeOverallScore(updatedMatrix))}/10`);
  return { action: 'validate', matrixPath, overallScore: computeOverallScore(updatedMatrix), dimensionsUpdated: updated };
}

// `actionCalibrate` + `scorerDimToMatrixId` were extracted to compete-calibrate.ts
// to keep this file under the 750 LOC hard cap. See that file for the harsh-scorer
// + adversarial-scorer + score-proposal pipeline.

// ── Main Entry ────────────────────────────────────────────────────────────────

export async function actionAutoSprint(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const emit = options._stdout ?? ((line: string) => logger.info(line));
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

    const goal = `Improve "${next.label}" dimension to match or exceed ${topCompetitor} (${topScore.toFixed(1)}/10)`;
    try {
      await runInferno(goal, cwd);

      const postResult = await postSprintScoreFn({ cwd });
      await applyStrictOverrides(postResult, cwd, options._computeStrictDims ?? computeStrictDimensions);
      // Bug A fix: prefer dimension-specific score over overall project score
      const toCamelCase = (s: string) => s.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
      const dimKey = toCamelCase(next.id) as import('../../core/harsh-scorer.js').ScoringDimension;
      const newSelfScore = postResult.displayDimensions?.[dimKey] ?? postResult.displayScore;

      if (options._loadMatrix || options._saveMatrix) {
        updateDimensionScore(matrix, next.id, newSelfScore);
        matrix.overallSelfScore = computeOverallScore(matrix);
        await saveFn(matrix, cwd);
      } else {
        await proposeAndMergeScore({
          cwd,
          dimensionId: next.id,
          score: newSelfScore,
          agent: 'compete-auto',
          rationale: `Post-inferno strict scorer for "${next.label}" (dim: ${dimKey}) returned ${newSelfScore.toFixed(1)}.`,
        });
        matrix = await loadMatrix(cwd) ?? matrix;
      }

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

export async function compete(options: CompeteOptions = {}): Promise<CompeteResult> {
  const cwd = options.cwd ?? process.cwd();

  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'compete: competitive matrix management', context: { cwd }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }

  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const saveFn = options._saveMatrix ?? ((m, c) => saveMatrix(m, c));

  try {
    if (options.amend) return await handleAmend(options.amend, loadFn, saveFn, cwd);
    if (options.amendFile) return await handleAmendFile(options.amendFile, loadFn, saveFn, cwd);

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

    if (options.excludeDimension) {
      const matrix = await loadFn(cwd);
      if (!matrix) { logger.error('No matrix found. Run `danteforge compete --init` first.'); return { action: 'status', matrixPath: getMatrixPath(cwd) }; }
      excludeDimension(matrix, options.excludeDimension);
      await saveFn(matrix, cwd);
      logger.success(`Excluded dimension "${options.excludeDimension}" — sprint selection, work-packets, and gap ranking will skip it. Reverse with --include "${options.excludeDimension}".`);
      return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
    }

    if (options.includeDimension) {
      const matrix = await loadFn(cwd);
      if (!matrix) { logger.error('No matrix found. Run `danteforge compete --init` first.'); return { action: 'status', matrixPath: getMatrixPath(cwd) }; }
      includeDimension(matrix, options.includeDimension);
      await saveFn(matrix, cwd);
      logger.success(`Included dimension "${options.includeDimension}" — it is once again eligible for sprints and work-packets.`);
      return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
    }

    if (options.edit) {
      const matrix = await loadFn(cwd);
      if (!matrix) { logger.error('No matrix found. Run `danteforge compete --init` first.'); return { action: 'status', matrixPath: getMatrixPath(cwd) }; }
      await confirmMatrix(matrix, { cwd, _isTTY: true }); // force TTY mode for --edit
      await saveFn(matrix, cwd);
      return { action: 'status', matrixPath: getMatrixPath(cwd), overallScore: matrix.overallSelfScore };
    }

    if (options.reset) return await actionReset(options, cwd);
    if (options.init) return await actionInit(options, cwd);
    if (options.checkAllNine) return await actionCheckAllNine(options, cwd);
    if (options.nextDims !== undefined) return await actionNextDims(options, cwd);
    if (options.calibrate) return await actionCalibrate(options, cwd);
    if (options.auto || (options.sprint && options.auto)) return await actionAutoSprint(options, cwd);
    if (options.sprint) return await actionSprint(options, cwd);
    if (options.rescore) return await actionRescore(options, cwd, options.rescore);
    if (options.report) return await actionReport(options, cwd);
    if (options.validate) return await actionValidate(options, cwd);
    if (options.syncScores) return await actionSyncScores(options, cwd);
    const result = await actionStatus(options, cwd);
    // --- Decision-node: record completion (best-effort) ---
    try {
      const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
      const _dnSess = getSession(cwd);
      await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'compete: competitive matrix management [complete]', result: 'compete complete', success: true, latencyMs: Date.now() - _dnT0 });
    } catch { /* best-effort */ }
    return result;
  } catch (err) {
    logger.error(`compete failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
