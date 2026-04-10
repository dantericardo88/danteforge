import { Command } from 'commander';
import { benchmarkHarness } from '../core/benchmark-harness.js';
import { logger } from '../core/logger.js';

export async function runBenchmark(options: { suite?: string; task?: string; all?: boolean; harness?: boolean } = {}) {
  try {
    logger.info('Running benchmarks...');

    if (options.harness) {
      // Use real evidence-based benchmarking
      if (options.suite && options.task) {
        const result = await benchmarkHarness.runBenchmark(options.suite, options.task);
        if (result) {
          logger.success(`Benchmark ${options.task} completed with score: ${result.overallScore.toFixed(2)}`);
          logger.info(`Verdict: ${result.verdict}`);
          logger.info(`Execution time: ${result.executionTime}ms`);
        } else {
          logger.error('Benchmark failed');
        }
      } else if (options.suite) {
        const results = await benchmarkHarness.runSuite(options.suite);
        logger.success(`Suite ${options.suite} completed: ${results.length} tasks`);
        for (const result of results) {
          logger.info(`  ${result.taskId}: ${result.overallScore.toFixed(2)} (${result.verdict})`);
        }
      } else if (options.all) {
        const suites = benchmarkHarness.getSuites();
        for (const suiteId of suites) {
          logger.info(`Running suite: ${suiteId}`);
          const results = await benchmarkHarness.runSuite(suiteId);
          logger.success(`Suite ${suiteId} completed: ${results.length} tasks`);
        }
      }
    } else {
      logger.warn('Harness mode required for real evidence collection');
    }

  } catch (error) {
    logger.error('Benchmark execution failed:', error);
    process.exit(1);
  }
}