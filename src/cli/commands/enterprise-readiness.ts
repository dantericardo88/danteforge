// Enterprise readiness report command
import { logger } from '../../core/logger.js';
import { generateEnterpriseReadinessReport } from '../../core/enterprise-readiness.js';

export async function enterpriseReadiness(options: {
  format?: 'json' | 'markdown' | 'html';
  output?: string;
} = {}): Promise<void> {
  logger.info('Running enterprise readiness assessment...');

  try {
    const report = await generateEnterpriseReadinessReport({
      format: options.format ?? 'json',
      output: options.output,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    logger.error(`Enterprise readiness check failed: ${error}`);
  }
}