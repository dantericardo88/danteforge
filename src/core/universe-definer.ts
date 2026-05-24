// universe-definer.ts — Interactive or automatic competitive universe setup.
// Called by ascend-engine when no compete matrix exists yet.
// Either asks 5 questions (interactive TTY mode) or bootstraps from state defaults.

import { loadState } from './state.js';
import { scanCompetitors, type CompetitorScanOptions } from './competitor-scanner.js';
import {
  bootstrapMatrixFromComparison,
  saveMatrix,
  loadMatrix,
  KNOWN_CEILINGS,
  computeTwoGaps,
  computeOverallScore,
  type CompeteMatrix,
} from './compete-matrix.js';
import { MARKET_DIM_SPECS } from './default-market-dims.js';
import { logger } from './logger.js';
import type { ScoringDimension } from './harsh-scorer.js';
import {
  buildFeatureUniverse,
  saveFeatureUniverse,
  type FeatureUniverse,
} from './feature-universe.js';
import { resolveProjectCompetitors } from './peer-presets.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UniverseDefinerOptions {
  cwd?: string;
  interactive?: boolean;
  /** Injection seam: ask a question and return the answer (override in tests) */
  _askQuestion?: (question: string, defaultValue?: string) => Promise<string>;
  /** Injection seam: competitor scan */
  _scanCompetitors?: (opts: CompetitorScanOptions) => Promise<ReturnType<typeof scanCompetitors>>;
  /** Injection seam: callLLM for competitor scan */
  _callLLM?: (prompt: string) => Promise<string>;
  /** Injection seam: load matrix */
  _loadMatrix?: typeof loadMatrix;
  /** Injection seam: save matrix */
  _saveMatrix?: typeof saveMatrix;
  /** Injection seam: load state */
  _loadState?: typeof loadState;
  /** Injection seam: build feature universe (called after matrix save) */
  _buildFeatureUniverse?: typeof buildFeatureUniverse;
  /** Injection seam: persist feature universe */
  _saveFeatureUniverse?: typeof saveFeatureUniverse;
}

// ── Default ask function (reads from stdin TTY) ───────────────────────────────

async function defaultAskQuestion(question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let answer = '';
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      answer += chunk;
      if (answer.includes('\n')) {
        process.stdin.off('data', onData);
        const trimmed = answer.trim();
        resolve(trimmed === '' && defaultValue ? defaultValue : trimmed);
      }
    };
    process.stdin.on('data', onData);
    if (!process.stdin.isPaused()) process.stdin.resume();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collectInteractiveInput(
  askFn: (question: string, defaultValue?: string) => Promise<string>,
  projectName: string,
  defaultCompetitors: string[],
): Promise<{ projectDescription: string; userDefinedCompetitors: string[]; enableWebSearch: boolean }> {
  logger.info('\n[Ascend] No competitive matrix found. Let\'s define your universe.\n');

  const projectDescription = await askFn('1. What does this project do? (1-2 sentences)', projectName);

  const competitorInput = await askFn(
    '2. Who are your main competitors? (comma-separated, or "auto" to detect)',
    defaultCompetitors.length > 0 ? defaultCompetitors.join(', ') : 'auto',
  );
  const userDefinedCompetitors = (competitorInput && competitorInput.toLowerCase() !== 'auto')
    ? competitorInput.split(',').map(s => s.trim()).filter(Boolean)
    : defaultCompetitors;

  await askFn('3. Which dimensions matter most? (press Enter for all 20)', 'all');
  await askFn('4. What is your target score? (default: 9.0)', '9.0');

  const searchAnswer = await askFn('5. Search the web for competitor patterns? (y/n)', 'y');
  const enableWebSearch = searchAnswer.toLowerCase().startsWith('y');

  logger.info('\n[Ascend] Building competitive matrix...\n');
  return { projectDescription, userDefinedCompetitors, enableWebSearch };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Define the competitive universe for a project that has no matrix yet.
 *
 * Interactive mode (when `interactive: true` and TTY available):
 *   Asks 5 questions, runs scanCompetitors with web search, bootstraps matrix.
 *
 * Non-interactive mode (fallback):
 *   Uses state.competitors if set, else dev-tool defaults. No web search.
 *   Bootstraps a starter matrix immediately.
 */
export async function defineUniverse(options: UniverseDefinerOptions = {}): Promise<CompeteMatrix> {
  const cwd = options.cwd ?? process.cwd();
  const loadStateFn = options._loadState ?? loadState;
  const scanFn = options._scanCompetitors ?? scanCompetitors;
  const saveMatrixFn = options._saveMatrix ?? saveMatrix;

  const state = await loadStateFn({ cwd }).catch(() => ({ project: 'project', competitors: [] as string[] }));
  const projectName = (state as { project?: string }).project ?? 'project';

  const isInteractive = options.interactive && (options._askQuestion != null || process.stdin.isTTY);
  const askFn = options._askQuestion ?? defaultAskQuestion;

  let projectDescription = '';
  let userDefinedCompetitors: string[] = (state as { competitors?: string[] }).competitors ?? [];
  let enableWebSearch = false;

  if (isInteractive) {
    ({ projectDescription, userDefinedCompetitors, enableWebSearch } = await collectInteractiveInput(askFn, projectName, userDefinedCompetitors));
  }

  // Build a minimal ourScores record (all zeros — matrix will be updated after first assess)
  const SCORING_DIMS: ScoringDimension[] = [
    'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
    'documentation', 'performance', 'maintainability', 'developerExperience',
    'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
    'convergenceSelfHealing', 'tokenEconomy', 'ecosystemMcp',
    'enterpriseReadiness', 'communityAdoption',
    'contextEconomy', 'causalCoherence',
  ];
  const ourScores = Object.fromEntries(SCORING_DIMS.map(d => [d, 50])) as Record<ScoringDimension, number>;

  const comparison = await scanFn({
    ourScores,
    projectContext: {
      projectName,
      projectDescription: projectDescription || projectName,
      userDefinedCompetitors: userDefinedCompetitors.length > 0 ? userDefinedCompetitors : undefined,
    },
    enableWebSearch,
    _callLLM: options._callLLM,
  });

  const matrix = bootstrapMatrixFromComparison(comparison, projectName);

  // Apply KNOWN_CEILINGS to any dimensions not already ceiling-tagged
  for (const dim of matrix.dimensions) {
    const camelId = dim.id.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
    const known = KNOWN_CEILINGS[camelId];
    if (known && dim.ceiling === undefined) {
      dim.ceiling = known.ceiling;
      dim.ceilingReason = known.reason;
    }
  }

  // Append 30 market dimensions (idempotent — skip any already present)
  for (const spec of MARKET_DIM_SPECS) {
    if (matrix.dimensions.some(d => d.id === spec.id)) continue;
    const selfScore = spec.selfDefault;
    const scores: Record<string, number> = { self: selfScore, ...spec.baselineScores };
    const baseEntries = Object.entries(spec.baselineScores);
    const maxEntry = baseEntries.reduce(
      (b, [k, v]) => v > b[1] ? [k, v] : b,
      ['', 0] as [string, number],
    );
    const twoGaps = computeTwoGaps({ scores }, matrix.competitors_closed_source, matrix.competitors_oss);
    matrix.dimensions.push({
      id: spec.id,
      label: spec.label,
      weight: spec.weight,
      frequency: spec.frequency,
      category: spec.category,
      scores,
      gap_to_leader: Math.max(0, maxEntry[1] - selfScore),
      leader: maxEntry[0] || 'unknown',
      ...twoGaps,
      status: 'not-started',
      sprint_history: [],
      next_sprint_target: Math.min(10, selfScore + 2.0),
      ...(spec.closingStrategy !== undefined ? { closingStrategy: spec.closingStrategy } : {}),
      ...(spec.ceiling !== undefined ? { ceiling: spec.ceiling, ceilingReason: spec.ceilingReason } : {}),
      ...(spec.manualActionHint !== undefined ? { manualActionHint: spec.manualActionHint } : {}),
    });
  }
  matrix.overallSelfScore = computeOverallScore(matrix);

  await saveMatrixFn(matrix, cwd);

  // Best-effort: also build the feature universe so /universe (and ensureUniverseReady)
  // have something to score against on the very first run. Never blocks matrix creation.
  const buildFeatureUniverseFn = options._buildFeatureUniverse ?? buildFeatureUniverse;
  const saveFeatureUniverseFn = options._saveFeatureUniverse ?? saveFeatureUniverse;
  try {
    let competitorNames: string[];
    if (matrix.competitors && matrix.competitors.length > 0) {
      competitorNames = matrix.competitors.map((c: unknown) =>
        typeof c === 'string' ? c : (c as { name?: string })?.name ?? String(c),
      ).filter(Boolean);
    } else {
      // Project-aware preset fallback (DanteForge → dev-tool-optimizer,
      // DanteCode et al → coding-assistant). Empty if project is unknown.
      const resolved = await resolveProjectCompetitors(cwd, { project: projectName });
      competitorNames = resolved.competitors;
    }
    if (competitorNames.length === 0) {
      logger.info(`[Ascend] Feature universe build skipped — no peer preset resolved for "${projectName}". Run \`danteforge compete --reset --preset <name>\` to seed.`);
    } else {
    const universe: FeatureUniverse = await buildFeatureUniverseFn(competitorNames, {
      projectName,
      projectDescription: projectDescription || projectName,
    });
    if (universe.features.length > 0) {
      await saveFeatureUniverseFn(universe, cwd);
      logger.info(`[Ascend] Feature universe built: ${universe.features.length} features across ${universe.competitors.length} competitors.`);
    }
    }
  } catch (err) {
    logger.warn(`[Ascend] Feature universe build skipped (${err instanceof Error ? err.message : String(err)}). Run \`danteforge universe\` to build it manually.`);
  }

  if (isInteractive) {
    logger.success(`[Ascend] Matrix created with ${matrix.dimensions.length} dimensions (20 scored + 30 market) for "${projectName}".`);
  }

  return matrix;
}
