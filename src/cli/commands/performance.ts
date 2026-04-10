import { Command } from 'commander';
import { PerformanceMonitor } from '../core/performance-monitor.js';
import { logger } from '../core/logger.js';

export async function performance(options: { check?: boolean; cwd?: string } = {}) {
  try {
    const cwd = options.cwd || process.cwd();

    if (options.check) {
      const monitor = new PerformanceMonitor(cwd);
      const { recent, averages, regression } = await monitor.getCurrentMetrics();

      logger.info('Performance Check Results:');
      logger.info(`  Recent measurements: ${recent.length}`);
      logger.info(`  Avg startup time: ${averages.startupTime.toFixed(0)}ms`);
      logger.info(`  Avg memory usage: ${(averages.memoryUsage / 1024 / 1024).toFixed(1)}MB`);
      logger.info(`  Regression detected: ${regression ? 'YES ⚠️' : 'NO ✅'}`);

      if (regression) {
        logger.error('Performance regression detected! Execution time has increased significantly.');
        logger.info('Consider optimizing performance-critical code paths.');
        process.exit(1);
      } else {
        logger.success('Performance check passed - no regression detected.');
      }
    } else {
      logger.info('Use --check to run performance regression check');
    }

  } catch (error) {
    logger.error('Performance check failed:', error);
    process.exit(1);
  }
}