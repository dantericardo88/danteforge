// assess — Harsh self-assessment command
// Runs all scoring systems, benchmarks against relevant competitors, and generates a
// gap-closing masterplan. Competitor universe is derived from: user-defined list,
// /oss discoveries, LLM-discovered, or AI tool defaults (for dev-tool projects only).

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { startSpinner } from '../../core/progress.js';
import { loadState } from '../../core/state.js';
import { scoreAllArtifacts } from '../../core/pdse.js';
import { assessMaturity, type MaturityAssessment } from '../../core/maturity-engine.js';
import {
  computeHarshScore,
  type HarshScoreResult,
  type HarshScorerOptions,
  type ScoringDimension,
} from '../../core/harsh-scorer.js';
import {
  scanCompetitors,
  formatCompetitorReport,
  parseOssDiscoveries,
  type CompetitorComparison,
  type CompetitorScanOptions,
  type ProjectCompetitorContext,
} from '../../core/competitor-scanner.js';
import {
  generateMasterplan,
  type Masterplan,
  type GenerateMasterplanOptions,
} from '../../core/gap-masterplan.js';
import { MAGIC_PRESETS, type MagicLevel } from '../../core/magic-presets.js';
import {
  getOrPromptCompletionTarget,
  checkPassesTarget,
  formatCompletionTarget,
  type CompletionTarget,
} from '../../core/completion-target.js';
import {
  buildFeatureUniverse,
  scoreProjectAgainstUniverse,
  loadFeatureUniverse,
  saveFeatureUniverse,
  saveFeatureScores,
  type FeatureUniverseAssessment,
} from '../../core/feature-universe.js';
import { formatDimensionTable, type DimRow } from '../../core/report-formatter.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AssessOptions {
  harsh?: boolean;              // default: true
  competitors?: boolean;        // default: true
  minScore?: number;            // explicit override (normally from completionTarget)
  json?: boolean;               // output machine-readable JSON
  preset?: string;              // preset name for target maturity level
  cwd?: string;
  cycleNumber?: number;         // for display in loop context
  interactive?: boolean;        // whether to prompt for completion target if not set
  // Injection seams for testing
  _harshScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
  _scanCompetitors?: (opts: CompetitorScanOptions) => Promise<CompetitorComparison>;
  _generateMasterplan?: (opts: GenerateMasterplanOptions) => Promise<Masterplan>;
  _buildProjectContext?: (cwd: string) => Promise<ProjectCompetitorContext>;
  _getCompletionTarget?: (cwd: string) => Promise<CompletionTarget>;
  _buildFeatureUniverse?: (competitors: string[], ctx: { projectName: string; projectDescription?: string }) => Promise<import('../../core/feature-universe.js').FeatureUniverse>;
  _scoreFeatureUniverse?: (universe: import('../../core/feature-universe.js').FeatureUniverse, ctx: { projectName: string; projectDescription?: string }) => Promise<FeatureUniverseAssessment>;
  _callLLM?: (prompt: string) => Promise<string>;
  _now?: () => string;
}

export interface AssessResult {
  assessment: HarshScoreResult;
  comparison?: CompetitorComparison;
  masterplan: Masterplan;
  featureAssessment?: FeatureUniverseAssessment;  // present when mode=feature-universe
  completionTarget: CompletionTarget;
  overallScore: number;          // 0.0-10.0
  passesThreshold: boolean;
  minScore: number;
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function assess(options: AssessOptions = {}): Promise<AssessResult> {
  const cwd = options.cwd ?? process.cwd();
  const harsh = options.harsh ?? true;
  const enableCompetitors = options.competitors ?? true;
  const cycleNumber = options.cycleNumber ?? 1;
  const isInteractive = options.interactive ?? false;

  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const scanFn = options._scanCompetitors ?? scanCompetitors;
  const masterplanFn = options._generateMasterplan ?? generateMasterplan;
  const buildContextFn = options._buildProjectContext ?? buildProjectContext;
  const getTargetFn = options._getCompletionTarget
    ?? ((dir: string) => getOrPromptCompletionTarget(dir, isInteractive));
  const buildUniverseFn = options._buildFeatureUniverse ?? buildFeatureUniverse;
  const scoreUniverseFn = options._scoreFeatureUniverse ?? scoreProjectAgainstUniverse;

  // ── Step 0: Load or prompt for completion target ────────────────────────────
  const completionTarget = await getTargetFn(cwd);
  const isFirstRun = completionTarget.definedBy === 'default';
  const minScore = options.minScore ?? completionTarget.minScore;

  // Show CTA on first run so users know define-done exists
  if (isFirstRun) {
    logger.info('');
    logger.info('┌──────────────────────��────────────────────────────���─────┐');
    logger.info('│  No completion target set — using default:              │');
    logger.info(`│  Feature Universe: ${minScore.toFixed(1)}/10 avg on 90% of features     │`);
    logger.info('│                                                         │');
    logger.info('│  To customize "done": run `danteforge define-done`     │');
    logger.info('└─────────────────────────────────────────────────────────┘');
    logger.info('');
  }

  logger.info(`[assess] Running self-assessment (harsh=${harsh}, mode=${completionTarget.mode}, target=${minScore}/10)...`);

  const spinner = await startSpinner('Analyzing codebase...');
  spinner.update('Scoring PDSE artifacts...');

  // Determine target maturity level from preset
  let targetLevel = 5 as 1 | 2 | 3 | 4 | 5 | 6;
  if (options.preset) {
    const preset = MAGIC_PRESETS[options.preset as MagicLevel];
    if (preset) targetLevel = preset.targetMaturityLevel;
  }

  // ── Step 1: Run harsh scoring (always runs for maturity tracking) ───────────
  spinner.update('Running maturity assessment...');
  const assessment = await harshScoreFn({
    cwd,
    targetLevel,
    _loadState: async (opts) => loadState(opts),
    _scoreAllArtifacts: scoreAllArtifacts,
    _assessMaturity: (ctx) => assessMaturity(ctx),
  });

  // ── Step 2: Competitor benchmarking ────────────────────────────────────────
  let comparison: CompetitorComparison | undefined;
  let projectCtx: ProjectCompetitorContext | undefined;
  if (enableCompetitors) {
    try {
      projectCtx = await buildContextFn(cwd);
      comparison = await scanFn({
        ourScores: assessment.dimensions,
        projectContext: projectCtx,
        enableWebSearch: true,
        _callLLM: options._callLLM,
      });
    } catch {
      logger.warn('[assess] Competitor scan failed — continuing without competitor data');
    }
  }

  // ── Step 2b: Feature universe assessment (when mode=feature-universe) ───────
  let featureAssessment: FeatureUniverseAssessment | undefined;
  if (completionTarget.mode === 'feature-universe' && enableCompetitors) {
    try {
      const ctx = projectCtx ?? await buildContextFn(cwd);
      const competitorNames = comparison?.competitors.map((c) => c.name) ?? [];
      if (competitorNames.length > 0) {
        let featureUniverse = await loadFeatureUniverse(cwd).catch(() => null);
        if (!featureUniverse) {
          featureUniverse = await buildUniverseFn(competitorNames, ctx);
          await saveFeatureUniverse(featureUniverse, cwd).catch(() => {});
        }
        featureAssessment = await scoreUniverseFn(featureUniverse, ctx);
        await saveFeatureScores(featureAssessment, cwd).catch(() => {});
      }
    } catch {
      logger.warn('[assess] Feature universe assessment failed — falling back to dimension scoring');
    }
  }

  // ── Step 3: Generate masterplan ─────────────────────────────────────────────
  // When feature-universe mode: score is from universe; otherwise from harsh scorer
  const effectiveScore = featureAssessment ? featureAssessment.overallScore : assessment.displayScore;
  const masterplan = await masterplanFn({
    assessment,
    comparison,
    cycleNumber,
    targetScore: minScore,
    cwd,
  });

  const passesThreshold = featureAssessment
    ? checkPassesTarget(effectiveScore, completionTarget, featureAssessment.coveragePercent)
    : effectiveScore >= minScore;

  const result: AssessResult = {
    assessment,
    comparison,
    masterplan,
    featureAssessment,
    completionTarget,
    overallScore: effectiveScore,
    passesThreshold,
    minScore,
  };

  // ── Step 4: Output ──────────────────────────────────────────────────────────
  if (options.json) {
    logger.info(JSON.stringify(result, null, 2));
  } else {
    printAssessReport(result, cycleNumber);
  }

  return result;
}

// ── Report printer ────────────────────────────────────────────────────────────

function printAssessReport(result: AssessResult, cycleNumber: number): void {
  const { assessment, comparison, masterplan, featureAssessment, completionTarget } = result;

  const banner = [
    '╔══════════════════════════════════════════════════════╗',
    `║     DanteForge Self-Assessment Report                 ║`,
    cycleNumber > 1
      ? `║     Cycle ${String(cycleNumber).padEnd(2)} of autonomous self-improve loop    ║`
      : '║     Harsh scoring: stubs, fake-completion penalized  ║',
    '╚══════════════════════════════════════════════════════╝',
  ].join('\n');

  logger.info('\n' + banner);
  logger.info('');

  // Show completion target definition
  logger.info(`COMPLETION TARGET: ${formatCompletionTarget(completionTarget)}`);
  logger.info('');

  const passIcon = result.passesThreshold ? '✓ PASS' : '✗ BELOW TARGET';
  logger.info(`OVERALL SCORE: ${result.overallScore.toFixed(1)} / 10  (target: ${result.minScore.toFixed(1)}, gap: ${Math.max(0, result.minScore - result.overallScore).toFixed(1)})  ${passIcon}`);
  logger.info(`Verdict: ${assessment.verdict.toUpperCase()}  |  Fake-completion risk: ${assessment.fakeCompletionRisk.toUpperCase()}`);

  // Feature universe summary (when mode=feature-universe)
  if (featureAssessment) {
    logger.info('');
    logger.info(`FEATURE UNIVERSE: ${featureAssessment.implementedCount} implemented | ${featureAssessment.partialCount} partial | ${featureAssessment.missingCount} missing`);
    logger.info(`  Coverage: ${featureAssessment.coveragePercent}% (target: ${completionTarget.featureCoverage ?? 90}%)`);
    logger.info(`  Run \`danteforge universe\` for full feature breakdown`);
  }
  logger.info('');

  logger.info('DIMENSION BREAKDOWN:');
  const gaps = comparison?.gapReport ?? [];
  const dimOrder: ScoringDimension[] = [
    'functionality', 'testing', 'errorHandling', 'security',
    'uxPolish', 'documentation', 'performance', 'maintainability',
    'developerExperience', 'autonomy', 'planningQuality', 'selfImprovement',
    'specDrivenPipeline', 'convergenceSelfHealing', 'tokenEconomy',
    'ecosystemMcp', 'enterpriseReadiness', 'communityAdoption',
  ];
  const dimRows: DimRow[] = dimOrder.map((dim) => {
    const score = assessment.displayDimensions[dim] ?? 0;
    const gap = gaps.find((g) => g.dimension === dim);
    return {
      dim,
      score,
      bestCompetitor: gap && gap.delta > 0 ? gap.bestCompetitor : undefined,
      bestScore: gap && gap.delta > 0 ? gap.bestScore : undefined,
      delta: gap ? gap.delta : undefined,
      severity: gap?.severity,
    };
  });
  logger.info(formatDimensionTable(dimRows));

  if (assessment.penalties.length > 0) {
    logger.info('');
    logger.info('HARSH PENALTIES APPLIED:');
    for (const penalty of assessment.penalties) {
      logger.info(`  -${String(penalty.deduction).padStart(2)}  ${penalty.reason}`);
    }
  }

  if (assessment.stubsDetected.length > 0) {
    logger.info('');
    logger.info(`STUBS DETECTED in ${assessment.stubsDetected.length} file(s):`);
    for (const stub of assessment.stubsDetected.slice(0, 5)) {
      logger.info(`  · ${stub}`);
    }
  }

  if (comparison) {
    logger.info('');
    logger.info(formatCompetitorReport(comparison));
  }

  logger.info('');
  logger.info(`MASTERPLAN: ${masterplan.items.length} action items generated`);
  logger.info(`  P0 (critical): ${masterplan.criticalCount}  |  P1 (major): ${masterplan.majorCount}  |  P2 (minor): ${masterplan.items.filter((i) => i.priority === 'P2').length}`);
  logger.info(`  Estimated cycles to target: ~${masterplan.projectedCycles}`);
  logger.info(`  Saved to: .danteforge/MASTERPLAN.md`);

  if (!result.passesThreshold) {
    logger.info('');
    logger.info('Run `danteforge self-improve` to execute the masterplan autonomously.');
    logger.info('The loop will continue until all dimensions score ' + result.minScore.toFixed(1) + '/10.');
  } else {
    logger.success('');
    logger.success(`✓ All dimensions at or above target ${result.minScore.toFixed(1)}/10 — work is complete!`);
  }
}

// ── Project context builder ───────────────────────────────────────────────────
// Reads state + CONSTITUTION.md + OSS_REPORT.md to determine what competitor
// universe is relevant for this project.

export async function buildProjectContext(cwd: string): Promise<ProjectCompetitorContext> {
  const danteforgeDir = path.join(cwd, '.danteforge');

  // Load state for project name and user-defined competitors
  let projectName = 'this project';
  let userDefinedCompetitors: string[] | undefined;
  try {
    const state = await loadState({ cwd });
    projectName = state.project || projectName;
    if (state.competitors && state.competitors.length > 0) {
      userDefinedCompetitors = state.competitors;
    }
  } catch { /* state unavailable */ }

  // Read CONSTITUTION.md for project description
  let projectDescription: string | undefined;
  for (const fileName of ['CONSTITUTION.md', 'SPEC.md']) {
    try {
      const content = await fs.readFile(path.join(danteforgeDir, fileName), 'utf-8');
      // Extract first paragraph (up to 400 chars) as description
      const firstPara = content.replace(/^#.*\n/m, '').trim().slice(0, 400);
      if (firstPara.length > 20) {
        projectDescription = firstPara;
        break;
      }
    } catch { /* file not available */ }
  }

  // Read OSS_REPORT.md and extract discovered tool names
  let ossDiscoveries: string[] | undefined;
  try {
    const ossReport = await fs.readFile(path.join(danteforgeDir, 'OSS_REPORT.md'), 'utf-8');
    const discoveries = parseOssDiscoveries(ossReport);
    if (discoveries.length > 0) {
      ossDiscoveries = discoveries;
    }
  } catch { /* no OSS report */ }

  return { projectName, projectDescription, ossDiscoveries, userDefinedCompetitors };
}
