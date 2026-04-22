// Best-model-per-task routing — tracks which LLM model performs best for
// different task types and routes future requests to the highest-performing model.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskType =
  | 'extraction'
  | 'synthesis'
  | 'planning'
  | 'scoring'
  | 'classification'
  | 'generation';

export interface ModelPerformanceEntry {
  model: string;
  taskType: TaskType;
  avgLatencyMs: number;
  avgQualityScore: number; // 0-1, from LLM self-assessment or downstream metric
  totalRuns: number;
  lastUpdatedAt: string;
}

export interface ModelPerformanceIndex {
  version: '1.0.0';
  entries: ModelPerformanceEntry[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Default fallback model used when candidates list is empty
// ---------------------------------------------------------------------------

const DEFAULT_FALLBACK_MODEL = 'claude-sonnet-4-6';
const DEFAULT_QUALITY_SCORE = 0.5;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function getPerformanceIndexPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'model-performance.json');
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/** Reads the performance index from disk. Returns an empty index on any error. */
export async function loadPerformanceIndex(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<ModelPerformanceIndex> {
  const filePath = getPerformanceIndexPath(cwd);
  const reader = _fsRead ?? ((p) => readFile(p, 'utf8'));

  try {
    const raw = await reader(filePath);
    const parsed = JSON.parse(raw) as unknown;
    if (isModelPerformanceIndex(parsed)) {
      return parsed;
    }
  } catch {
    // missing file, invalid JSON, or schema mismatch — return empty index
  }

  return makeEmptyIndex();
}

/** Persists the performance index to disk, creating the directory if needed. */
export async function savePerformanceIndex(
  index: ModelPerformanceIndex,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const filePath = getPerformanceIndexPath(cwd);
  const writer = _fsWrite ?? ((p, d) => writeFile(p, d, 'utf8'));

  if (!_fsWrite) {
    // Only create dir when using real fs — injection callers manage their own dirs
    await mkdir(path.dirname(filePath), { recursive: true });
  }

  await writer(filePath, JSON.stringify(index, null, 2));
}

// ---------------------------------------------------------------------------
// Record a run — updates running averages
// ---------------------------------------------------------------------------

/**
 * Records the outcome of a model run and updates the performance index.
 *
 * Running average formula:
 *   avgLatencyMs   = (existing.avgLatencyMs   * n + latencyMs)   / (n + 1)
 *   avgQualityScore = (existing.avgQualityScore * n + qualityScore) / (n + 1)
 */
export async function recordModelRun(
  model: string,
  taskType: TaskType,
  latencyMs: number,
  qualityScore: number,
  cwd?: string,
  opts?: {
    _fsRead?: (p: string) => Promise<string>;
    _fsWrite?: (p: string, d: string) => Promise<void>;
  },
): Promise<void> {
  const index = await loadPerformanceIndex(cwd, opts?._fsRead);

  const existing = index.entries.find(
    (e) => e.model === model && e.taskType === taskType,
  );

  const now = new Date().toISOString();

  if (existing) {
    const n = existing.totalRuns;
    existing.avgLatencyMs = (existing.avgLatencyMs * n + latencyMs) / (n + 1);
    existing.avgQualityScore =
      (existing.avgQualityScore * n + qualityScore) / (n + 1);
    existing.totalRuns = n + 1;
    existing.lastUpdatedAt = now;
  } else {
    index.entries.push({
      model,
      taskType,
      avgLatencyMs: latencyMs,
      avgQualityScore: qualityScore,
      totalRuns: 1,
      lastUpdatedAt: now,
    });
  }

  index.updatedAt = now;

  await savePerformanceIndex(index, cwd, opts?._fsWrite);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Returns the candidate model with the highest avgQualityScore for the given
 * taskType. If no performance history exists for a candidate, assigns a default
 * score of 0.5. Ties broken by lowest avgLatencyMs.
 *
 * If candidates is empty, returns 'claude-sonnet-4-6'.
 */
export function selectBestModel(
  taskType: TaskType,
  candidates: string[],
  index: ModelPerformanceIndex,
): string {
  if (candidates.length === 0) {
    return DEFAULT_FALLBACK_MODEL;
  }

  const taskEntries = index.entries.filter((e) => e.taskType === taskType);

  interface Scored {
    model: string;
    qualityScore: number;
    latencyMs: number;
  }

  const scored: Scored[] = candidates.map((model) => {
    const entry = taskEntries.find((e) => e.model === model);
    return {
      model,
      qualityScore: entry?.avgQualityScore ?? DEFAULT_QUALITY_SCORE,
      latencyMs: entry?.avgLatencyMs ?? Number.MAX_SAFE_INTEGER,
    };
  });

  scored.sort((a, b) => {
    const qualityDiff = b.qualityScore - a.qualityScore;
    if (qualityDiff !== 0) return qualityDiff;
    // Tie-break: prefer lower latency
    return a.latencyMs - b.latencyMs;
  });

  return scored[0].model;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Returns all performance entries for the given taskType sorted by
 * avgQualityScore descending.
 */
export function getModelRanking(
  taskType: TaskType,
  index: ModelPerformanceIndex,
): ModelPerformanceEntry[] {
  return index.entries
    .filter((e) => e.taskType === taskType)
    .slice()
    .sort((a, b) => {
      const qualityDiff = b.avgQualityScore - a.avgQualityScore;
      if (qualityDiff !== 0) return qualityDiff;
      return a.avgLatencyMs - b.avgLatencyMs;
    });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeEmptyIndex(): ModelPerformanceIndex {
  return {
    version: '1.0.0',
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}

function isModelPerformanceIndex(value: unknown): value is ModelPerformanceIndex {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['version'] === '1.0.0' &&
    Array.isArray(v['entries']) &&
    typeof v['updatedAt'] === 'string'
  );
}
