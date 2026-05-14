// lesson-impact-tracker.ts — Track whether applied lessons actually improve scores.
// Stores impacts in .danteforge/lesson-impacts.jsonl (one JSON per line).
// Pure async functions with injection seams for testing.

import fs from 'fs/promises';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LessonImpact {
  lessonId: string;
  lessonText: string;
  appliedAt: string;         // ISO date
  scoreBeforeApply: number;
  scoreAfterApply: number | null; // null until measured
  dimensionId: string;
  improvement: number | null;     // scoreAfterApply - scoreBeforeApply
}

export interface ImpactReport {
  totalLessons: number;
  measuredLessons: number;
  avgImprovement: number | null;
  topLessons: LessonImpact[];    // top 5 by improvement
  staleLessons: LessonImpact[];  // applied > 7 days ago, not yet measured
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IMPACTS_FILE = 'lesson-impacts.jsonl';
const STALE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function impactsPath(cwd: string): string {
  return path.join(cwd, '.danteforge', IMPACTS_FILE);
}

/**
 * Read all lesson impacts from the JSONL file.
 * Returns empty array if file doesn't exist or is malformed.
 */
async function readImpacts(
  cwd: string,
  _readFile?: (p: string) => Promise<string>,
): Promise<LessonImpact[]> {
  const readFn = _readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await readFn(impactsPath(cwd));
    return raw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        try {
          return JSON.parse(line) as LessonImpact;
        } catch {
          return null;
        }
      })
      .filter((item): item is LessonImpact => item !== null);
  } catch {
    return [];
  }
}

/**
 * Write all lesson impacts back to the JSONL file.
 */
async function writeImpacts(
  cwd: string,
  impacts: LessonImpact[],
  _writeFile?: (p: string, data: string) => Promise<void>,
): Promise<void> {
  const dir = path.join(cwd, '.danteforge');
  const writeFn = _writeFile ?? ((p: string, data: string) => fs.writeFile(p, data, 'utf8'));
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch { /* already exists */ }
  const content = impacts.map(i => JSON.stringify(i)).join('\n') + (impacts.length > 0 ? '\n' : '');
  await writeFn(impactsPath(cwd), content);
}

/**
 * Compute improvement field from raw impact.
 */
function withImprovement(impact: LessonImpact): LessonImpact {
  return {
    ...impact,
    improvement:
      impact.scoreAfterApply !== null
        ? Math.round((impact.scoreAfterApply - impact.scoreBeforeApply) * 1000) / 1000
        : null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a new lesson application. Appends one entry to the JSONL file.
 *
 * The `improvement` field is computed automatically from `scoreBeforeApply`
 * and `scoreAfterApply` (set to `null` when `scoreAfterApply` is not yet known).
 *
 * @param cwd     - Project root directory containing `.danteforge/`.
 * @param impact  - Lesson application details (all fields except `improvement`,
 *   which is derived automatically). `scoreAfterApply` may be `null` when the
 *   outcome has not been measured yet.
 * @param options - Optional injection seams:
 *   - `_readFile` — override file reading for testing
 *   - `_writeFile` — override file writing for testing
 *   - `_now` — override `Date.now()` for deterministic timestamps in tests
 */
export async function recordLessonApplication(
  cwd: string,
  impact: Omit<LessonImpact, 'improvement'>,
  options: {
    _readFile?: (p: string) => Promise<string>;
    _writeFile?: (p: string, data: string) => Promise<void>;
    _now?: () => number;
  } = {},
): Promise<void> {
  const existing = await readImpacts(cwd, options._readFile);
  const newImpact: LessonImpact = withImprovement({
    ...impact,
    scoreAfterApply: impact.scoreAfterApply ?? null,
    improvement: null,
  });
  existing.push(newImpact);
  await writeImpacts(cwd, existing, options._writeFile);
}

/**
 * Update an existing impact entry with a measured score outcome.
 *
 * Finds the most-recent entry matching `lessonId` and sets its
 * `scoreAfterApply` and re-computes `improvement`. If no matching entry
 * exists the call is a no-op (silently skipped).
 *
 * @param cwd        - Project root directory.
 * @param lessonId   - Identifier of the lesson to update.
 * @param scoreAfter - The score measured after the lesson was applied (0–10).
 * @param options    - Optional injection seams for `_readFile` / `_writeFile`.
 */
export async function measureLessonOutcome(
  cwd: string,
  lessonId: string,
  scoreAfter: number,
  options: {
    _readFile?: (p: string) => Promise<string>;
    _writeFile?: (p: string, data: string) => Promise<void>;
  } = {},
): Promise<void> {
  const impacts = await readImpacts(cwd, options._readFile);

  // Find the last entry matching the lessonId (most recent application).
  let targetIdx = -1;
  for (let i = impacts.length - 1; i >= 0; i--) {
    if (impacts[i]!.lessonId === lessonId) {
      targetIdx = i;
      break;
    }
  }

  if (targetIdx === -1) return; // lesson not found — silently skip

  impacts[targetIdx] = withImprovement({
    ...impacts[targetIdx]!,
    scoreAfterApply: scoreAfter,
  });

  await writeImpacts(cwd, impacts, options._writeFile);
}

/**
 * Compute an impact report over all recorded lesson applications.
 *
 * Aggregates metrics from the JSONL file:
 * - `totalLessons` — all recorded applications
 * - `measuredLessons` — applications where `scoreAfterApply` is set
 * - `avgImprovement` — mean delta for measured lessons (null if none)
 * - `topLessons` — top 5 by improvement delta
 * - `staleLessons` — applied > 7 days ago but not yet measured
 *
 * @param cwd     - Project root directory.
 * @param options - Optional injection seams:
 *   - `_readFile` — override file reading for testing
 *   - `_now` — override `Date.now()` for deterministic stale-detection in tests
 * @returns An `ImpactReport` with aggregated metrics and ranked lesson lists.
 */
export async function computeImpactReport(
  cwd: string,
  options: {
    _readFile?: (p: string) => Promise<string>;
    _now?: () => number;
  } = {},
): Promise<ImpactReport> {
  const nowMs = (options._now ?? (() => Date.now()))();
  const impacts = await readImpacts(cwd, options._readFile);

  const measured = impacts.filter(i => i.scoreAfterApply !== null && i.improvement !== null);

  let avgImprovement: number | null = null;
  if (measured.length > 0) {
    const sum = measured.reduce((acc, i) => acc + (i.improvement ?? 0), 0);
    avgImprovement = Math.round((sum / measured.length) * 1000) / 1000;
  }

  const topLessons = [...measured]
    .sort((a, b) => (b.improvement ?? 0) - (a.improvement ?? 0))
    .slice(0, 5);

  const staleLessons = impacts.filter(i => {
    if (i.scoreAfterApply !== null) return false; // already measured
    const appliedMs = new Date(i.appliedAt).getTime();
    return !isNaN(appliedMs) && nowMs - appliedMs > STALE_DAYS * MS_PER_DAY;
  });

  return {
    totalLessons: impacts.length,
    measuredLessons: measured.length,
    avgImprovement,
    topLessons,
    staleLessons,
  };
}

/**
 * Format an `ImpactReport` as a Markdown string.
 *
 * Renders a summary table, a top-lessons leaderboard, and a stale-lessons
 * section. Suitable for printing to the terminal or embedding in PRIME.md.
 *
 * @param report - The impact report to render (from `computeImpactReport`).
 * @returns Markdown string with `##` section headers and pipe tables.
 */
export function formatImpactReport(report: ImpactReport): string {
  const lines: string[] = [
    '## Lesson Impact Report',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total lessons applied | ${report.totalLessons} |`,
    `| Measured lessons | ${report.measuredLessons} |`,
    `| Avg improvement | ${report.avgImprovement !== null ? report.avgImprovement.toFixed(3) : '—'} |`,
  ];

  if (report.topLessons.length > 0) {
    lines.push('', '### Top Lessons by Impact', '');
    lines.push('| Lesson | Dimension | Before | After | Delta |');
    lines.push('|--------|-----------|--------|-------|-------|');
    for (const l of report.topLessons) {
      const text = l.lessonText.length > 60 ? l.lessonText.slice(0, 57) + '...' : l.lessonText;
      lines.push(
        `| ${text} | ${l.dimensionId} | ${l.scoreBeforeApply.toFixed(1)} | ${(l.scoreAfterApply ?? 0).toFixed(1)} | +${(l.improvement ?? 0).toFixed(3)} |`,
      );
    }
  }

  if (report.staleLessons.length > 0) {
    lines.push('', '### Stale Lessons (>7 days, not yet measured)', '');
    for (const l of report.staleLessons) {
      const text = l.lessonText.length > 80 ? l.lessonText.slice(0, 77) + '...' : l.lessonText;
      lines.push(`- \`${l.lessonId}\` [${l.dimensionId}] applied ${l.appliedAt.slice(0, 10)}: ${text}`);
    }
  }

  if (report.totalLessons === 0) {
    lines.push('', '_No lesson applications recorded yet._');
  }

  lines.push('');
  return lines.join('\n');
}
