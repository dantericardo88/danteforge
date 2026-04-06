// Compact command — summarize old STATE.yaml entries to save context
import { loadState, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const KEEP_DETAILED = 20; // Keep last N entries in full detail

export async function compact(cwd?: string) {
  return withErrorBoundary('compact', async () => {
    const state = await loadState({ cwd });
    const totalEntries = state.auditLog.length;

    if (totalEntries <= KEEP_DETAILED) {
      logger.info(`Audit log has ${totalEntries} entries (threshold: ${KEEP_DETAILED}) — no compaction needed`);
      return;
    }

    const oldEntries = state.auditLog.slice(0, totalEntries - KEEP_DETAILED);
    const recentEntries = state.auditLog.slice(totalEntries - KEEP_DETAILED);

    // Summarize old entries by type
    const counts: Record<string, number> = {};
    for (const entry of oldEntries) {
      const typeMatch = entry.match(/\|\s*(\w+):/);
      const type = typeMatch?.[1] ?? 'unknown';
      counts[type] = (counts[type] ?? 0) + 1;
    }

    const firstDate = oldEntries[0]?.split('|')[0]?.trim() ?? 'unknown';
    const lastDate = oldEntries[oldEntries.length - 1]?.split('|')[0]?.trim() ?? 'unknown';

    const summary = `[COMPACTED] ${oldEntries.length} entries from ${firstDate} to ${lastDate}: ` +
      Object.entries(counts).map(([type, count]) => `${type}(${count})`).join(', ');

    // Replace old entries with single summary line
    state.auditLog = [summary, ...recentEntries];

    await saveState(state, { cwd });
    logger.success(`Compacted ${oldEntries.length} old entries into 1 summary line`);
    logger.info(`Audit log: ${totalEntries} entries -> ${state.auditLog.length} entries`);
    logger.info(`Kept ${recentEntries.length} recent entries in full detail`);
  });
}
