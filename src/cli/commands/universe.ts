// universe — View, refresh, and inspect the feature universe
// Shows what features the competitive landscape demands and how the project scores.

import { logger } from '../../core/logger.js';
import { loadState } from '../../core/state.js';
import {
  buildFeatureUniverse,
  scoreProjectAgainstUniverse,
  loadFeatureUniverse,
  saveFeatureUniverse,
  saveFeatureScores,
  loadFeatureScores,
  type FeatureUniverse,
  type FeatureUniverseAssessment,
} from '../../core/feature-universe.js';
import { formatDimensionBar } from '../../core/harsh-scorer.js';
import { buildProjectContext } from './assess.js';
import {
  getOrPromptCompletionTarget,
  type CompletionTarget,
} from '../../core/completion-target.js';
import { callLLM } from '../../core/llm.js';
import fs from 'fs/promises';
import path from 'path';

export { formatDimensionBar };

export interface UniverseOptions {
  refresh?: boolean;          // Force rebuild of feature universe
  json?: boolean;             // Output machine-readable JSON
  cwd?: string;
  // Injection seams for testing
  _loadUniverse?: (cwd: string) => Promise<FeatureUniverse | null>;
  _buildUniverse?: (competitors: string[], ctx: { projectName: string; projectDescription?: string }, cwd: string) => Promise<FeatureUniverse>;
  _scoreUniverse?: (universe: FeatureUniverse, ctx: { projectName: string; projectDescription?: string; constitutionContent?: string; fileList?: string[] }) => Promise<FeatureUniverseAssessment>;
  _loadScores?: (cwd: string) => Promise<FeatureUniverseAssessment | null>;
  _getTarget?: (cwd: string) => Promise<CompletionTarget>;
  _competitorNames?: string[];   // bypass competitor resolution for testing
  _callLLM?: (prompt: string) => Promise<string>;
}

export async function universe(options: UniverseOptions = {}): Promise<FeatureUniverseAssessment | null> {
  const cwd = options.cwd ?? process.cwd();
  const refresh = options.refresh ?? false;

  const loadUniverseFn = options._loadUniverse ?? ((dir: string) => loadFeatureUniverse(dir));
  const buildUniverseFn = options._buildUniverse ?? defaultBuildUniverse;
  const scoreUniverseFn = options._scoreUniverse ?? defaultScoreUniverse;
  const loadScoresFn = options._loadScores ?? ((dir: string) => loadFeatureScores(dir));
  const getTargetFn = options._getTarget ?? ((dir: string) => getOrPromptCompletionTarget(dir, false));
  const llmFn = options._callLLM ?? ((p: string) => callLLM(p));

  // Load completion target
  const target = await getTargetFn(cwd);

  // Load or build feature universe
  let featureUniverse = refresh ? null : await loadUniverseFn(cwd);

  if (!featureUniverse) {
    logger.info('[universe] Building feature universe from competitors...');
    const ctx = await buildProjectContext(cwd).catch(() => ({
      projectName: 'this project',
      userDefinedCompetitors: undefined as string[] | undefined,
      ossDiscoveries: undefined as string[] | undefined,
    }));

    const competitorNames = options._competitorNames
      ?? await resolveCompetitorNames(cwd, ctx);

    if (competitorNames.length === 0 && !options._buildUniverse) {
      logger.warn('[universe] No competitors found. Run `/oss` first or set state.competitors.');
      logger.info('  Example: add "competitors: [Shopify, WooCommerce]" to .danteforge/STATE.yaml');
      return null;
    }

    featureUniverse = await buildUniverseFn(competitorNames, ctx, cwd);
    await saveFeatureUniverse(featureUniverse, cwd).catch(() => {});
    logger.success(`[universe] Built universe: ${featureUniverse.features.length} features from ${featureUniverse.competitors.length} competitors`);
  }

  // Load or compute scores
  let assessment = refresh ? null : await loadScoresFn(cwd);

  if (!assessment) {
    logger.info('[universe] Scoring project against feature universe...');
    const rawCtx = await buildProjectContext(cwd).catch(() => ({ projectName: 'this project' as string, projectDescription: undefined as string | undefined }));
    const ctx = { projectName: rawCtx.projectName, projectDescription: ('projectDescription' in rawCtx ? rawCtx.projectDescription : undefined) as string | undefined };
    const constitutionContent = await readFileOpt(path.join(cwd, '.danteforge', 'CONSTITUTION.md'));
    const srcFiles = await listSrcFiles(cwd);

    assessment = await scoreUniverseFn(featureUniverse, {
      projectName: ctx.projectName,
      projectDescription: ctx.projectDescription,
      constitutionContent,
      fileList: srcFiles,
    });
    await saveFeatureScores(assessment, cwd).catch(() => {});
  }

  // Output
  if (options.json) {
    logger.info(JSON.stringify(assessment, null, 2));
    return assessment;
  }

  printUniverseReport(assessment, target);
  return assessment;
}

// ── Report printer ────────────────────────────────────────────────────────────

function printUniverseReport(assessment: FeatureUniverseAssessment, target: CompletionTarget): void {
  const { universe, scores, overallScore, implementedCount, partialCount, missingCount, coveragePercent } = assessment;
  const minScore = target.minScore;
  const minCoverage = target.featureCoverage ?? 90;

  logger.info('');
  logger.info(`Feature Universe — ${universe.features.length} unique features across ${universe.competitors.length} competitors`);
  logger.info(`${universe.sourceDescription}`);
  logger.info('');

  // Group by category
  const byCategory = new Map<string, typeof universe.features>();
  for (const f of universe.features) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }

  for (const [cat, features] of byCategory) {
    logger.info(`${cat.toUpperCase()} (${features.length})`);
    for (const f of features) {
      const score = scores.find((s) => s.featureId === f.id);
      const scoreVal = score?.score ?? 0;
      const bar = formatDimensionBar(scoreVal * 10, 8);
      const scoreStr = `${scoreVal.toFixed(1)}/10`;
      const icon = !score ? '?' : scoreVal >= 7 ? '✓' : scoreVal >= 4 ? '△' : '✗';
      const compStr = f.competitorsThatHaveIt.slice(0, 3).join(', ');
      logger.info(`  ${icon} ${f.id.padEnd(9)} ${bar} ${scoreStr.padEnd(8)} ${f.name.slice(0, 35).padEnd(36)} (${compStr})`);
    }
    logger.info('');
  }

  // Missing features callout
  const missing = scores.filter((s) => s.score < 4);
  if (missing.length > 0) {
    logger.warn('MISSING FEATURES (need implementation):');
    for (const s of missing) {
      const f = universe.features.find((feat) => feat.id === s.featureId);
      logger.warn(`  ✗ ${s.featureId}  ${s.featureName}`);
      if (f?.bestImplementationHint) logger.info(`       Hint: ${f.bestImplementationHint}`);
    }
    logger.info('');
  }

  // Summary
  const passScore = overallScore >= minScore;
  const passCoverage = coveragePercent >= minCoverage;
  const passIcon = passScore && passCoverage ? '✓ PASS' : '✗ BELOW TARGET';

  logger.info(`OVERALL: ${overallScore.toFixed(1)}/10 — ${implementedCount}/${universe.features.length} implemented (${coveragePercent}% coverage)  ${passIcon}`);
  logger.info(`Target:  ${minScore.toFixed(1)}/10 — ${Math.ceil(universe.features.length * minCoverage / 100)}/${universe.features.length} features at ${minScore}+ (${minCoverage}% coverage)`);

  const gapItems = scores.filter((s) => s.score < minScore).length;
  if (gapItems > 0) {
    logger.info(`Gap:     ${gapItems} feature${gapItems === 1 ? '' : 's'} need improvement`);
    logger.info('');
    logger.info('Run `danteforge self-improve` to automatically close these gaps.');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveCompetitorNames(cwd: string, ctx: { userDefinedCompetitors?: string[]; ossDiscoveries?: string[] }): Promise<string[]> {
  if (ctx.userDefinedCompetitors?.length) return ctx.userDefinedCompetitors;
  if (ctx.ossDiscoveries?.length) return ctx.ossDiscoveries;
  try {
    const state = await loadState({ cwd });
    if (state.competitors?.length) return state.competitors;
  } catch { /* no state */ }
  return [];
}

async function defaultBuildUniverse(
  competitors: string[],
  ctx: { projectName: string; projectDescription?: string },
  _cwd: string,
): Promise<FeatureUniverse> {
  return buildFeatureUniverse(competitors, ctx);
}

async function defaultScoreUniverse(
  universe: FeatureUniverse,
  ctx: { projectName: string; projectDescription?: string; constitutionContent?: string; fileList?: string[] },
): Promise<FeatureUniverseAssessment> {
  return scoreProjectAgainstUniverse(universe, ctx);
}

async function readFileOpt(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function listSrcFiles(cwd: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(cwd, 'src'), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.ts'))
      .map((e) => `src/${e.name}`)
      .slice(0, 40);
  } catch {
    return [];
  }
}
