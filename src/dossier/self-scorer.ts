// src/dossier/self-scorer.ts — Scores DanteForge itself using source files as evidence
// Includes historicalAccuracy tracking: each build compares the prior dossier's composite
// score against the actual score achieved, building a calibration signal over time.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dossier, DossierDimension, EvidenceItem, RubricDimension } from './types.js';
import type { ExtractorDeps } from './extractor.js';
import type { ScorerDeps } from './scorer.js';
import type { Rubric } from './types.js';

export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type WriteFileFn = (p: string, d: string) => Promise<void>;
export type MkdirFn = (p: string, opts: { recursive: boolean }) => Promise<unknown>;
export type GlobFn = (pattern: string, opts: { cwd: string }) => Promise<string[]>;
export type GetRubricFn = (cwd: string) => Promise<Rubric>;

/**
 * Tracks whether a dossier's composite score prediction was accurate.
 * Written to `.danteforge/dossiers/history/<id>/accuracy.jsonl`.
 * Used to calibrate future self-scoring and detect scoring drift.
 */
export interface HistoricalAccuracyRecord {
  /** ISO timestamp of this measurement. */
  measuredAt: string;
  /** Composite score from the *previous* dossier build (the prediction). */
  predictedScore: number;
  /** Composite score from the *current* dossier build (the ground truth). */
  actualScore: number;
  /** Absolute delta: actual - predicted. Positive = improvement. */
  delta: number;
  /** Number of dossier builds observed so far (including this one). */
  buildCount: number;
  /** Rolling mean absolute error across all observed deltas. */
  meanAbsoluteError: number;
}

export type SelfExtractEvidenceFn = (
  fileContent: string,
  filePath: string,
  dim: number,
  dimDef: RubricDimension,
  deps?: ExtractorDeps,
) => Promise<EvidenceItem[]>;

export type ScoreDimensionFn = (
  evidence: EvidenceItem[],
  dim: number,
  dimDef: RubricDimension,
  competitor: string,
  deps?: ScorerDeps,
) => Promise<{ score: number; justification: string }>;

export interface SelfScorerOptions {
  cwd: string;
  competitorId?: string;      // default: "dantescode"
  displayName?: string;       // default: project name from package.json
  sourceGlob?: string[];      // files to read; defaults to key src/ patterns
  // Injection seams
  _readFile?: ReadFileFn;
  _writeFile?: WriteFileFn;
  _mkdir?: MkdirFn;
  _glob?: GlobFn;
  _loadRubric?: GetRubricFn;
  _extractEvidence?: SelfExtractEvidenceFn;
  _scoreDimension?: ScoreDimensionFn;
}

const DEFAULT_SELF_COMPETITOR_ID = 'dantescode';
const DEFAULT_SOURCE_PATTERNS = [
  'src/core/*.ts',
  'src/cli/commands/*.ts',
  'src/dossier/*.ts',
];

// Key source files to read for self-scoring (bounded set)
const KEY_SOURCE_FILES = [
  'src/core/ascend-engine.ts',
  'src/core/autoforge-loop.ts',
  'src/core/llm.ts',
  'src/core/llm-stream.ts',
  'src/core/mcp-server.ts',
  'src/core/harsh-scorer.ts',
  'src/core/compete-matrix.ts',
  'src/core/circuit-breaker.ts',
  'src/core/state.ts',
  'src/cli/commands/forge.ts',
  'src/cli/commands/ascend.ts',
  'src/cli/commands/go.ts',
  'src/cli/commands/score.ts',
  'src/cli/commands/assess.ts',
  'src/dossier/builder.ts',
  'src/dossier/landscape.ts',
];

function buildCodeExtractionPrompt(
  dim: number,
  dimDef: RubricDimension,
  filePath: string,
  fileContent: string,
): string {
  const criteriaBlock = Object.entries(dimDef.scoreCriteria)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([score, criteria]) =>
      `Score ${score}: ${(criteria as string[]).join(' | ')}`,
    )
    .join('\n');

  return (
    `You are extracting evidence of a software feature from TypeScript source code.\n\n` +
    `DIMENSION: ${dim} — ${dimDef.name}\n` +
    `SCORING CRITERIA:\n${criteriaBlock}\n\n` +
    `SOURCE FILE: ${filePath}\n` +
    `FILE CONTENT:\n${fileContent.slice(0, 3000)}\n\n` +
    `Task: Find all evidence in this file that is relevant to the dimension above.\n` +
    `Evidence items must reference real code in the file: function signatures, doc comments, variable names, etc.\n\n` +
    `For each piece of evidence:\n` +
    `1. State the specific claim (one sentence)\n` +
    `2. Quote the exact relevant line(s) from the file (e.g. function signature or comment)\n` +
    `3. Use source format: "${filePath}#<functionOrSymbolName>"\n\n` +
    `If no relevant evidence exists in this file, return an empty array.\n\n` +
    `Return JSON only:\n` +
    `[{"claim":"...","quote":"...","source":"${filePath}#symbolName"}]`
  );
}

async function selfExtractEvidence(
  fileContent: string,
  filePath: string,
  dim: number,
  dimDef: RubricDimension,
  deps: ExtractorDeps = {},
): Promise<EvidenceItem[]> {
  const { parseEvidenceItems } = await import('./extractor.js');

  async function defaultLLMCaller(prompt: string): Promise<string> {
    const { callLLM } = await import('../core/llm.js');
    return callLLM(prompt, 'claude' as never);
  }

  const callLLM = deps._callLLM ?? defaultLLMCaller;
  const prompt = buildCodeExtractionPrompt(dim, dimDef, filePath, fileContent);

  let raw: string;
  try {
    raw = await callLLM(prompt);
  } catch {
    return [];
  }

  const items = parseEvidenceItems(raw, dim, filePath);
  return items;
}

function dossierDir(cwd: string): string {
  return path.join(cwd, '.danteforge', 'dossiers');
}

function dossierPath(cwd: string, id: string): string {
  return path.join(dossierDir(cwd), `${id}.json`);
}

function dossierHistoryDir(cwd: string, id: string): string {
  return path.join(dossierDir(cwd), 'history', id);
}

function dossierSnapshotPath(cwd: string, id: string, lastBuilt: string): string {
  return path.join(dossierHistoryDir(cwd, id), `${lastBuilt.replace(/[:.]/g, '-')}.json`);
}

async function loadExistingDossier(
  cwd: string,
  id: string,
  readFileFn: ReadFileFn,
): Promise<Dossier | null> {
  try {
    const raw = await readFileFn(dossierPath(cwd, id), 'utf8');
    return JSON.parse(raw) as Dossier;
  } catch {
    return null;
  }
}

function computeComposite(dimensions: Record<string, DossierDimension>): number {
  const scores = Object.values(dimensions).map((d) => d.humanOverride ?? d.score);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

async function buildDossierDimensions(
  dimEntries: Array<[string, RubricDimension]>,
  fileContents: Array<{ filePath: string; content: string }>,
  extractEvidenceFn: SelfExtractEvidenceFn,
  scoreDimensionFn: ScoreDimensionFn,
  displayName: string,
): Promise<Record<string, DossierDimension>> {
  const dimensions: Record<string, DossierDimension> = {};
  for (const [dimKey, dimDef] of dimEntries) {
    const dimNum = parseInt(dimKey, 10);
    let allEvidence: EvidenceItem[] = [];
    for (const { filePath, content } of fileContents) {
      const evidence = await extractEvidenceFn(content, filePath, dimNum, dimDef);
      allEvidence = allEvidence.concat(evidence);
    }
    const { score, justification } = await scoreDimensionFn(allEvidence, dimNum, dimDef, displayName);
    const unverified = allEvidence.length === 0 ||
      allEvidence.every((e) => !e.quote || e.quote.trim() === '');
    dimensions[dimKey] = {
      score,
      scoreJustification: justification,
      evidence: allEvidence,
      humanOverride: null,
      humanOverrideReason: null,
      unverified,
    };
  }
  return dimensions;
}

// ── Historical Accuracy Tracking ───────────────────────────────────────────────

function accuracyLogPath(cwd: string, id: string): string {
  return path.join(dossierHistoryDir(cwd, id), 'accuracy.jsonl');
}

/**
 * Load all prior accuracy records for a competitor dossier.
 * Returns [] if none exist yet.
 */
export async function loadAccuracyLog(
  cwd: string,
  id: string,
  readFileFn: ReadFileFn = (p, e) => fs.readFile(p, e as BufferEncoding),
): Promise<HistoricalAccuracyRecord[]> {
  const logPath = accuracyLogPath(cwd, id);
  let raw: string;
  try {
    raw = await readFileFn(logPath, 'utf8');
  } catch {
    return [];
  }
  const records: HistoricalAccuracyRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as HistoricalAccuracyRecord);
    } catch { /* skip malformed lines */ }
  }
  return records;
}

/**
 * Append a new accuracy record to the log and return it.
 * The MAE is computed over all records including the new one.
 */
export async function appendAccuracyRecord(
  cwd: string,
  id: string,
  predictedScore: number,
  actualScore: number,
  mkdirFn: MkdirFn,
  writeFileFn: WriteFileFn,
  readFileFn: ReadFileFn,
): Promise<HistoricalAccuracyRecord> {
  const priorRecords = await loadAccuracyLog(cwd, id, readFileFn);
  const delta = actualScore - predictedScore;
  const allDeltas = [...priorRecords.map(r => Math.abs(r.delta)), Math.abs(delta)];
  const meanAbsoluteError = allDeltas.reduce((s, d) => s + d, 0) / allDeltas.length;

  const record: HistoricalAccuracyRecord = {
    measuredAt: new Date().toISOString(),
    predictedScore,
    actualScore,
    delta,
    buildCount: priorRecords.length + 1,
    meanAbsoluteError: Math.round(meanAbsoluteError * 1000) / 1000,
  };

  const logPath = accuracyLogPath(cwd, id);
  await mkdirFn(path.dirname(logPath), { recursive: true });
  // Append as JSONL (read existing + append)
  let existing = '';
  try {
    existing = await readFileFn(logPath, 'utf8');
  } catch { /* first entry */ }
  const newContent = (existing ? existing.trimEnd() + '\n' : '') + JSON.stringify(record) + '\n';
  await writeFileFn(logPath, newContent);

  return record;
}

// ── Calibration score ──────────────────────────────────────────────────────────

/**
 * Summary of historical scoring accuracy computed from JSONL records.
 */
export interface CalibrationSummary {
  /** Competitor / dossier id the records belong to. */
  competitorId: string;
  /** Total number of accuracy records observed. */
  totalBuilds: number;
  /** Mean absolute error across all observed deltas (lower is better). */
  meanAbsoluteError: number;
  /** Median absolute error. */
  medianAbsoluteError: number;
  /**
   * Calibration confidence on a 0–1 scale.
   * Defined as max(0, 1 - MAE/5) so a MAE of 0 = perfect (1.0)
   * and a MAE of 5 or above = no confidence (0.0).
   */
  confidence: number;
  /** Positive if we consistently under-predict; negative if we over-predict. */
  meanBias: number;
  /** The most recent accuracy record, or null if no records exist. */
  latestRecord: HistoricalAccuracyRecord | null;
}

/**
 * Compute calibration statistics from the historical accuracy JSONL log.
 *
 * This gives the autonomous quality loop a quantitative signal for how well
 * DanteForge's self-scoring predictions match actual outcomes over time,
 * enabling adaptive confidence weighting and drift detection.
 *
 * @param cwd  Project root (where `.danteforge/` lives).
 * @param id   Competitor / dossier identifier (default: "dantescode").
 * @param readFileFn  Optional injection seam for testing.
 */
export async function calibrationScore(
  cwd: string,
  id: string = DEFAULT_SELF_COMPETITOR_ID,
  readFileFn: ReadFileFn = (p, e) => fs.readFile(p, e as BufferEncoding),
): Promise<CalibrationSummary> {
  const records = await loadAccuracyLog(cwd, id, readFileFn);

  if (records.length === 0) {
    return {
      competitorId: id,
      totalBuilds: 0,
      meanAbsoluteError: 0,
      medianAbsoluteError: 0,
      confidence: 1.0,   // no evidence of inaccuracy yet
      meanBias: 0,
      latestRecord: null,
    };
  }

  const absDeltas = records.map(r => Math.abs(r.delta));
  const biasDeltas = records.map(r => r.delta);

  const mae = absDeltas.reduce((s, v) => s + v, 0) / absDeltas.length;
  const meanBias = biasDeltas.reduce((s, v) => s + v, 0) / biasDeltas.length;

  // Median: sort ascending, pick middle element
  const sorted = [...absDeltas].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianAbsoluteError = sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;

  const confidence = Math.max(0, Math.min(1, 1 - mae / 5));

  return {
    competitorId: id,
    totalBuilds: records.length,
    meanAbsoluteError: Math.round(mae * 1000) / 1000,
    medianAbsoluteError: Math.round(medianAbsoluteError * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    meanBias: Math.round(meanBias * 1000) / 1000,
    latestRecord: records[records.length - 1] ?? null,
  };
}

// ── Score plateau detection ────────────────────────────────────────────────────

/**
 * Describes a dimension that has failed to improve over consecutive dossier builds.
 */
export interface PlateauReport {
  /** Dimension key (e.g. "1", "7"). */
  dimKey: string;
  /** Human-readable dimension name from the most recent snapshot. */
  dimName: string;
  /** Number of consecutive builds with no improvement (>= 3). */
  staleBuildCount: number;
  /** Score value that has been stuck. */
  staleScore: number;
  /** ISO timestamp of the oldest build in the stale window. */
  since: string;
}

/**
 * Read all dossier snapshots from `.danteforge/dossiers/history/<id>/` and
 * identify dimensions that have not improved across 3 or more consecutive builds.
 *
 * A dimension is considered "stale" when each consecutive delta is <= 0.0
 * (i.e. the score never increased) for at least `minStaleBuildCount` builds.
 *
 * @param cwd              Project root.
 * @param id               Competitor / dossier identifier (default: "dantescode").
 * @param minStaleBuildCount  Minimum number of consecutive non-improving builds (default: 3).
 * @param readFileFn       Optional injection seam.
 * @param listDirFn        Optional injection seam — returns filenames in a directory.
 */
export async function detectScorePlateaus(
  cwd: string,
  id: string = DEFAULT_SELF_COMPETITOR_ID,
  minStaleBuildCount = 3,
  readFileFn: ReadFileFn = (p, e) => fs.readFile(p, e as BufferEncoding),
  listDirFn: (dir: string) => Promise<string[]> = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile()).map(e => e.name);
  },
): Promise<PlateauReport[]> {
  const histDir = dossierHistoryDir(cwd, id);

  // Collect snapshot file names
  let fileNames: string[];
  try {
    fileNames = await listDirFn(histDir);
  } catch {
    // History directory doesn't exist yet — no plateaus to report
    return [];
  }

  // Filter to *.json snapshot files, sort chronologically (oldest first)
  const snapshotFiles = fileNames
    .filter(f => f.endsWith('.json') && f !== 'accuracy.jsonl')
    .sort();

  if (snapshotFiles.length === 0) return [];

  // Load snapshots in order
  const snapshots: Dossier[] = [];
  for (const fileName of snapshotFiles) {
    const filePath = path.join(histDir, fileName);
    try {
      const raw = await readFileFn(filePath, 'utf8');
      snapshots.push(JSON.parse(raw) as Dossier);
    } catch { /* skip unreadable snapshots */ }
  }

  if (snapshots.length < minStaleBuildCount) return [];

  // Gather all known dimension keys
  const allDimKeys = new Set<string>();
  for (const snap of snapshots) {
    for (const k of Object.keys(snap.dimensions)) {
      allDimKeys.add(k);
    }
  }

  const plateaus: PlateauReport[] = [];

  for (const dimKey of allDimKeys) {
    // Build ordered list of (timestamp, score) pairs for this dimension
    const history: Array<{ ts: string; score: number; dimName: string }> = [];
    for (const snap of snapshots) {
      const dim = snap.dimensions[dimKey];
      if (dim !== undefined) {
        history.push({
          ts: snap.lastBuilt,
          score: dim.humanOverride ?? dim.score,
          dimName: (snap.dimensions[dimKey] as DossierDimension & { name?: string }).name ??
            `dimension-${dimKey}`,
        });
      }
    }

    if (history.length < minStaleBuildCount) continue;

    // Walk the history from the end and count consecutive non-improving builds
    let staleBuildCount = 0;
    for (let i = history.length - 1; i >= 1; i--) {
      const curr = history[i]!;
      const prev = history[i - 1]!;
      if (curr.score <= prev.score) {
        staleBuildCount += 1;
      } else {
        break; // improvement found — streak broken
      }
    }

    if (staleBuildCount >= minStaleBuildCount) {
      const staleEntry = history[history.length - staleBuildCount - 1]!;
      plateaus.push({
        dimKey,
        dimName: history[history.length - 1]!.dimName,
        staleBuildCount,
        staleScore: history[history.length - 1]!.score,
        since: staleEntry.ts,
      });
    }
  }

  return plateaus;
}

export async function buildSelfDossier(opts: SelfScorerOptions): Promise<Dossier> {
  const { cwd } = opts;
  const competitorId = opts.competitorId ?? DEFAULT_SELF_COMPETITOR_ID;

  const { getRubric: defaultGetRubric } = await import('./rubric.js');
  const { scoreDimension: defaultScore } = await import('./scorer.js');

  const loadRubricFn = opts._loadRubric ?? defaultGetRubric;
  const scoreDimensionFn = opts._scoreDimension ?? defaultScore;
  const extractEvidenceFn = opts._extractEvidence ?? selfExtractEvidence;
  const readFileFn: ReadFileFn = opts._readFile ?? ((p, e) => fs.readFile(p, e as BufferEncoding));
  const writeFileFn: WriteFileFn = opts._writeFile ?? ((p, d) => fs.writeFile(p, d));
  const mkdirFn: MkdirFn = opts._mkdir ?? ((p, o) => fs.mkdir(p, o));
  const existing = await loadExistingDossier(cwd, competitorId, readFileFn);

  const rubric = await loadRubricFn(cwd);

  // Resolve display name from package.json if not provided
  let displayName = opts.displayName ?? 'DanteForge';
  try {
    const pkgRaw = await readFileFn(path.join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    if (typeof pkg['name'] === 'string') displayName = pkg['name'];
  } catch { /* use default */ }

  // Determine source files to read
  const sourceFiles = opts.sourceGlob ?? KEY_SOURCE_FILES;

  // Read source files
  const fileContents: Array<{ filePath: string; content: string }> = [];
  for (const relPath of sourceFiles) {
    const absPath = path.join(cwd, relPath);
    try {
      const content = await readFileFn(absPath, 'utf8');
      fileContents.push({ filePath: relPath, content });
    } catch { /* skip missing files */ }
  }

  const dimensions = await buildDossierDimensions(
    Object.entries(rubric.dimensions),
    fileContents,
    extractEvidenceFn,
    scoreDimensionFn,
    displayName,
  );

  const dossier: Dossier = {
    competitor: competitorId,
    displayName,
    type: 'open-source',
    lastBuilt: new Date().toISOString(),
    sources: fileContents.map(({ filePath }) => ({
      url: filePath,
      fetchedAt: new Date().toISOString(),
      title: filePath,
      contentHash: `file:${filePath}`,
    })),
    dimensions,
    composite: computeComposite(dimensions),
    compositeMethod: 'mean_28_dims',
    rubricVersion: rubric.version,
  };

  await mkdirFn(dossierDir(cwd), { recursive: true });
  if (existing) {
    await mkdirFn(dossierHistoryDir(cwd, competitorId), { recursive: true });
    await writeFileFn(
      dossierSnapshotPath(cwd, competitorId, existing.lastBuilt),
      JSON.stringify(existing, null, 2),
    );

    // Track historical accuracy: the prior dossier's composite is the "prediction"
    // and the newly computed composite is the "actual". Best-effort — never blocks.
    try {
      const accuracyRecord = await appendAccuracyRecord(
        cwd,
        competitorId,
        existing.composite,
        dossier.composite,
        mkdirFn,
        writeFileFn,
        readFileFn,
      );
      // Attach accuracy metadata to dossier for downstream consumers
      (dossier as Dossier & { historicalAccuracy?: HistoricalAccuracyRecord }).historicalAccuracy = accuracyRecord;
    } catch { /* best-effort */ }
  }
  await writeFileFn(dossierPath(cwd, competitorId), JSON.stringify(dossier, null, 2));

  return dossier;
}
