// Enterprise readiness report command
import { logger } from '../../core/logger.js';
import { generateEnterpriseReadinessReport } from '../../core/enterprise-readiness.js';

export async function enterpriseReadiness(options: {
  format?: 'json' | 'markdown' | 'html';
  output?: string;
  _generate?: typeof generateEnterpriseReadinessReport;
  _stdout?: (line: string) => void;
} = {}): Promise<void> {
  const emit = options._stdout ?? ((l) => console.log(l));
  const generateFn = options._generate ?? generateEnterpriseReadinessReport;

  logger.info('Running enterprise readiness assessment...');

  try {
    const report = await generateFn({
      format: options.format ?? 'json',
      output: options.output,
    });
    emit(JSON.stringify(report, null, 2));
  } catch (error) {
    logger.error(`Enterprise readiness check failed: ${error}`);
  }
}