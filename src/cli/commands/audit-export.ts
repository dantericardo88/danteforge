import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { exportAuditLog, formatAuditExport, writeAuditExport } from '../../core/audit-export.js';
import { requirePremiumFeature } from '../../core/premium.js';

export interface AuditExportCommandOptions {
  format?: string;
  since?: string;
  output?: string;
  json?: boolean;
  _exportLog?: typeof exportAuditLog;
  _formatLog?: typeof formatAuditExport;
  _writeLog?: typeof writeAuditExport;
  _requirePremium?: typeof requirePremiumFeature;
  _stdout?: (line: string) => void;
}

export async function auditExport(options: AuditExportCommandOptions = {}): Promise<void> {
  const exportFn = options._exportLog ?? exportAuditLog;
  const formatFn = options._formatLog ?? formatAuditExport;
  const writeFn = options._writeLog ?? writeAuditExport;
  const premiumFn = options._requirePremium ?? requirePremiumFeature;
  const emit = options._stdout ?? ((l) => console.log(l));

  return withErrorBoundary('audit-export', async () => {
    await premiumFn('audit-export');
    const format = (options.format ?? 'json') as 'json' | 'csv' | 'markdown';
    const result = await exportFn({ format, since: options.since });

    if (options.output) {
      await writeFn(result, options.output);
      logger.success(`Audit log exported to ${options.output} (${result.filteredCount} entries)`);
    } else if (options.json) {
      emit(JSON.stringify(result, null, 2));
    } else {
      emit(formatFn(result));
    }

    if (!options.json && !options.output) {
      logger.info(`Total entries: ${result.totalCount}, filtered: ${result.filteredCount}`);
    }
  });
}
