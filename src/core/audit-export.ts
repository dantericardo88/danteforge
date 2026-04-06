import fs from 'fs/promises';
import { loadState, type DanteState } from './state.js';

export interface AuditEntry {
  timestamp: string;
  userId?: string;
  action: string;
  command?: string;
  result?: string;
  details?: string;
}

export interface AuditExportOptions {
  cwd?: string;
  format?: 'json' | 'csv' | 'markdown';
  since?: string;  // ISO date string filter
  _loadState?: typeof loadState;
}

export interface AuditExportResult {
  entries: AuditEntry[];
  totalCount: number;
  filteredCount: number;
  exportedAt: string;
  format: string;
}

/**
 * Export audit log entries from STATE.yaml to structured format.
 */
export async function exportAuditLog(opts: AuditExportOptions = {}): Promise<AuditExportResult> {
  const cwd = opts.cwd ?? process.cwd();
  const format = opts.format ?? 'json';
  const loadStateFn = opts._loadState ?? loadState;

  const state = await loadStateFn({ cwd });
  const rawLog = state.auditLog ?? [];

  // Parse audit entries
  const entries: AuditEntry[] = rawLog.map((entry: unknown) => {
    if (typeof entry === 'string') {
      // New format (v0.10.0+): "2026-04-01T... | userId | entry"
      const pipeParts = (entry as string).split(' | ');
      if (pipeParts.length >= 3) {
        const timestamp = pipeParts[0]!.trim();
        const userId = pipeParts[1]!.trim();
        const rest = pipeParts.slice(2).join(' | ').trim();
        // rest may contain "command: result" or just a message
        const cmdMatch = rest.match(/^(\w[\w-]*):\s*(.*)/);
        if (cmdMatch) {
          return { timestamp, userId, action: cmdMatch[1]!, result: cmdMatch[2] };
        }
        return { timestamp, userId, action: 'unknown', details: rest };
      }
      // Legacy format: "2026-04-01T... — command: result"
      const match = (entry as string).match(/^(\S+)\s*[—-]\s*(\w+):\s*(.*)/);
      if (match) {
        return { timestamp: match[1]!, action: match[2]!, result: match[3] };
      }
      return { timestamp: new Date().toISOString(), action: 'unknown', details: entry as string };
    }
    if (typeof entry === 'object' && entry !== null) {
      const obj = entry as Record<string, unknown>;
      return {
        timestamp: String(obj['timestamp'] ?? obj['date'] ?? ''),
        userId: obj['userId'] ? String(obj['userId']) : undefined,
        action: String(obj['action'] ?? obj['command'] ?? ''),
        command: obj['command'] ? String(obj['command']) : undefined,
        result: obj['result'] ? String(obj['result']) : undefined,
        details: obj['details'] ? String(obj['details']) : undefined,
      };
    }
    return { timestamp: '', action: 'unknown', details: String(entry) };
  });

  // Filter by date if specified
  let filtered = entries;
  if (opts.since) {
    const sinceDate = new Date(opts.since).getTime();
    filtered = entries.filter(e => {
      const ts = new Date(e.timestamp).getTime();
      return !isNaN(ts) && ts >= sinceDate;
    });
  }

  return {
    entries: filtered,
    totalCount: entries.length,
    filteredCount: filtered.length,
    exportedAt: new Date().toISOString(),
    format,
  };
}

/**
 * Format audit export result to the specified format string.
 */
export function formatAuditExport(result: AuditExportResult): string {
  switch (result.format) {
    case 'csv': {
      const header = 'timestamp,userId,action,command,result,details';
      const rows = result.entries.map(e => {
        const userId = e.userId ?? 'unknown';
        return [e.timestamp, userId, e.action, e.command ?? '', e.result ?? '', e.details ?? '']
          .map(f => `"${String(f).replace(/"/g, '""')}"`)
          .join(',');
      });
      return [header, ...rows].join('\n');
    }
    case 'markdown': {
      const lines = [
        '# Audit Trail Export',
        '',
        `Exported: ${result.exportedAt}`,
        `Entries: ${result.filteredCount} of ${result.totalCount}`,
        '',
        '| Timestamp | Action | Command | Result |',
        '| --- | --- | --- | --- |',
        ...result.entries.map(e =>
          `| ${e.timestamp} | ${e.action} | ${e.command ?? '-'} | ${e.result ?? '-'} |`
        ),
      ];
      return lines.join('\n');
    }
    default: // json
      return JSON.stringify(result, null, 2);
  }
}

/**
 * Write audit export to a file.
 */
export async function writeAuditExport(
  result: AuditExportResult,
  outputPath: string,
  _writeFile?: (p: string, c: string) => Promise<void>,
): Promise<void> {
  const writeFn = _writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf-8'));
  const content = formatAuditExport(result);
  await writeFn(outputPath, content);
}
