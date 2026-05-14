// dx-telemetry.ts — Local-only Developer Experience telemetry.
// Persists to .danteforge/dx-telemetry.jsonl (one JSON object per line).
// Never phones home. All operations are best-effort (never throws).
// -----------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DxEvent {
  command: string;
  success: boolean;
  durationMs: number;
  errorCode?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELEMETRY_FILE = '.danteforge/dx-telemetry.jsonl';
const MAX_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function telemetryPath(cwd: string): string {
  return path.join(cwd, TELEMETRY_FILE);
}

async function readEntries(filePath: string): Promise<DxEvent[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const entries: DxEvent[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as DxEvent);
      } catch {
        // Skip malformed lines silently.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

async function writeEntries(filePath: string, entries: DxEvent[]): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.writeFile(filePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a single DX event.  Auto-prunes to the last MAX_ENTRIES entries.
 * Best-effort: never throws.
 */
export async function recordDxEvent(cwd: string, event: DxEvent): Promise<void> {
  try {
    const filePath = telemetryPath(cwd);
    const entries = await readEntries(filePath);
    entries.push(event);

    // Prune to MAX_ENTRIES (keep the most recent).
    const pruned = entries.length > MAX_ENTRIES
      ? entries.slice(entries.length - MAX_ENTRIES)
      : entries;

    await writeEntries(filePath, pruned);
  } catch {
    // Best-effort: silently swallow all errors.
  }
}

/**
 * Compute aggregate DX statistics from the persisted telemetry.
 */
export async function getDxStats(cwd: string): Promise<{
  totalCommands: number;
  successRate: number;
  avgDurationMs: number;
  mostUsed: string[];
  recentErrors: string[];
}> {
  try {
    const filePath = telemetryPath(cwd);
    const entries = await readEntries(filePath);

    if (entries.length === 0) {
      return { totalCommands: 0, successRate: 1, avgDurationMs: 0, mostUsed: [], recentErrors: [] };
    }

    const totalCommands = entries.length;
    const successCount = entries.filter((e) => e.success).length;
    const successRate = successCount / totalCommands;

    const totalDuration = entries.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
    const avgDurationMs = totalDuration / totalCommands;

    // Command frequency map.
    const freq = new Map<string, number>();
    for (const e of entries) {
      freq.set(e.command, (freq.get(e.command) ?? 0) + 1);
    }
    const mostUsed = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cmd]) => cmd);

    // Recent error codes (last 10 failures, deduplicated, most-recent first).
    const recentErrors = entries
      .filter((e) => !e.success && e.errorCode)
      .slice(-10)
      .reverse()
      .map((e) => e.errorCode as string)
      .filter((code, idx, arr) => arr.indexOf(code) === idx)
      .slice(0, 5);

    return { totalCommands, successRate, avgDurationMs, mostUsed, recentErrors };
  } catch {
    return { totalCommands: 0, successRate: 1, avgDurationMs: 0, mostUsed: [], recentErrors: [] };
  }
}

/**
 * Build a markdown DX report suitable for `danteforge quality --dx`.
 * Best-effort: never throws.
 */
export async function getDxReport(cwd: string): Promise<string> {
  try {
    const stats = await getDxStats(cwd);

    const successPct = (stats.successRate * 100).toFixed(1);
    const avgMs = Math.round(stats.avgDurationMs);

    const mostUsedList = stats.mostUsed.length > 0
      ? stats.mostUsed.map((c) => `- \`${c}\``).join('\n')
      : '- (no data yet)';

    const errorList = stats.recentErrors.length > 0
      ? stats.recentErrors.map((c) => `- \`${c}\``).join('\n')
      : '- (no recent errors)';

    return [
      '## DX Telemetry Report',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total commands run | ${stats.totalCommands} |`,
      `| Success rate | ${successPct}% |`,
      `| Avg duration | ${avgMs} ms |`,
      '',
      '### Most-used commands',
      mostUsedList,
      '',
      '### Recent error codes',
      errorList,
      '',
      `> _Telemetry is local-only. Stored in \`${TELEMETRY_FILE}\`._`,
    ].join('\n');
  } catch {
    return '## DX Telemetry Report\n\n_No telemetry data available._';
  }
}
