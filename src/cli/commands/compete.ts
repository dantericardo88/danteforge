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
import { defaultEvidenceWriter, ensureMatrixOnDisk, parseRescore, proposeAndMergeScore, runCertifyGate, writeRescoreEvidence } from './compete-score-flow.js';
import { actionCalibrate } from './compete-calibrate.js';
import { actionReport, actionValidate, actionSyncScores, actionAutoSprint, actionNextDims, actionCheckAllNine } from './compete-reports.js';
export { actionCheckAllNine, actionNextDims } from './compete-reports.js';
import { SCORING_DOCTRINE_SHORT } from '../../core/scoring-doctrine.js';
import { computeGapReport, formatGapReport, buildReferenceSnapshot } from '../../core/gap-report.js';

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
  gapReport?: boolean;          // --gap-report: gap-first relative position vs competitors + reference snapshot
  force?: boolean;              // --force: allow --init to overwrite an existing substantial matrix (backs up first)
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

// ── Score snapshot helper ─────────────────────────────────────────────────────

async function writeScoreSnapshot(score: number, cwd: string): Promise<void> {
  try {
    const reportsDir = path.join(cwd, '.danteforge', 'reports');
    await fs.mkdir(reportsDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(reportsDir, `score-${ts}.json`);
    await fs.writeFile(file, JSON.stringify({ overallScore: score, timestamp: new Date().toISOString(), dims: 24, source: 'compete-matrix' }, null, 2));
  } catch { /* never block compete */ }
}

export interface CompeteResult {
  action: 'status' | 'init' | 'sprint' | 'rescore' | 'report' | 'validate' | 'auto' | 'sync-scores' | 'calibrate' | 'check-all-nine' | 'next-dims' | 'gap-report';
  matrixPath: string;
  overallScore?: number;
  nextDimension?: MatrixDimension;
  masterplanPrompt?: string;
  dimensionsUpdated?: number;
  victoryMessage?: string;
  allGreen?: boolean;
  nextDims?: NextDimEntry[];
  /** Net weighted position vs the field (gap-report action). Positive = ahead. */
  netPosition?: number;
  /** Path to the frozen reference-set snapshot written by the gap-report action. */
  referenceSnapshotPath?: string;
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

  // ── Clobber guard (data-loss protection) ──────────────────────────────────
  // `--init` is for FIRST-TIME bootstrap. If a substantial matrix already exists
  // (real competitors scanned, or a large dimension set), refuse to overwrite it
  // — re-running --init on a configured project (or a failed LLM scan) must never
  // silently destroy committed competitive scores. Use --reset (backs up) for a
  // deliberate replace, or --force here as an escape hatch.
  const existing = await loadFn(cwd).catch(() => null);
  const existingCompetitors = existing?.competitors?.length ?? 0;
  const existingDims = existing?.dimensions?.length ?? 0;
  const existingSubstantial = !!existing && (existingCompetitors > 0 || existingDims > 30);
  if (existingSubstantial && !options.force) {
    logger.error(`A competitive matrix already exists for this project: ${existingDims} dimensions, ${existingCompetitors} competitors.`);
    logger.error(`\`compete --init\` would OVERWRITE it. This is almost never what you want on a configured project.`);
    logger.info(`  • To view it:            danteforge compete --gap-report`);
    logger.info(`  • To replace deliberately: danteforge compete --reset --use-canonical   (backs up first)`);
    logger.info(`  • To force re-bootstrap:   danteforge compete --init --force            (backs up first)`);
    return { action: 'init', matrixPath, overallScore: existing?.overallSelfScore };
  }

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

  // ── Empty-scan guard (LLM-failure protection) ─────────────────────────────
  // If the competitor scan returned zero competitors, the LLM provider almost
  // certainly failed/timed out (e.g. local Ollama over the 180s cap with no cloud
  // key). Writing this empty preset over a real matrix is destructive; even with
  // --force, never replace an existing matrix with a competitor-less empty result.
  if (matrix.competitors.length === 0) {
    logger.error(`Competitor scan returned 0 competitors — the LLM provider likely failed or timed out.`);
    logger.error(`Fix the LLM backend, then retry:`);
    logger.info(`  • Set a cloud key:  danteforge config --set-key "anthropic:sk-..."   (or "openai:sk-...")`);
    logger.info(`  • Or a faster model: danteforge config --model "ollama:qwen2.5-coder:7b"`);
    if (existing) {
      logger.error(`Existing matrix PRESERVED (${existingDims} dims, ${existingCompetitors} competitors) — refusing to overwrite it with an empty scan.`);
      return { action: 'init', matrixPath, overallScore: existing.overallSelfScore };
    }
    logger.warn(`No prior matrix to preserve; writing the empty preset so you have a starting point, but it is NOT a real baseline until the scan works.`);
  }

  // Back up any existing matrix before overwriting (belt-and-suspenders on top of git tracking).
  if (existing) {
    try {
      const backupPath = matrixPath.replace(/\.json$/, `.backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
      await fs.copyFile(matrixPath, backupPath);
      logger.info(`Backed up previous matrix → ${path.basename(backupPath)}`);
    } catch { /* best-effort backup */ }
  }

  await saveFn(matrix, cwd);

  logger.success(`Matrix initialized: ${matrix.dimensions.length} dimensions, overall ${formatScore(matrix.overallSelfScore)}/10`);
  // Show two-matrix split
  if (matrix.competitors_closed_source.length > 0 || matrix.competitors_oss.length > 0) {
    logger.info(`  Closed-source competitors: ${matrix.competitors_closed_source.join(', ') || '(none)'} (${matrix.competitors_closed_source.length} total)`);
    logger.info(`  OSS competitors: ${matrix.competitors_oss.join(', ') || '(none)'} (${matrix.competitors_oss.length} total)`);
  }
  logger.info(`Matrix: ${matrixPath}`);
  logger.info(`Next: run \`danteforge compete\` to see the gap table, then \`danteforge compete --sprint\` to start closing gaps.`);
  logger.warn(`\n⚠  Score rigorously from evidence. If these gaps feel small, audit the evidence.`);
  logger.info(`   Scores must come from outcome evidence, not opinions.`);
  logger.info(`   Compare only against actual competitors per positioning.md.`);
  logger.info(`   The gap IS the value — finding real gaps means finding what to build next.`);
  logger.info(`   Run \`node scripts/evidence-rescore.mjs\` to derive scores from evidence.`);

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

  const overallScore = matrix.overallSelfScore;
  void writeScoreSnapshot(overallScore, cwd);
  return {
    action: 'status',
    matrixPath,
    overallScore,
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
  // Phase E final migration: proposal flow is the single source of score
  // change events. The injection-seam branch was the last conditional bypass
  // on this surface.
  void saveFn;
  await ensureMatrixOnDisk(matrix, cwd);
  await proposeAndMergeScore({
    cwd,
    dimensionId,
    score,
    agent: 'compete-rescore',
    rationale: `compete --rescore ${dimensionId}=${score}`,
    evidence: evidenceRel,
    commit,
  });

  const updatedMatrix = await loadMatrix(cwd) ?? matrix;
  const updatedDim = updatedMatrix.dimensions.find(d => d.id === dimensionId) ?? dim;

  const delta = score - before;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
  logger.success(`${dim.label}: ${formatScore(before)} → ${formatScore(score)} (${deltaStr})`);
  logger.info(`Overall: ${formatScore(updatedMatrix.overallSelfScore)}/10`);
  if (commit) logger.info(`Commit: ${commit}`);
  if (dim.status === 'closed') logger.success(`✓ Gap closed on "${dim.label}"!`);
  const next = getNextSprintDimension(updatedMatrix);
  if (next) logger.info(`\nNext sprint: "${next.label}" (gap: ${formatScore(next.gap_to_leader)})`);

  const rescoreOverall = updatedMatrix.overallSelfScore;
  void writeScoreSnapshot(rescoreOverall, cwd);
  return { action: 'rescore', matrixPath, overallScore: rescoreOverall, nextDimension: next ?? undefined, dimensionsUpdated: 1 };
}

async function actionGapReport(options: CompeteOptions, cwd: string): Promise<CompeteResult> {
  const loadFn = options._loadMatrix ?? ((c) => loadMatrix(c));
  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('No matrix found. Run `danteforge compete --init` first.');
    return { action: 'gap-report', matrixPath: getMatrixPath(cwd) };
  }

  const report = computeGapReport(matrix);

  if (options.json) {
    logger.info(JSON.stringify(report, null, 2));
  } else {
    const out = options._stdout ?? ((l: string) => logger.info(l));
    for (const line of formatGapReport(report).split('\n')) out(line);
  }

  // Freeze the competitor reference set so a later rubric change can be diffed
  // against it (the governance-gate slice). The snapshot is the anchor that makes
  // self-serving rubric drift visible.
  const now = options._now ? options._now() : new Date().toISOString();
  let gitSha: string | null = null;
  try {
    const { execFileSync } = await import('node:child_process');
    gitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 }).toString().trim() || null;
  } catch { /* git optional */ }

  let referenceSnapshotPath: string | undefined;
  try {
    const snapshot = buildReferenceSnapshot(matrix, now, gitSha);
    const dir = path.join(cwd, '.danteforge', 'reference-scores');
    await fs.mkdir(dir, { recursive: true });
    const stamp = now.replace(/[:.]/g, '-').slice(0, 19);
    referenceSnapshotPath = path.join(dir, `${stamp}.json`);
    await fs.writeFile(referenceSnapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
    // Maintain a stable pointer to the most recent snapshot for the future diff gate.
    await fs.writeFile(path.join(dir, 'latest.json'), JSON.stringify(snapshot, null, 2), 'utf8');
    if (!options.json) logger.info(`\nReference set frozen → ${path.relative(cwd, referenceSnapshotPath)}`);
  } catch { /* snapshot is best-effort — never block the report */ }

  return {
    action: 'gap-report',
    matrixPath: getMatrixPath(cwd),
    overallScore: report.absoluteSelfScore,
    netPosition: report.netPositionOverall,
    referenceSnapshotPath,
  };
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
    if (options.gapReport) return await actionGapReport(options, cwd);
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
