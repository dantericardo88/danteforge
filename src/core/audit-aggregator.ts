// audit-aggregator.ts — Aggregate audit events from the state's audit log.
// Pure functions (except formatters which return strings), no I/O.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  timestamp: string;
  action: string;
  actor: string;
  result: 'success' | 'failure' | 'warning';
  details?: Record<string, unknown>;
}

export interface AuditSummary {
  totalEvents: number;
  successRate: number;
  topActions: Array<{ action: string; count: number }>;
  recentFailures: AuditEvent[];
  timeRange: { from: string; to: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RECENT_FAILURE_LIMIT = 5;
const TOP_ACTIONS_LIMIT = 10;

/**
 * Coerce an unknown value to a non-empty string or return a fallback.
 */
function coerceString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}

/**
 * Normalise a raw result field to one of the three allowed literals.
 */
function normaliseResult(raw: unknown): 'success' | 'failure' | 'warning' {
  const s = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (s === 'failure' || s === 'fail' || s === 'error') return 'failure';
  if (s === 'warning' || s === 'warn') return 'warning';
  return 'success';
}

/**
 * Parse a single raw audit log entry (string or object) into an AuditEvent.
 * Returns null if the entry cannot be parsed at all.
 */
function parseEntry(raw: unknown): AuditEvent | null {
  if (raw === null || raw === undefined) return null;

  // Object form — the modern format from the state engine.
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    return {
      timestamp: coerceString(obj['timestamp'], new Date(0).toISOString()),
      action: coerceString(obj['action'], 'unknown'),
      actor: coerceString(obj['actor'] ?? obj['userId'], 'system'),
      result: normaliseResult(obj['result'] ?? obj['status']),
      details:
        typeof obj['details'] === 'object' && obj['details'] !== null
          ? (obj['details'] as Record<string, unknown>)
          : undefined,
    };
  }

  // String form — legacy pipe-delimited or dash-delimited entries.
  if (typeof raw === 'string') {
    const trimmed = raw.trim();

    // "2026-04-01T00:00:00Z | actor | action: result"
    const pipe = trimmed.match(
      /^(\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|:]+?)(?::\s*(.+))?$/,
    );
    if (pipe) {
      return {
        timestamp: pipe[1]!,
        actor: pipe[2]!.trim(),
        action: pipe[3]!.trim(),
        result: normaliseResult(pipe[4]),
      };
    }

    // "2026-04-01T00:00:00Z — action: result"
    const dash = trimmed.match(/^(\S+)\s*[—\-]{1,2}\s*([^:]+?)(?::\s*(.+))?$/);
    if (dash) {
      return {
        timestamp: dash[1]!,
        actor: 'system',
        action: dash[2]!.trim(),
        result: normaliseResult(dash[3]),
      };
    }

    // Bare string — treat as a note.
    return {
      timestamp: new Date().toISOString(),
      actor: 'system',
      action: 'note',
      result: 'success',
      details: { raw: trimmed },
    };
  }

  return null;
}

/**
 * Sort two ISO timestamps chronologically.
 */
function compareTimestamps(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse an array of raw audit log entries (from state.auditLog) into AuditEvent[].
 * Entries that cannot be parsed are silently dropped.
 */
export function parseAuditLog(entries: unknown[]): AuditEvent[] {
  if (!Array.isArray(entries)) return [];
  return entries.map(parseEntry).filter((e): e is AuditEvent => e !== null);
}

/**
 * Compute aggregate statistics over a list of parsed audit events.
 */
export function computeAuditSummary(events: AuditEvent[]): AuditSummary {
  if (events.length === 0) {
    return {
      totalEvents: 0,
      successRate: 0,
      topActions: [],
      recentFailures: [],
      timeRange: null,
    };
  }

  const successCount = events.filter(e => e.result === 'success').length;
  const successRate = Math.round((successCount / events.length) * 10000) / 100;

  // Count actions.
  const actionCounts = new Map<string, number>();
  for (const e of events) {
    actionCounts.set(e.action, (actionCounts.get(e.action) ?? 0) + 1);
  }
  const topActions = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_ACTIONS_LIMIT)
    .map(([action, count]) => ({ action, count }));

  // Recent failures (chronologically latest first).
  const recentFailures = events
    .filter(e => e.result === 'failure')
    .sort((a, b) => compareTimestamps(b.timestamp, a.timestamp))
    .slice(0, RECENT_FAILURE_LIMIT);

  // Time range.
  const sorted = [...events].sort((a, b) => compareTimestamps(a.timestamp, b.timestamp));
  const timeRange =
    sorted.length > 0
      ? { from: sorted[0]!.timestamp, to: sorted[sorted.length - 1]!.timestamp }
      : null;

  return { totalEvents: events.length, successRate, topActions, recentFailures, timeRange };
}

/**
 * Format an audit summary as a Markdown string.
 */
export function formatAuditSummary(summary: AuditSummary): string {
  if (summary.totalEvents === 0) {
    return '## Audit Summary\n\n_No audit events recorded._\n';
  }

  const lines: string[] = [
    '## Audit Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total events | ${summary.totalEvents} |`,
    `| Success rate | ${summary.successRate}% |`,
  ];

  if (summary.timeRange) {
    lines.push(`| From | ${summary.timeRange.from} |`);
    lines.push(`| To   | ${summary.timeRange.to} |`);
  }

  lines.push('', '### Top Actions', '');
  lines.push('| Action | Count |', '|--------|-------|');
  for (const { action, count } of summary.topActions) {
    lines.push(`| ${action} | ${count} |`);
  }

  if (summary.recentFailures.length > 0) {
    lines.push('', '### Recent Failures', '');
    for (const e of summary.recentFailures) {
      lines.push(`- \`${e.timestamp}\` **${e.actor}** → ${e.action}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Filter events by actor (exact match, case-insensitive).
 */
export function filterByActor(events: AuditEvent[], actor: string): AuditEvent[] {
  const lower = actor.toLowerCase();
  return events.filter(e => e.actor.toLowerCase() === lower);
}

/**
 * Filter events whose timestamp falls within [from, to] inclusive (ISO strings).
 * Events with unparseable timestamps are excluded.
 */
export function filterByTimeRange(events: AuditEvent[], from: string, to: string): AuditEvent[] {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (isNaN(fromMs) || isNaN(toMs)) return [];

  return events.filter(e => {
    const ms = new Date(e.timestamp).getTime();
    return !isNaN(ms) && ms >= fromMs && ms <= toMs;
  });
}
