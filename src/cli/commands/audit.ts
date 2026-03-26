// Audit command — query the self-edit audit log
import { loadAuditLog } from '../../core/safe-self-edit.js';
import { logger } from '../../core/logger.js';

export async function audit(options: {
  last?: string;
  format?: string;
  cwd?: string;
} = {}): Promise<void> {
  const entries = await loadAuditLog(options.cwd);
  const n = options.last ? Math.max(0, parseInt(options.last, 10)) : entries.length;
  const slice = entries.slice(-n || entries.length);

  if (slice.length === 0) {
    logger.info('No self-edit audit entries found.');
    return;
  }

  if (options.format === 'json') {
    process.stdout.write(JSON.stringify(slice, null, 2) + '\n');
    return;
  }

  logger.info(`Self-edit audit log (${slice.length} entries):\n`);
  for (const entry of slice) {
    const status = entry.approved ? '[APPROVED]' : '[DENIED]';
    logger.info(`  ${entry.timestamp} ${status} ${entry.filePath} (policy=${entry.policy})`);
    logger.info(`    reason: ${entry.reason}`);
  }
}
