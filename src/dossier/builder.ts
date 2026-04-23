// src/dossier/builder.ts — Orchestrates the full dossier build pipeline

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dossier, DossierDimension, EvidenceItem, RubricDimension } from './types.js';
import type { FetcherDeps, FetchResult } from './fetcher.js';
import type { ExtractorDeps } from './extractor.js';
import type { ScorerDeps } from './scorer.js';
import type { Rubric } from './types.js';
import type { CompetitorRegistry } from './types.js';

export type WriteFileFn = (p: string, d: string) => Promise<void>;
export type MkdirFn = (p: string, opts: { recursive: boolean }) => Promise<unknown>;
export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type ReadDirFn = (p: string) => Promise<string[]>;

export type FetchSourceFn = (
  url: string,
  competitor: string,
  cwd: string,
  deps?: FetcherDeps,
) => Promise<FetchResult>;

export type ExtractEvidenceFn = (
  sourceContent: string,
  sourceUrl: string,
  competitor: string,
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

export type GetRubricFn = (cwd: string) => Promise<Rubric>;
export type LoadRegistryFn = (cwd: string) => Promise<CompetitorRegistry>;

export interface BuildDossierOptions {
  cwd: string;
  competitor: string;         // competitor id e.g. "cursor"
  sources?: string[];         // override registry primary sources
  since?: string;             // skip if dossier fresher than this duration e.g. "7d"
  // Injection seams
  _fetchSource?: FetchSourceFn;
  _extractEvidence?: ExtractEvidenceFn;
  _scoreDimension?: ScoreDimensionFn;
  _loadRubric?: GetRubricFn;
  _loadRegistry?: LoadRegistryFn;
  _writeFile?: WriteFileFn;
  _mkdir?: MkdirFn;
  _readExisting?: (p: string) => Promise<Dossier | null>;
}

export interface BuildAllOptions extends Omit<BuildDossierOptions, 'competitor'> {
  competitors?: string[];     // subset to rebuild; defaults to all in registry
}

function dossierDir(cwd: string): string {
  return path.join(cwd, '.danteforge', 'dossiers');
}

function dossierPath(cwd: string, competitorId: string): string {
  return path.join(dossierDir(cwd), `${competitorId}.json`);
}

function dossierHistoryDir(cwd: string, competitorId: string): string {
  return path.join(dossierDir(cwd), 'history', competitorId);
}

function sanitizeSnapshotTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function dossierSnapshotPath(cwd: string, competitorId: string, lastBuilt: string): string {
  return path.join(
    dossierHistoryDir(cwd, competitorId),
    `${sanitizeSnapshotTimestamp(lastBuilt)}.json`,
  );
}

function parseSince(since: string): number {
  // e.g. "7d" → 7 days in ms; "24h" → 24h in ms
  const match = /^(\d+)([dhm])$/.exec(since);
  if (!match) return 0;
  const n = parseInt(match[1]!, 10);
  switch (match[2]) {
    case 'd': return n * 24 * 60 * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'm': return n * 60 * 1000;
    default: return 0;
  }
}

async function loadExistingDossier(p: string): Promise<Dossier | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as Dossier;
  } catch {
    return null;
  }
}

async function loadLatestSnapshot(
  dir: string,
  readDir: ReadDirFn = fs.readdir,
  readFile: ReadFileFn = fs.readFile as unknown as ReadFileFn,
): Promise<Dossier | null> {
  let files: string[];
  try {
    files = await readDir(dir);
  } catch {
    return null;
  }

  const snapshots = files
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse();

  for (const snapshot of snapshots) {
    try {
      const raw = await readFile(path.join(dir, snapshot), 'utf8');
      return JSON.parse(raw) as Dossier;
    } catch {
      // Skip malformed snapshots and keep looking.
    }
  }

  return null;
}

function isDossierFresh(dossier: Dossier, sinceMs: number): boolean {
  if (sinceMs <= 0) return false;
  const age = Date.now() - new Date(dossier.lastBuilt).getTime();
  return age < sinceMs;
}

async function buildDimensions(
  fetchedSources: Array<{ url: string; content: string }>,
  rubric: Rubric,
  competitor: string,
  extractEvidenceFn: ExtractEvidenceFn,
  scoreDimensionFn: ScoreDimensionFn,
): Promise<Record<string, DossierDimension>> {
  const dimensions: Record<string, DossierDimension> = {};
  for (const [dimKey, dimDef] of Object.entries(rubric.dimensions)) {
    const dimNum = parseInt(dimKey, 10);
    let allEvidence: EvidenceItem[] = [];
    for (const { url, content } of fetchedSources) {
      const evidence = await extractEvidenceFn(content, url, competitor, dimNum, dimDef);
      allEvidence = allEvidence.concat(evidence);
    }
    const { score, justification } = await scoreDimensionFn(allEvidence, dimNum, dimDef, competitor);
    const unverified = allEvidence.length === 0 || allEvidence.every((e) => !e.quote || e.quote.trim() === '');
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

function computeComposite(dimensions: Record<string, DossierDimension>): number {
  const scores = Object.values(dimensions).map((d) => d.humanOverride ?? d.score);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

export async function buildDossier(opts: BuildDossierOptions): Promise<Dossier> {
  const {
    cwd,
    competitor,
    sources,
    since,
  } = opts;

  // Lazy-load defaults to avoid circular imports in tests
  const { fetchSource: defaultFetch } = await import('./fetcher.js');
  const { extractEvidence: defaultExtract } = await import('./extractor.js');
  const { scoreDimension: defaultScore } = await import('./scorer.js');
  const { getRubric: defaultGetRubric } = await import('./rubric.js');
  const { loadRegistry: defaultLoadRegistry } = await import('./registry.js');

  const fetchSourceFn = opts._fetchSource ?? defaultFetch;
  const extractEvidenceFn = opts._extractEvidence ?? defaultExtract;
  const scoreDimensionFn = opts._scoreDimension ?? defaultScore;
  const loadRubricFn = opts._loadRubric ?? defaultGetRubric;
  const loadRegistryFn = opts._loadRegistry ?? defaultLoadRegistry;
  const writeFileFn: WriteFileFn = opts._writeFile ?? ((p, d) => fs.writeFile(p, d));
  const mkdirFn: MkdirFn = opts._mkdir ?? ((p, o) => fs.mkdir(p, o));
  const readExistingFn = opts._readExisting ?? loadExistingDossier;

  // Skip if fresh enough
  const sinceMs = since ? parseSince(since) : 0;
  if (sinceMs > 0) {
    const existing = await readExistingFn(dossierPath(cwd, competitor));
    if (existing && isDossierFresh(existing, sinceMs)) {
      return existing;
    }
  }

  const existing = await readExistingFn(dossierPath(cwd, competitor));

  // Load rubric and registry
  const rubric = await loadRubricFn(cwd);
  const registry = await loadRegistryFn(cwd);
  const entry = registry.competitors.find((c) => c.id === competitor);

  const displayName = entry?.displayName ?? competitor;
  const type = entry?.type ?? 'closed-source';
  const sourceUrls = sources ?? entry?.primarySources ?? [];

  // Fetch all sources
  const fetchedSources: Array<{ url: string; content: string; hash: string }> = [];
  for (const url of sourceUrls) {
    try {
      const result = await fetchSourceFn(url, competitor, cwd);
      fetchedSources.push({ url, content: result.content, hash: result.hash });
    } catch {
      // Best-effort: skip failed sources
    }
  }

  // Build dimensions: for each rubric dim, extract evidence across all sources, then score
  const dimensions = await buildDimensions(fetchedSources, rubric, competitor, extractEvidenceFn, scoreDimensionFn);

  const dossier: Dossier = {
    competitor,
    displayName,
    type,
    lastBuilt: new Date().toISOString(),
    sources: fetchedSources.map(({ url, hash }) => ({
      url,
      fetchedAt: new Date().toISOString(),
      title: url,
      contentHash: hash,
    })),
    dimensions,
    composite: computeComposite(dimensions),
    compositeMethod: 'mean_28_dims',
    rubricVersion: rubric.version,
  };

  // Write dossier
  await mkdirFn(dossierDir(cwd), { recursive: true });
  if (existing) {
    await mkdirFn(dossierHistoryDir(cwd, competitor), { recursive: true });
    await writeFileFn(
      dossierSnapshotPath(cwd, competitor, existing.lastBuilt),
      JSON.stringify(existing, null, 2),
    );
  }
  await writeFileFn(dossierPath(cwd, competitor), JSON.stringify(dossier, null, 2));

  return dossier;
}

export async function buildAllDossiers(opts: BuildAllOptions): Promise<Dossier[]> {
  const { competitors: competitorSubset, ...rest } = opts;

  const { loadRegistry: defaultLoadRegistry } = await import('./registry.js');
  const loadRegistryFn = opts._loadRegistry ?? defaultLoadRegistry;
  const registry = await loadRegistryFn(opts.cwd);

  const ids = competitorSubset ?? registry.competitors.map((c) => c.id);
  const results: Dossier[] = [];

  for (const id of ids) {
    const dossier = await buildDossier({ ...rest, competitor: id });
    results.push(dossier);
  }

  return results;
}

export async function loadDossier(cwd: string, competitor: string): Promise<Dossier | null> {
  return loadExistingDossier(dossierPath(cwd, competitor));
}

export async function loadPreviousDossier(
  cwd: string,
  competitor: string,
  readDir: ReadDirFn = fs.readdir,
  readFile: ReadFileFn = fs.readFile as unknown as ReadFileFn,
): Promise<Dossier | null> {
  return loadLatestSnapshot(dossierHistoryDir(cwd, competitor), readDir, readFile);
}

export async function listDossiers(cwd: string): Promise<Dossier[]> {
  const dir = dossierDir(cwd);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const dossiers: Dossier[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const d = await loadExistingDossier(path.join(dir, file));
    if (d) dossiers.push(d);
  }
  return dossiers;
}

// Exported for testing
export {
  computeComposite,
  dossierDir,
  dossierHistoryDir,
  dossierPath,
  dossierSnapshotPath,
  isDossierFresh,
  parseSince,
};
