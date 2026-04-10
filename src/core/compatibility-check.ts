import { Command } from 'commander';
import { checkToolCompatibility } from '../core/compatibility-engine.js';
import { logger } from '../core/logger.js';

export async function runCompatibilityCheck(): Promise<void> {
  try {
    logger.info('Running tool compatibility checks...');

    const checks = await checkToolCompatibility();

    logger.info('Compatibility Results:');
    for (const check of checks) {
      const status = check.compatible ? '✅' : '❌';
      logger.info(`${status} ${check.tool} (${check.version}): ${check.compatible ? 'Compatible' : 'Issues found'}`);

      if (check.issues.length > 0) {
        logger.warn('  Issues:');
        for (const issue of check.issues) {
          logger.warn(`    - ${issue}`);
        }
      }

      if (check.recommendations.length > 0) {
        logger.info('  Recommendations:');
        for (const rec of check.recommendations) {
          logger.info(`    - ${rec}`);
        }
      }
    }

    const compatibleCount = checks.filter(c => c.compatible).length;
    logger.success(`Compatibility check complete: ${compatibleCount}/${checks.length} tools compatible`);

  } catch (error) {
    logger.error('Compatibility check failed:', error);
    process.exit(1);
  }
}