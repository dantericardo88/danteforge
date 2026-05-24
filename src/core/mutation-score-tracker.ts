// mutation-score-tracker.ts — Track mutation testing results in JSONL format.
// Provides recording, aggregation, and formatting utilities for mutation scores.
import path from 'node:path';
import fs from 'node:fs/promises';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MutationScoreRecord {
  /** Source file that was mutation-tested (relative to project root) */
  file: string;
  /** Mutation score as a percentage 0–100 */
  score: number;
  /** Number of mutants killed by existing tests */
  mutantsKilled: number;
  /** Total mutants generated */
  mutantsTotal: number;
  /** ISO date string of when the test was run */
  date: string;
}

export interface MutationSummary {
  /** Average mutation score across all files */
  avgScore: number;
  /** Lowest mutation score across all files */
  minScore: number;
  /** File with the lowest mutation score */
  weakestFile: string;
  /** ISO date of the most recent mutation run */
  dateOfLastRun: string;
  /** Total number of records */
  recordCount: number;
  /** Total mutants across all records */
  totalMutants: number;
  /** Total mutants killed across all records */
  totalKilled: number;
}

// ── Injection seams ───────────────────────────────────────────────────────────

export type AppendFn = (filePath: string, line: string) => Promise<void>;
export type ReadFn = (filePath: string) => Promise<string>;
export type MkdirFn = (p: string, opts?: { recursive?: boolean }) => Promise<void>;

// ── Constants ─────────────────────────────────────────────────────────────────

export const MUTATION_SCORES_FILENAME = 'mutation-scores.jsonl';

export function mutationScoresPath(cwd: string): string {
  return path.join(cwd, '.danteforge', MUTATION_SCORES_FILENAME);
}

// ── recordMutationScore ───────────────────────────────────────────────────────

/**
 * Append a mutation score record to `.danteforge/mutation-scores.jsonl`.
 *
 * @param record  The mutation score record to persist.
 * @param cwd     Project root (defaults to `process.cwd()`).
 * @param _append Injectable file-append function (for testing).
 * @param _mkdir  Injectable mkdir function (for testing).
 */
export async function recordMutationScore(
  record: MutationScoreRecord,
  cwd = process.cwd(),
  _append?: AppendFn,
  _mkdir?: MkdirFn,
): Promise<void> {
  const append: AppendFn = _append ?? (async (filePath, line) => {
    await fs.appendFile(filePath, line + '\n', 'utf8');
  });
  const mkdir: MkdirFn = _mkdir ?? (async (p, opts) => {
    await fs.mkdir(p, opts);
  });

  const filePath = mutationScoresPath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await append(filePath, JSON.stringify(record));
}

// ── getMutationSummary ────────────────────────────────────────────────────────

/**
 * Aggregate all mutation score records into a `MutationSummary`.
 *
 * Returns a zero-record summary when the file does not exist or is empty.
 *
 * @param cwd    Project root (defaults to `process.cwd()`).
 * @param _read  Injectable file-read function (for testing).
 */
export async function getMutationSummary(
  cwd = process.cwd(),
  _read?: ReadFn,
): Promise<MutationSummary> {
  const readFile: ReadFn = _read ?? ((p) => fs.readFile(p, 'utf8'));

  const filePath = mutationScoresPath(cwd);
  let raw: string;
  try {
    raw = await readFile(filePath);
  } catch {
    return emptyMutationSummary();
  }

  const records: MutationScoreRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as MutationScoreRecord);
    } catch {
      // skip corrupt lines
    }
  }

  if (records.length === 0) return emptyMutationSummary();

  return aggregateRecords(records);
}

function emptyMutationSummary(): MutationSummary {
  return {
    avgScore: 0,
    minScore: 0,
    weakestFile: '',
    dateOfLastRun: '',
    recordCount: 0,
    totalMutants: 0,
    totalKilled: 0,
  };
}

function aggregateRecords(records: MutationScoreRecord[]): MutationSummary {
  let scoreSum = 0;
  let minScore = Infinity;
  let weakestFile = '';
  let dateOfLastRun = '';
  let totalMutants = 0;
  let totalKilled = 0;

  for (const r of records) {
    scoreSum += r.score;
    if (r.score < minScore) {
      minScore = r.score;
      weakestFile = r.file;
    }
    if (!dateOfLastRun || r.date > dateOfLastRun) {
      dateOfLastRun = r.date;
    }
    totalMutants += r.mutantsTotal;
    totalKilled += r.mutantsKilled;
  }

  return {
    avgScore: scoreSum / records.length,
    minScore: minScore === Infinity ? 0 : minScore,
    weakestFile,
    dateOfLastRun,
    recordCount: records.length,
    totalMutants,
    totalKilled,
  };
}

// ── formatMutationReport ──────────────────────────────────────────────────────

/**
 * Format a `MutationSummary` as a Markdown table for display.
 */
export function formatMutationReport(summary: MutationSummary): string {
  if (summary.recordCount === 0) {
    return '## Mutation Score Report\n\n_No mutation test results found._\n';
  }

  const lines: string[] = [
    '## Mutation Score Report',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Records | ${summary.recordCount} |`,
    `| Avg Score | ${summary.avgScore.toFixed(1)}% |`,
    `| Min Score | ${summary.minScore.toFixed(1)}% |`,
    `| Weakest File | \`${summary.weakestFile}\` |`,
    `| Total Mutants | ${summary.totalMutants} |`,
    `| Total Killed | ${summary.totalKilled} |`,
    `| Last Run | ${summary.dateOfLastRun} |`,
    '',
  ];

  return lines.join('\n');
}
