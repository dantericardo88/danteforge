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
  type CompeteMatrix,
} from './compete-matrix.js';
import { logger } from './logger.js';
import type { ScoringDimension } from './harsh-scorer.js';

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
    logger.info('\n[Ascend] No competitive matrix found. Let\'s define your universe.\n');

    projectDescription = await askFn(
      '1. What does this project do? (1-2 sentences)',
      projectName,
    );

    const competitorInput = await askFn(
      '2. Who are your main competitors? (comma-separated, or "auto" to detect)',
      userDefinedCompetitors.length > 0 ? userDefinedCompetitors.join(', ') : 'auto',
    );
    if (competitorInput && competitorInput.toLowerCase() !== 'auto') {
      userDefinedCompetitors = competitorInput.split(',').map(s => s.trim()).filter(Boolean);
    }

    await askFn(
      '3. Which dimensions matter most? (press Enter for all 18)',
      'all',
    );
    // Note: dimension filtering not yet implemented — always uses all 18.
    // The answer is captured but the full dimension set is always used for completeness.

    await askFn(
      '4. What is your target score? (default: 9.0)',
      '9.0',
    );
    // Target is handled by ascend-engine, not stored in the matrix.

    const searchAnswer = await askFn(
      '5. Search the web for competitor patterns? (y/n)',
      'y',
    );
    enableWebSearch = searchAnswer.toLowerCase().startsWith('y');

    logger.info('\n[Ascend] Building competitive matrix...\n');
  }

  // Build a minimal ourScores record (all zeros — matrix will be updated after first assess)
  const SCORING_DIMS: ScoringDimension[] = [
    'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
    'documentation', 'performance', 'maintainability', 'developerExperience',
    'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
    'convergenceSelfHealing', 'tokenEconomy', 'ecosystemMcp',
    'enterpriseReadiness', 'communityAdoption',
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

  await saveMatrixFn(matrix, cwd);

  if (isInteractive) {
    logger.success(`[Ascend] Matrix created with ${matrix.dimensions.length} dimensions for "${projectName}".`);
  }

  return matrix;
}
