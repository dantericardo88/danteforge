// improvement-velocity.ts — Track improvement velocity across sprints.
// Pure functions, no I/O.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprintEntry {
  dimension: string;
  before: number;
  after: number;
  date: string;   // ISO date string
  commit?: string;
}

export interface VelocityReport {
  totalSprints: number;
  totalDeltaPoints: number;
  avgDeltaPerSprint: number;
  fastestDimension: string;
  stalledDimensions: string[]; // no improvement in last 3 sprints
  projectedCompletion?: string; // ISO date if on track for target
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_TARGET = 9.0;
const STALL_WINDOW = 3; // number of most-recent sprints to examine per dimension
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Group sprint entries by dimension, preserving insertion order (chronological).
 */
function groupByDimension(sprints: SprintEntry[]): Map<string, SprintEntry[]> {
  const map = new Map<string, SprintEntry[]>();
  for (const s of sprints) {
    const list = map.get(s.dimension) ?? [];
    list.push(s);
    map.set(s.dimension, list);
  }
  return map;
}

/**
 * Parse an ISO date string and return a Date. Returns null if unparseable.
 */
function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Return the dimension with the highest total delta across all sprints.
 * Falls back to empty string when sprints is empty.
 */
function findFastestDimension(byDim: Map<string, SprintEntry[]>): string {
  let best = '';
  let bestDelta = -Infinity;
  for (const [dim, entries] of byDim) {
    const total = entries.reduce((acc, e) => acc + (e.after - e.before), 0);
    if (total > bestDelta) {
      bestDelta = total;
      best = dim;
    }
  }
  return best;
}

/**
 * Return dimensions that showed zero net improvement in their last `STALL_WINDOW` sprints.
 */
function findStalledDimensions(byDim: Map<string, SprintEntry[]>): string[] {
  const stalled: string[] = [];
  for (const [dim, entries] of byDim) {
    if (entries.length < STALL_WINDOW) continue;
    const recent = entries.slice(-STALL_WINDOW);
    const windowDelta = recent.reduce((acc, e) => acc + (e.after - e.before), 0);
    if (windowDelta <= 0) stalled.push(dim);
  }
  return stalled;
}

/**
 * Project a completion date given the current score, target, and average daily rate.
 * Returns undefined when the rate is non-positive or the target is already met.
 */
function projectCompletion(
  latestScore: number,
  target: number,
  avgDeltaPerSprint: number,
  sprints: SprintEntry[],
): string | undefined {
  if (avgDeltaPerSprint <= 0 || latestScore >= target) return undefined;

  // Derive average days between sprints to convert delta/sprint → delta/day.
  const dates = sprints
    .map(s => safeDate(s.date))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) return undefined;

  const spanMs = dates[dates.length - 1]!.getTime() - dates[0]!.getTime();
  const avgDaysPerSprint = spanMs / MILLISECONDS_PER_DAY / Math.max(1, sprints.length - 1);
  if (avgDaysPerSprint <= 0) return undefined;

  const deltaPerDay = avgDeltaPerSprint / avgDaysPerSprint;
  const remaining = target - latestScore;
  const daysNeeded = remaining / deltaPerDay;

  const completionDate = new Date(Date.now() + daysNeeded * MILLISECONDS_PER_DAY);
  return completionDate.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a velocity report from a list of sprint entries.
 *
 * @param sprints - Sprint entries in any order (will be sorted internally).
 * @param target  - Score target for projection (default 9.0).
 */
export function computeVelocityReport(
  sprints: SprintEntry[],
  target: number = DEFAULT_TARGET,
): VelocityReport {
  if (sprints.length === 0) {
    return {
      totalSprints: 0,
      totalDeltaPoints: 0,
      avgDeltaPerSprint: 0,
      fastestDimension: '',
      stalledDimensions: [],
    };
  }

  const totalDelta = sprints.reduce((acc, s) => acc + (s.after - s.before), 0);
  const avgDelta = Math.round((totalDelta / sprints.length) * 1000) / 1000;

  const byDim = groupByDimension(sprints);
  const fastestDimension = findFastestDimension(byDim);
  const stalledDimensions = findStalledDimensions(byDim);

  // Use the most recent sprint's `after` value as the current score baseline.
  const sorted = [...sprints].sort((a, b) => {
    const da = safeDate(a.date)?.getTime() ?? 0;
    const db = safeDate(b.date)?.getTime() ?? 0;
    return da - db;
  });
  const latestScore = sorted[sorted.length - 1]!.after;

  const projectedCompletion = projectCompletion(latestScore, target, avgDelta, sprints);

  return {
    totalSprints: sprints.length,
    totalDeltaPoints: Math.round(totalDelta * 1000) / 1000,
    avgDeltaPerSprint: avgDelta,
    fastestDimension,
    stalledDimensions,
    projectedCompletion,
  };
}

/**
 * Format a velocity report as a Markdown string.
 */
export function formatVelocityReport(report: VelocityReport): string {
  const lines: string[] = [
    '## Improvement Velocity Report',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total sprints | ${report.totalSprints} |`,
    `| Total delta points | ${report.totalDeltaPoints.toFixed(3)} |`,
    `| Avg delta / sprint | ${report.avgDeltaPerSprint.toFixed(3)} |`,
    `| Fastest dimension | ${report.fastestDimension || '—'} |`,
  ];

  if (report.stalledDimensions.length > 0) {
    lines.push(`| Stalled dimensions | ${report.stalledDimensions.join(', ')} |`);
  } else {
    lines.push(`| Stalled dimensions | none |`);
  }

  if (report.projectedCompletion) {
    lines.push(`| Projected completion | ${report.projectedCompletion} |`);
  }

  lines.push('');

  if (report.stalledDimensions.length > 0) {
    lines.push(
      '> **Warning:** The following dimensions have shown no improvement in the last 3 sprints: ' +
        report.stalledDimensions.map(d => `\`${d}\``).join(', ') +
        '.',
    );
  }

  return lines.join('\n');
}
