import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { exportAuditLog, formatAuditExport, writeAuditExport } from '../../core/audit-export.js';
import { requirePremiumFeature } from '../../core/premium.js';

export interface AuditExportCommandOptions {
  format?: string;
  since?: string;
  output?: string;
  json?: boolean;
}

export async function auditExport(options: AuditExportCommandOptions = {}): Promise<void> {
  return withErrorBoundary('audit-export', async () => {
    await requirePremiumFeature('audit-export');
    const format = (options.format ?? 'json') as 'json' | 'csv' | 'markdown';
    const result = await exportAuditLog({ format, since: options.since });

    if (options.output) {
      await writeAuditExport(result, options.output);
      logger.success(`Audit log exported to ${options.output} (${result.filteredCount} entries)`);
    } else if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const formatted = formatAuditExport(result);
      console.log(formatted);
    }

    if (!options.json && !options.output) {
      logger.info(`Total entries: ${result.totalCount}, filtered: ${result.filteredCount}`);
    }
  });
}
