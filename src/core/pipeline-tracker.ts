// Pipeline stage tracker — records pipeline stage events to a JSONL log file
// and provides summary queries.

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineStage =
  | 'specify'
  | 'clarify'
  | 'plan'
  | 'tasks'
  | 'forge'
  | 'verify'
  | 'synthesize'
  | 'ship';

export interface PipelineEntry {
  stage: PipelineStage;
  timestamp: string;  // ISO 8601
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface PipelineStageSummary {
  stage: PipelineStage;
  firstRun: string;   // ISO timestamp
  lastRun: string;    // ISO timestamp
  runCount: number;
}

export interface PipelineSummary {
  /** All stages that have been run at least once, in pipeline order */
  completedStages: PipelineStageSummary[];
  /** Total elapsed wall-clock time from first specify to last event (ms) */
  totalElapsedMs: number | null;
  /** The most recent stage run */
  currentStage: PipelineStage | null;
  /** Next recommended action */
  nextAction: string;
  /** All raw entries (ordered oldest-first) */
  entries: PipelineEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_FILENAME = 'pipeline-log.jsonl';
const STAGE_ORDER: PipelineStage[] = [
  'specify', 'clarify', 'plan', 'tasks', 'forge', 'verify', 'synthesize', 'ship',
];

// ---------------------------------------------------------------------------
// Injection-friendly I/O helpers
// ---------------------------------------------------------------------------

type AppendFn = (p: string, data: string) => Promise<void>;
type ReadFn = (p: string) => Promise<string>;
type MkdirFn = (p: string, opts?: { recursive?: boolean }) => Promise<void>;

function logPath(cwd: string): string {
  return path.join(cwd, '.danteforge', LOG_FILENAME);
}

// ---------------------------------------------------------------------------
// Write a stage entry
// ---------------------------------------------------------------------------

/**
 * Records a pipeline stage event to `.danteforge/pipeline-log.jsonl`.
 * Creates the file (and parent directory) if it does not exist.
 *
 * @param stage     The pipeline stage being recorded
 * @param cwd       Project root directory (defaults to process.cwd())
 * @param _append   Injection seam for writing (for tests)
 * @param _mkdirFn  Injection seam for mkdir (for tests)
 * @param meta      Optional extra metadata to embed in the log entry
 */
export async function recordStage(
  stage: PipelineStage,
  cwd?: string,
  _append?: AppendFn,
  _mkdirFn?: MkdirFn,
  meta?: Record<string, unknown>,
): Promise<void> {
  const dir = cwd ?? process.cwd();
  const filePath = logPath(dir);

  const entry: PipelineEntry = {
    stage,
    timestamp: new Date().toISOString(),
    ...(meta ? { meta } : {}),
  };

  const line = JSON.stringify(entry) + '\n';

  if (_append) {
    // In test mode: use injected append (caller manages dir creation)
    await _append(filePath, line);
    return;
  }

  // Real filesystem: ensure directory exists
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, line, 'utf8');
}

// ---------------------------------------------------------------------------
// Read entries
// ---------------------------------------------------------------------------

/**
 * Reads all pipeline entries from `.danteforge/pipeline-log.jsonl`.
 * Returns an empty array if the file does not exist.
 */
export async function readPipelineEntries(
  cwd?: string,
  _read?: ReadFn,
): Promise<PipelineEntry[]> {
  const dir = cwd ?? process.cwd();
  const filePath = logPath(dir);
  const reader = _read ?? ((p: string) => readFile(p, 'utf8'));

  let raw: string;
  try {
    raw = await reader(filePath);
  } catch {
    return [];
  }

  const entries: PipelineEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as PipelineEntry;
      if (parsed.stage && parsed.timestamp) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Sort oldest-first by timestamp
  entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return entries;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Returns the timestamp of the last recorded event for the given stage,
 * or null if the stage has never been run.
 */
export async function getLastStageTime(
  stage: PipelineStage,
  cwd?: string,
  _read?: ReadFn,
): Promise<Date | null> {
  const entries = await readPipelineEntries(cwd, _read);
  const stageEntries = entries.filter((e) => e.stage === stage);

  if (stageEntries.length === 0) return null;

  const last = stageEntries[stageEntries.length - 1];
  return new Date(last!.timestamp);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function nextActionFor(currentStage: PipelineStage | null, completedSet: Set<PipelineStage>): string {
  if (!currentStage) return 'Run "danteforge specify <idea>" to start the pipeline.';

  const idx = STAGE_ORDER.indexOf(currentStage);
  const nextStage = idx >= 0 && idx < STAGE_ORDER.length - 1
    ? STAGE_ORDER[idx + 1]
    : null;

  if (!nextStage) return 'Pipeline complete. Consider running "danteforge verify" or "danteforge synthesize".';

  if (!completedSet.has(nextStage)) {
    return `Run "danteforge ${nextStage}" to continue the pipeline.`;
  }

  return `Next: "danteforge ${nextStage}" (already completed once — re-run to refresh).`;
}

/**
 * Builds a pipeline summary from all recorded entries.
 *
 * @param cwd   Project root directory
 * @param _read Injection seam for reading
 */
export async function getPipelineSummary(
  cwd?: string,
  _read?: ReadFn,
): Promise<PipelineSummary> {
  const entries = await readPipelineEntries(cwd, _read);

  if (entries.length === 0) {
    return {
      completedStages: [],
      totalElapsedMs: null,
      currentStage: null,
      nextAction: 'Run "danteforge specify <idea>" to start the pipeline.',
      entries: [],
    };
  }

  // Group entries by stage
  const byStage = new Map<PipelineStage, PipelineEntry[]>();
  for (const entry of entries) {
    const list = byStage.get(entry.stage) ?? [];
    list.push(entry);
    byStage.set(entry.stage, list);
  }

  // Build per-stage summaries in pipeline order
  const completedStages: PipelineStageSummary[] = [];
  const completedSet = new Set<PipelineStage>();

  for (const stage of STAGE_ORDER) {
    const stageEntries = byStage.get(stage);
    if (!stageEntries || stageEntries.length === 0) continue;

    completedSet.add(stage);
    completedStages.push({
      stage,
      firstRun: stageEntries[0]!.timestamp,
      lastRun: stageEntries[stageEntries.length - 1]!.timestamp,
      runCount: stageEntries.length,
    });
  }

  // Total elapsed: from first entry to last entry
  const firstTs = entries[0]!.timestamp;
  const lastTs = entries[entries.length - 1]!.timestamp;
  const totalElapsedMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();

  // Current stage = most recently run stage
  const lastEntry = entries[entries.length - 1]!;
  const currentStage = lastEntry.stage;

  return {
    completedStages,
    totalElapsedMs,
    currentStage,
    nextAction: nextActionFor(currentStage, completedSet),
    entries,
  };
}

// ---------------------------------------------------------------------------
// Re-export write helper so callers can import just this module
// ---------------------------------------------------------------------------

/**
 * Re-exported Node.js `fs/promises.writeFile` for callers that only import
 * from this module. Allows replacing the full pipeline log file atomically
 * (e.g. when rewriting on compaction).
 */
export { writeFile as _writeFile };
