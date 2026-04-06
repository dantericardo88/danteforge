// PDSE Score Anomaly Detector — tracks score history and flags suspicious jumps
// Pure arithmetic — zero LLM calls, deterministic, zero-cost per cycle.

import path from 'node:path';
import {
  type PdseHistoryEntry,
  type AnomalyFlag,
  PDSE_HISTORY_FILE,
  ANOMALY_THRESHOLD,
  PDSE_HISTORY_WINDOW,
} from './wiki-schema.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ReadFileFn = (filePath: string) => Promise<string>;
export type WriteFileFn = (filePath: string, content: string) => Promise<void>;
export type MkdirFn = (dirPath: string, opts?: { recursive?: boolean }) => Promise<void>;

export interface AppendPdseHistoryOptions {
  cwd?: string;
  _writeFile?: WriteFileFn;
  _readFile?: ReadFileFn;
  _mkdir?: MkdirFn;
}

export interface LoadPdseHistoryOptions {
  cwd?: string;
  _readFile?: ReadFileFn;
  limit?: number;
}

export interface DetectAnomaliesOptions {
  cwd?: string;
  threshold?: number;
  _readFile?: ReadFileFn;
}

// ── Default I/O ───────────────────────────────────────────────────────────────

async function defaultReadFile(filePath: string): Promise<string> {
  const { default: fs } = await import('node:fs/promises');
  return fs.readFile(filePath, 'utf8');
}

async function defaultWriteFile(filePath: string, content: string): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.writeFile(filePath, content, 'utf8');
}

async function defaultMkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.mkdir(dirPath, opts);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolvePdseHistoryPath(cwd?: string): string {
  const base = cwd ?? process.cwd();
  return path.join(base, PDSE_HISTORY_FILE);
}

/**
 * Parse PdseHistoryEntry objects from the pdse-history.md markdown file.
 * Each entry block starts with a `## ` heading containing the artifact name and timestamp.
 */
export function parsePdseHistoryMarkdown(content: string): PdseHistoryEntry[] {
  const entries: PdseHistoryEntry[] = [];
  const blocks = content.split(/^(?=## )/m).filter(b => b.trim().startsWith('## '));

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const headerMatch = lines[0].match(/^## (.+?) \| (.+)$/);
    if (!headerMatch) continue;

    const artifact = headerMatch[1].trim();
    const timestamp = headerMatch[2].trim();

    let score = 0;
    let decision = 'warn';
    const dimensions: Record<string, number> = {};

    for (const line of lines.slice(1)) {
      const scoreMatch = line.match(/^- \*\*Score\*\*:\s*(\d+(?:\.\d+)?)/);
      if (scoreMatch) { score = parseFloat(scoreMatch[1]); continue; }

      const decisionMatch = line.match(/^- \*\*Decision\*\*:\s*(.+)/);
      if (decisionMatch) { decision = decisionMatch[1].trim(); continue; }

      const dimMatch = line.match(/^\s+- ([a-zA-Z]+):\s*(\d+(?:\.\d+)?)/);
      if (dimMatch) { dimensions[dimMatch[1]] = parseFloat(dimMatch[2]); }
    }

    entries.push({ timestamp, artifact, score, dimensions, decision });
  }

  return entries;
}

/**
 * Format a PdseHistoryEntry as a markdown block to append to pdse-history.md.
 */
export function formatPdseHistoryEntry(entry: PdseHistoryEntry): string {
  const dimLines = Object.entries(entry.dimensions)
    .map(([k, v]) => `    - ${k}: ${v}`)
    .join('\n');

  return [
    `## ${entry.artifact} | ${entry.timestamp}`,
    `- **Score**: ${entry.score}`,
    `- **Decision**: ${entry.decision}`,
    dimLines ? `- **Dimensions**:\n${dimLines}` : '',
    '',
  ].filter(l => l !== '').join('\n') + '\n';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append a PDSE score result to the wiki pdse-history.md file.
 * Creates the file and parent directories if they do not exist.
 */
export async function appendPdseHistory(
  entry: PdseHistoryEntry,
  options: AppendPdseHistoryOptions = {},
): Promise<void> {
  const readFile = options._readFile ?? defaultReadFile;
  const writeFile = options._writeFile ?? defaultWriteFile;
  const mkdir = options._mkdir ?? defaultMkdir;

  const historyPath = resolvePdseHistoryPath(options.cwd);
  const dirPath = path.dirname(historyPath);

  await mkdir(dirPath, { recursive: true });

  let existing = '';
  try {
    existing = await readFile(historyPath);
  } catch {
    // File does not exist yet — start fresh with header
    existing = '# PDSE Score History\n\nAuto-maintained by DanteForge wiki engine.\n\n';
  }

  const block = formatPdseHistoryEntry(entry);
  await writeFile(historyPath, existing + block);
}

/**
 * Load the last N PDSE history entries for a specific artifact.
 * Returns entries in chronological order (oldest first).
 */
export async function loadPdseHistory(
  artifact: string,
  options: LoadPdseHistoryOptions = {},
): Promise<PdseHistoryEntry[]> {
  const readFile = options._readFile ?? defaultReadFile;
  const limit = options.limit ?? PDSE_HISTORY_WINDOW;

  const historyPath = resolvePdseHistoryPath(options.cwd);

  let content = '';
  try {
    content = await readFile(historyPath);
  } catch {
    return [];
  }

  const all = parsePdseHistoryMarkdown(content);
  const forArtifact = all.filter(e => e.artifact === artifact);

  // Return most recent N entries (last `limit` in chronological order)
  return forArtifact.slice(-limit);
}

/**
 * Compute trailing moving average and detect if current score is anomalous.
 * Returns an AnomalyFlag if the delta exceeds `threshold`, otherwise null.
 * Requires at least 2 historical entries before flagging (not enough history = no flag).
 */
export async function detectAnomalies(
  artifact: string,
  currentScore: number,
  options: DetectAnomaliesOptions = {},
): Promise<AnomalyFlag | null> {
  const threshold = options.threshold ?? ANOMALY_THRESHOLD;

  const history = await loadPdseHistory(artifact, {
    cwd: options.cwd,
    _readFile: options._readFile,
    limit: PDSE_HISTORY_WINDOW,
  });

  // Need at least 2 prior data points to compute a meaningful average
  if (history.length < 2) return null;

  const avg = history.reduce((sum, e) => sum + e.score, 0) / history.length;
  const delta = currentScore - avg;

  if (Math.abs(delta) < threshold) return null;

  return {
    artifact,
    previousAvg: Math.round(avg * 100) / 100,
    currentScore,
    delta: Math.round(delta * 100) / 100,
    flaggedAt: new Date().toISOString(),
  };
}
