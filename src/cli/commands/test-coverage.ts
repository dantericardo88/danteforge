// test-coverage.ts — CLI command to detect uncovered modules and report mutation scores.
import { logger } from '../../core/logger.js';
import {
  analyzeTestCoverage,
  type CoverageGapReport,
  type GlobFn,
} from '../../core/test-coverage-analyzer.js';
import {
  getMutationSummary,
  formatMutationReport,
  type MutationSummary,
  type ReadFn,
} from '../../core/mutation-score-tracker.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestCoverageOptions {
  json?: boolean;
  failBelow?: number;
  /** Injection seam for analyzeTestCoverage (testing) */
  _glob?: GlobFn;
  /** Injection seam for getMutationSummary read fn (testing) */
  _read?: ReadFn;
  cwd?: string;
  /** Suppress process.exitCode side effect (for unit tests). Default: false */
  _suppressExitCode?: boolean;
}

export interface TestCoverageResult {
  covered: string[];
  uncovered: string[];
  coveragePercent: number;
  suggestions: string[];
  mutationSummary?: MutationSummary;
  exitCode: number;
}

// ── Command ───────────────────────────────────────────────────────────────────

/**
 * `danteforge test-coverage` — report test coverage gaps and mutation scores.
 *
 * Options:
 *   --json            Output raw JSON instead of formatted text.
 *   --fail-below <n>  Exit 1 if coverage % < n (default: 70).
 */
export async function testCoverage(options: TestCoverageOptions = {}): Promise<TestCoverageResult> {
  const cwd = options.cwd ?? process.cwd();
  const failBelow = options.failBelow ?? 70;

  // Analyze coverage
  const report: CoverageGapReport = await analyzeTestCoverage(
    'src',
    'tests',
    options._glob,
    cwd,
  );

  // Load mutation scores if available
  let mutationSummary: MutationSummary | undefined;
  try {
    const summary = await getMutationSummary(cwd, options._read);
    if (summary.recordCount > 0) {
      mutationSummary = summary;
    }
  } catch {
    // mutation scores are optional — never fatal
  }

  const exitCode = report.coveragePercent < failBelow ? 1 : 0;

  const result: TestCoverageResult = {
    covered: report.covered,
    uncovered: report.uncovered,
    coveragePercent: report.coveragePercent,
    suggestions: report.suggestions,
    mutationSummary,
    exitCode,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }

  printReport(report, mutationSummary, failBelow);

  if (exitCode !== 0) {
    logger.error(`Coverage ${report.coveragePercent}% is below threshold ${failBelow}% — exiting with code 1`);
    if (!options._suppressExitCode) {
      process.exitCode = 1;
    }
  }

  return result;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function printReport(
  report: CoverageGapReport,
  mutation: MutationSummary | undefined,
  failBelow: number,
): void {
  const { covered, uncovered, coveragePercent, suggestions } = report;

  logger.info('=== Test Coverage Report ===');
  logger.info('');
  logger.info(`Coverage: ${coveragePercent}% (${covered.length} covered, ${uncovered.length} uncovered)`);
  logger.info(`Threshold: ${failBelow}%  Status: ${coveragePercent >= failBelow ? 'PASS' : 'FAIL'}`);
  logger.info('');

  if (covered.length > 0) {
    logger.info(`Covered modules (${covered.length}):`);
    for (const m of covered) {
      logger.info(`  [x] ${m}`);
    }
    logger.info('');
  }

  if (uncovered.length > 0) {
    logger.info(`Uncovered modules (${uncovered.length}):`);
    for (const m of uncovered) {
      logger.warn(`  [ ] ${m}`);
    }
    logger.info('');
  }

  if (suggestions.length > 0) {
    logger.info('Suggestions:');
    for (const s of suggestions) {
      logger.info(`  - ${s}`);
    }
    logger.info('');
  }

  if (mutation) {
    logger.info(formatMutationReport(mutation));
  } else {
    logger.info('No mutation score data found (run `danteforge mutation-score` to generate).');
  }
}
