import { Command } from 'commander';
import { PerformanceMonitor } from '../core/performance-monitor.js';
import { CostTracker } from '../core/cost-tracker.js';
import { logger } from '../core/logger.js';

export async function performance(options: { monitor?: boolean; costs?: boolean; baseline?: boolean } = {}) {
  try {
    if (options.monitor) {
      const monitor = new PerformanceMonitor();
      const { recent, averages, regression } = await monitor.getCurrentMetrics();

      logger.info('Performance Metrics:');
      logger.info(`  Recent measurements: ${recent.length}`);
      logger.info(`  Avg startup time: ${averages.startupTime.toFixed(0)}ms`);
      logger.info(`  Avg memory usage: ${(averages.memoryUsage / 1024 / 1024).toFixed(1)}MB`);
      logger.info(`  Regression detected: ${regression ? 'YES' : 'NO'}`);

      if (options.baseline) {
        await monitor.updateBaseline();
      }

    } else if (options.costs) {
      const tracker = new CostTracker();
      const report = tracker.getCostReport();

      logger.info('Cost Tracking Report:');
      logger.info(`  Total costs: $${report.total.toFixed(2)}`);
      logger.info(`  Monthly: LLM $${report.monthly.llm.toFixed(2)}, API $${report.monthly.api.toFixed(2)}`);
      logger.info(`  Budget status: ${report.budgetStatus.toUpperCase()}`);

      if (Object.keys(report.byOperation).length > 0) {
        logger.info('  By operation:');
        for (const [op, cost] of Object.entries(report.byOperation)) {
          logger.info(`    ${op}: $${cost.toFixed(2)}`);
        }
      }
    } else {
      logger.info('Use --monitor for performance metrics or --costs for cost tracking');
    }

  } catch (error) {
    logger.error('Performance monitoring failed:', error);
    process.exit(1);
  }
}