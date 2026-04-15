// benchmark — real 18-dimension scorecard with optional competitor comparison
import { logger } from '../../core/logger.js';
import { computeHarshScore, type HarshScoreResult, type ScoringDimension } from '../../core/harsh-scorer.js';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export interface BenchmarkOptions {
  dimension?: string;
  compare?: boolean;
  format?: 'table' | 'json';
  cwd?: string;
  // Injection seams for testing
  _harshScore?: typeof computeHarshScore;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
}

export async function benchmark(options: BenchmarkOptions = {}): Promise<void> {
  return withErrorBoundary('benchmark', async () => {
    const cwd = options.cwd ?? process.cwd();
    const harshScoreFn = options._harshScore ?? computeHarshScore;

    const result: HarshScoreResult = await harshScoreFn({ cwd });

    // ── Single-dimension output ──────────────────────────────────────────────
    if (options.dimension) {
      const dim = options.dimension as ScoringDimension;
      const score = result.displayDimensions[dim];
      if (score === undefined) {
        logger.warn(`Unknown dimension: ${options.dimension}`);
        logger.info(`Valid dimensions: ${Object.keys(result.displayDimensions).join(', ')}`);
        return;
      }
      if (options.format === 'json') {
        process.stdout.write(JSON.stringify({ dimension: dim, score }, null, 2) + '\n');
      } else {
        logger.info(`${dim}: ${score.toFixed(1)}/10`);
      }
      return;
    }

    // ── JSON output ──────────────────────────────────────────────────────────
    if (options.format === 'json') {
      process.stdout.write(JSON.stringify(result.displayDimensions, null, 2) + '\n');
      return;
    }

    // ── Full table output ────────────────────────────────────────────────────
    const rows = (Object.entries(result.displayDimensions) as [ScoringDimension, number][])
      .sort(([, a], [, b]) => b - a);

    logger.info(`\n## DanteForge Benchmark — ${result.timestamp.slice(0, 10)}`);
    logger.info(`Overall: ${result.displayScore.toFixed(1)}/10  Verdict: ${result.verdict}`);
    if (result.stubsDetected.length > 0) {
      logger.warn(`Stubs detected: ${result.stubsDetected.length} file(s) — penalty applied`);
    }
    logger.info('');
    logger.info('| Dimension | Score | Bar |');
    logger.info('|---|---|---|');
    for (const [dim, score] of rows) {
      const bar = '█'.repeat(Math.round(score)) + '░'.repeat(10 - Math.round(score));
      logger.info(`| ${dim} | ${score.toFixed(1)}/10 | ${bar} |`);
    }

    // ── Competitor comparison ────────────────────────────────────────────────
    if (options.compare) {
      const matrixFn = options._loadMatrix ?? loadMatrix;
      let matrix: CompeteMatrix | null = null;
      try {
        matrix = await matrixFn(cwd);
      } catch {
        logger.warn('Could not load CHL matrix for comparison. Run `danteforge compete --init` first.');
        return;
      }
      if (!matrix) {
        logger.warn('No CHL matrix found. Run `danteforge compete --init` to create one.');
        return;
      }

      logger.info('');
      logger.info('### vs CHL Matrix (self-score vs leader gap)');
      logger.info('| Dimension | Self | Leader Gap |');
      logger.info('|---|---|---|');
      for (const dim of matrix.dimensions) {
        const selfDisplay = (dim.scores['self'] ?? 0).toFixed(1);
        const gapDisplay = dim.gap_to_leader > 0 ? `-${dim.gap_to_leader.toFixed(1)}` : '✓ leads';
        logger.info(`| ${dim.label} | ${selfDisplay}/10 | ${gapDisplay} |`);
      }
      logger.info('');
      logger.info(`Overall matrix score: ${matrix.overallSelfScore?.toFixed(1) ?? '?'}/10`);
      logger.info(`Run \`danteforge compete --sprint\` to close the next gap.`);
    }
  });
}
