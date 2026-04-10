import { benchmarkHarness } from '../../core/benchmark-harness.js';
import { logger } from '../../core/logger.js';

export async function runBenchmark(options: {
  suite?: string;
  task?: string;
  all?: boolean;
}) {
  const cwd = process.cwd();

  if (options.all) {
    // Run all suites
    const suites = benchmarkHarness.getSuites();
    logger.info(`Running all benchmark suites: ${suites.join(', ')}`);

    const allResults = [];
    for (const suiteId of suites) {
      const results = await benchmarkHarness.runSuite(suiteId, cwd);
      allResults.push(...results);
    }

    displayResults(allResults);
    return;
  }

  if (options.suite && options.task) {
    // Run specific task
    const result = await benchmarkHarness.runBenchmark(options.suite, options.task, cwd);
    if (result) {
      displayResults([result]);
    } else {
      logger.error(`Benchmark task ${options.suite}:${options.task} not found`);
    }
    return;
  }

  if (options.suite) {
    // Run entire suite
    const results = await benchmarkHarness.runSuite(options.suite, cwd);
    displayResults(results);
    return;
  }

  // Show available benchmarks
  const suites = benchmarkHarness.getSuites();
  logger.info('Available benchmark suites:');
  for (const suiteId of suites) {
    const tasks = benchmarkHarness.getSuiteTasks(suiteId);
    logger.info(`  ${suiteId}: ${tasks.length} tasks`);
    for (const task of tasks) {
      logger.info(`    - ${task.id}: ${task.name} (${task.difficulty})`);
    }
  }

  // Show recent results
  const recentResults = await benchmarkHarness.loadResults(cwd);
  if (recentResults.length > 0) {
    logger.info(`\nRecent benchmark results (${recentResults.length} total):`);
    for (const result of recentResults.slice(0, 5)) {
      const score = Math.round(result.overallScore * 100);
      logger.info(`  ${result.taskId}: ${score}% (${result.verdict})`);
    }
  }
}

function displayResults(results: any[]) {
  if (results.length === 0) {
    logger.info('No benchmark results to display');
    return;
  }

  logger.info(`\nBenchmark Results (${results.length} tasks):\n`);

  for (const result of results) {
    const score = Math.round(result.overallScore * 100);
    logger.info(`Task: ${result.taskId}`);
    logger.info(`Score: ${score}% (${result.verdict})`);
    logger.info(`Time: ${result.executionTime}ms`);

    if (Object.keys(result.criterionScores).length > 0) {
      logger.info('Criteria:');
      for (const [name, criterionScore] of Object.entries(result.criterionScores)) {
        const critScore = Math.round((criterionScore as number) * 100);
        logger.info(`  ${name}: ${critScore}%`);
      }
    }
    logger.info('---');
  }

  // Summary
  const avgScore = results.reduce((sum, r) => sum + r.overallScore, 0) / results.length;
  const avgTime = results.reduce((sum, r) => sum + r.executionTime, 0) / results.length;

  logger.info(`\nSummary:`);
  logger.info(`Average Score: ${Math.round(avgScore * 100)}%`);
  logger.info(`Average Time: ${Math.round(avgTime)}ms`);
  logger.info(`Tasks Completed: ${results.filter(r => r.verdict === 'complete').length}/${results.length}`);
}