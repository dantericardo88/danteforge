// `danteforge pipeline-status` — shows spec-driven pipeline health:
// stage timeline, spec drift warning, and spec quality score.

import { logger } from '../../core/logger.js';
import {
  getPipelineSummary,
  type PipelineSummary,
  type PipelineStage,
} from '../../core/pipeline-tracker.js';
import { checkSpecDrift, type SpecDriftResult } from '../../core/spec-drift-detector.js';
import { validateSpec, type SpecValidationResult } from '../../core/spec-validator.js';
import { loadSpecText } from '../../core/spec-matcher.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStatusOptions {
  /** Output machine-readable JSON */
  json?: boolean;
  /** Project root (defaults to process.cwd()) */
  cwd?: string;
  /** Injection seam: override getPipelineSummary */
  _getSummary?: typeof getPipelineSummary;
  /** Injection seam: override checkSpecDrift */
  _checkDrift?: typeof checkSpecDrift;
  /** Injection seam: override loadSpecText */
  _loadSpec?: typeof loadSpecText;
  /** Injection seam: override validateSpec */
  _validateSpec?: typeof validateSpec;
}

export interface PipelineStatusResult {
  summary: PipelineSummary;
  drift: SpecDriftResult;
  specQuality: SpecValidationResult | null;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const STAGE_ORDER: PipelineStage[] = [
  'specify', 'clarify', 'plan', 'tasks', 'forge', 'verify', 'synthesize', 'ship',
];

function formatElapsed(ms: number | null): string {
  if (ms === null) return 'n/a';
  if (ms < 1000) return `${ms}ms`;

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  return formatElapsed(ms) + ' ago';
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

function renderTextReport(result: PipelineStatusResult): void {
  const { summary, drift, specQuality } = result;

  logger.info('');
  logger.info('  SPEC-DRIVEN PIPELINE STATUS');
  logger.info('  ' + '─'.repeat(56));

  // --- Stage timeline ---
  if (summary.completedStages.length === 0) {
    logger.info('  No pipeline stages recorded yet.');
    logger.info('  Run "danteforge specify <idea>" to start.');
  } else {
    logger.info('');
    logger.info('  Stage Timeline:');

    const completedSet = new Set(summary.completedStages.map((s) => s.stage));

    for (const stage of STAGE_ORDER) {
      const stageSummary = summary.completedStages.find((s) => s.stage === stage);
      if (stageSummary) {
        const isCurrent = summary.currentStage === stage;
        const marker = isCurrent ? '▶' : '✓';
        const runLabel = stageSummary.runCount > 1 ? ` (×${stageSummary.runCount})` : '';
        logger.info(
          `  ${marker} ${stage.padEnd(10)} ${formatTimestamp(stageSummary.lastRun).padEnd(20)} ${timeSince(stageSummary.lastRun)}${runLabel}`,
        );
      } else {
        const isNext = !completedSet.has(stage);
        if (isNext) {
          logger.info(`  ○ ${stage.padEnd(10)} not started`);
        }
      }
    }

    if (summary.totalElapsedMs !== null) {
      logger.info('');
      logger.info(`  Total elapsed: ${formatElapsed(summary.totalElapsedMs)}`);
    }
  }

  // --- Spec drift ---
  logger.info('');
  logger.info('  Spec Drift:');
  if (drift.drifted) {
    logger.info(`  ⚠  ${drift.message}`);
    if (drift.recordedAt) {
      logger.info(`     Last plan hash recorded: ${timeSince(drift.recordedAt)}`);
    }
  } else {
    logger.info(`  ✓  ${drift.message}`);
  }

  // --- Spec quality ---
  logger.info('');
  logger.info('  Spec Quality:');

  if (specQuality === null) {
    logger.info('  —  No spec file found. Run "danteforge specify <idea>" to create one.');
  } else {
    const scoreBar = (s: number): string => {
      const filled = Math.round(s);
      return '█'.repeat(filled) + '░'.repeat(10 - filled);
    };
    const fmt = (s: number): string => s.toFixed(1).padStart(4);

    logger.info(`  Overall score: ${fmt(specQuality.score)} / 10  ${scoreBar(specQuality.score)}`);
    logger.info('');

    const dims: Array<[string, number]> = [
      ['Completeness',   specQuality.dimensions.completeness],
      ['Clarity',        specQuality.dimensions.clarity],
      ['Measurability',  specQuality.dimensions.measurability],
      ['Scope',          specQuality.dimensions.scope],
      ['Format',         specQuality.dimensions.format],
    ];

    for (const [label, score] of dims) {
      logger.info(`    ${label.padEnd(16)}${fmt(score)} / 10  ${scoreBar(score)}`);
    }

    if (specQuality.issues.length > 0) {
      logger.info('');
      logger.info('  Issues to fix:');
      for (const issue of specQuality.issues) {
        logger.info(`    ✗ ${issue}`);
      }
    }

    if (specQuality.suggestions.length > 0) {
      logger.info('');
      logger.info('  Suggestions:');
      for (const sug of specQuality.suggestions) {
        logger.info(`    → ${sug}`);
      }
    }
  }

  // --- Next action ---
  logger.info('');
  logger.info('  Next action:');
  logger.info(`  → ${summary.nextAction}`);
  logger.info('');
}

// ---------------------------------------------------------------------------
// Public command
// ---------------------------------------------------------------------------

/**
 * `danteforge pipeline-status` — shows pipeline health, spec drift, and spec quality.
 */
export async function pipelineStatus(options: PipelineStatusOptions = {}): Promise<PipelineStatusResult> {
  const cwd = options.cwd ?? process.cwd();

  const getSummaryFn = options._getSummary ?? getPipelineSummary;
  const checkDriftFn = options._checkDrift ?? checkSpecDrift;
  const loadSpecFn = options._loadSpec ?? loadSpecText;
  const validateSpecFn = options._validateSpec ?? validateSpec;

  let result: PipelineStatusResult | undefined;

  await withErrorBoundary('pipeline-status', async () => {
    // Run all checks in parallel
    const [summary, drift, specText] = await Promise.all([
      getSummaryFn(cwd),
      checkDriftFn(cwd),
      loadSpecFn(cwd),
    ]);

    const specQuality = specText ? validateSpecFn(specText) : null;

    result = { summary, drift, specQuality };

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      renderTextReport(result);
    }
  });

  // errorBoundary may have caught an error before result was assigned; return empty state
  if (!result) {
    return {
      summary: {
        completedStages: [],
        totalElapsedMs: null,
        currentStage: null,
        nextAction: 'An error occurred. Check logs.',
        entries: [],
      },
      drift: { drifted: false, lastHash: null, currentHash: '', recordedAt: null, message: 'Error.' },
      specQuality: null,
    };
  }

  return result;
}
