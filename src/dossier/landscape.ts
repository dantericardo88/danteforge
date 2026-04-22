// src/dossier/landscape.ts — Assembles full competitive matrix from all dossiers

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dossier, LandscapeMatrix, LandscapeRanking, LandscapeGap } from './types.js';

export type ReadDirFn = (p: string) => Promise<string[]>;
export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type WriteFileFn = (p: string, d: string) => Promise<void>;
export type MkdirFn = (p: string, opts: { recursive: boolean }) => Promise<unknown>;

export interface LandscapeRankingDelta {
  competitor: string;
  displayName: string;
  beforeRank: number | null;
  afterRank: number | null;
  beforeComposite: number | null;
  afterComposite: number | null;
  rankDelta: number;
  compositeDelta: number;
}

export interface LandscapeDelta {
  previousGeneratedAt: string;
  currentGeneratedAt: string;
  newCompetitors: string[];
  removedCompetitors: string[];
  rankingChanges: LandscapeRankingDelta[];
}

export interface LandscapeDeps {
  _readDir?: ReadDirFn;
  _readFile?: ReadFileFn;
  _writeFile?: WriteFileFn;
  _mkdir?: MkdirFn;
  _loadDossiers?: (cwd: string) => Promise<Dossier[]>;
}

function dossierDir(cwd: string): string {
  return path.join(cwd, '.danteforge', 'dossiers');
}

function landscapeJsonPath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'landscape.json');
}

function landscapeMdPath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'COMPETITIVE_LANDSCAPE.md');
}

function landscapeHistoryDir(cwd: string): string {
  return path.join(cwd, '.danteforge', 'landscape-history');
}

function sanitizeSnapshotTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-');
}

function landscapeSnapshotPath(cwd: string, generatedAt: string): string {
  return path.join(
    landscapeHistoryDir(cwd),
    `${sanitizeSnapshotTimestamp(generatedAt)}.json`,
  );
}

async function loadAllDossiers(
  cwd: string,
  readDir: ReadDirFn,
  readFile: ReadFileFn,
): Promise<Dossier[]> {
  const dir = dossierDir(cwd);
  let files: string[];
  try {
    files = await readDir(dir);
  } catch {
    return [];
  }
  const dossiers: Dossier[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(path.join(dir, file) as unknown as string, 'utf8' as BufferEncoding);
      dossiers.push(JSON.parse(raw) as Dossier);
    } catch { /* skip malformed */ }
  }
  return dossiers;
}

function buildDimScores(dossiers: Dossier[]): Record<string, Record<string, number>> {
  const dimScores: Record<string, Record<string, number>> = {};
  for (const dossier of dossiers) {
    for (const [dimKey, dimDef] of Object.entries(dossier.dimensions)) {
      if (!dimScores[dimKey]) dimScores[dimKey] = {};
      dimScores[dimKey]![dossier.competitor] = dimDef.humanOverride ?? dimDef.score;
    }
  }
  return dimScores;
}

function buildRankings(dossiers: Dossier[]): LandscapeRanking[] {
  return dossiers
    .map((d) => ({
      competitor: d.competitor,
      displayName: d.displayName,
      composite: d.composite,
      type: d.type,
    }))
    .sort((a, b) => b.composite - a.composite);
}

function buildGapAnalysis(
  dossiers: Dossier[],
  selfId: string,
): LandscapeGap[] | undefined {
  const selfDossier = dossiers.find((d) => d.competitor === selfId);
  if (!selfDossier) return undefined;

  const gaps: LandscapeGap[] = [];

  for (const [dimKey, selfDim] of Object.entries(selfDossier.dimensions)) {
    const dcScore = selfDim.humanOverride ?? selfDim.score;
    let leaderScore = dcScore;
    let leader = selfId;

    for (const dossier of dossiers) {
      if (dossier.competitor === selfId) continue;
      const compDim = dossier.dimensions[dimKey];
      if (!compDim) continue;
      const compScore = compDim.humanOverride ?? compDim.score;
      if (compScore > leaderScore) {
        leaderScore = compScore;
        leader = dossier.competitor;
      }
    }

    if (leaderScore - dcScore > 1.0) {
      // Find dim name from any dossier
      const dimName = selfDossier.dimensions[dimKey]?.scoreJustification
        ? `Dimension ${dimKey}`
        : `Dimension ${dimKey}`;
      gaps.push({
        dim: dimKey,
        dimName,
        dcScore,
        leader,
        leaderScore,
        gap: Math.round((leaderScore - dcScore) * 10) / 10,
      });
    }
  }

  return gaps.sort((a, b) => b.gap - a.gap);
}

function renderMarkdownTable(
  rankings: LandscapeRanking[],
  dimScores: Record<string, Record<string, number>>,
  dossiers: Dossier[],
): string {
  const lines: string[] = [
    '# Competitive Landscape',
    '',
    `_Generated: ${new Date().toISOString().slice(0, 10)}_`,
    '',
    '## Rankings',
    '',
    '| Rank | Competitor | Type | Composite Score |',
    '|------|-----------|------|----------------|',
  ];

  rankings.forEach((r, i) => {
    const marker = r.competitor === 'dantescode' ? ' ← DC' : '';
    lines.push(`| ${i + 1} | **${r.displayName}**${marker} | ${r.type} | ${r.composite.toFixed(1)} |`);
  });

  lines.push('');
  lines.push('## Dimension Scores');
  lines.push('');

  const competitors = rankings.map((r) => r.competitor);
  const dimKeys = Object.keys(dimScores).sort((a, b) => Number(a) - Number(b));

  // Get dim names from first dossier that has all dims
  const dimNames: Record<string, string> = {};
  for (const dossier of dossiers) {
    for (const dimKey of dimKeys) {
      if (!dimNames[dimKey]) {
        // We don't store dim names in dossier directly, use key
        dimNames[dimKey] = `Dim ${dimKey}`;
      }
    }
  }

  // Table header
  const header = ['| Dimension |', ...competitors.map((c) => ` ${c.slice(0, 8)} |`)].join('');
  const divider = ['|-----------|', ...competitors.map(() => '---------|')].join('');
  lines.push(header);
  lines.push(divider);

  for (const dimKey of dimKeys) {
    const row = [`| ${dimNames[dimKey] ?? `Dim ${dimKey}`} |`];
    for (const comp of competitors) {
      const score = dimScores[dimKey]?.[comp];
      row.push(` ${score !== undefined ? score.toFixed(1) : 'n/a'} |`);
    }
    lines.push(row.join(''));
  }

  lines.push('');
  lines.push('---');
  lines.push('_Generated by DanteForge dossier system. Run `danteforge landscape` to refresh._');

  return lines.join('\n');
}

export async function buildLandscape(
  cwd: string,
  deps: LandscapeDeps = {},
  selfId = 'dantescode',
): Promise<LandscapeMatrix> {
  const readDir = deps._readDir ?? ((p) => fs.readdir(p));
  const readFile = deps._readFile ?? ((p, e) => fs.readFile(p, e as BufferEncoding));
  const writeFile = deps._writeFile ?? ((p, d) => fs.writeFile(p, d));
  const mkdirFn = deps._mkdir ?? ((p, o) => fs.mkdir(p, o));
  const existing = await loadLandscape(cwd);

  const dossiers = deps._loadDossiers
    ? await deps._loadDossiers(cwd)
    : await loadAllDossiers(cwd, readDir, readFile);

  if (dossiers.length === 0) {
    throw new Error(
      'No dossiers found. Run: danteforge dossier build --all',
    );
  }

  // Determine rubric version from first dossier
  const rubricVersion = dossiers[0]?.rubricVersion ?? 1;

  const rankings = buildRankings(dossiers);
  const dimScores = buildDimScores(dossiers);
  const gapAnalysis = buildGapAnalysis(dossiers, selfId);

  const matrix: LandscapeMatrix = {
    generatedAt: new Date().toISOString(),
    rubricVersion,
    competitors: rankings.map((r) => r.competitor),
    rankings,
    dimScores,
    gapAnalysis,
  };

  // Write landscape.json
  await mkdirFn(path.join(cwd, '.danteforge'), { recursive: true });
  if (existing) {
    await mkdirFn(landscapeHistoryDir(cwd), { recursive: true });
    await writeFile(
      landscapeSnapshotPath(cwd, existing.generatedAt),
      JSON.stringify(existing, null, 2),
    );
  }
  await writeFile(landscapeJsonPath(cwd), JSON.stringify(matrix, null, 2));

  // Write COMPETITIVE_LANDSCAPE.md
  const md = renderMarkdownTable(rankings, dimScores, dossiers);
  await writeFile(landscapeMdPath(cwd), md);

  return matrix;
}

export async function loadLandscape(cwd: string): Promise<LandscapeMatrix | null> {
  try {
    const raw = await fs.readFile(landscapeJsonPath(cwd), 'utf8');
    return JSON.parse(raw) as LandscapeMatrix;
  } catch {
    return null;
  }
}

export async function loadPreviousLandscape(
  cwd: string,
  readDir: ReadDirFn = fs.readdir,
  readFile: ReadFileFn = fs.readFile as unknown as ReadFileFn,
): Promise<LandscapeMatrix | null> {
  let files: string[];
  try {
    files = await readDir(landscapeHistoryDir(cwd));
  } catch {
    return null;
  }

  const snapshots = files
    .filter((file) => file.endsWith('.json'))
    .sort()
    .reverse();

  for (const snapshot of snapshots) {
    try {
      const raw = await readFile(path.join(landscapeHistoryDir(cwd), snapshot), 'utf8');
      return JSON.parse(raw) as LandscapeMatrix;
    } catch {
      // Skip malformed snapshots and continue.
    }
  }

  return null;
}

export function isLandscapeStale(
  landscape: LandscapeMatrix,
  maxAgeDays = 7,
): boolean {
  const ageMs = Date.now() - new Date(landscape.generatedAt).getTime();
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

export function diffLandscape(
  previous: LandscapeMatrix,
  current: LandscapeMatrix,
): LandscapeDelta {
  const previousRanks = new Map(
    previous.rankings.map((ranking, index) => [ranking.competitor, { ranking, rank: index + 1 }]),
  );
  const currentRanks = new Map(
    current.rankings.map((ranking, index) => [ranking.competitor, { ranking, rank: index + 1 }]),
  );

  const previousCompetitors = new Set(previous.rankings.map((ranking) => ranking.competitor));
  const currentCompetitors = new Set(current.rankings.map((ranking) => ranking.competitor));

  const newCompetitors = current.rankings
    .filter((ranking) => !previousCompetitors.has(ranking.competitor))
    .map((ranking) => ranking.competitor);
  const removedCompetitors = previous.rankings
    .filter((ranking) => !currentCompetitors.has(ranking.competitor))
    .map((ranking) => ranking.competitor);

  const rankingChanges: LandscapeRankingDelta[] = [];
  const allCompetitors = new Set<string>([
    ...previous.rankings.map((ranking) => ranking.competitor),
    ...current.rankings.map((ranking) => ranking.competitor),
  ]);

  for (const competitor of allCompetitors) {
    const before = previousRanks.get(competitor);
    const after = currentRanks.get(competitor);
    const beforeRank = before?.rank ?? null;
    const afterRank = after?.rank ?? null;
    const beforeComposite = before?.ranking.composite ?? null;
    const afterComposite = after?.ranking.composite ?? null;
    const rankDelta = beforeRank !== null && afterRank !== null ? beforeRank - afterRank : 0;
    const compositeDelta =
      beforeComposite !== null && afterComposite !== null
        ? Math.round((afterComposite - beforeComposite) * 10) / 10
        : 0;

    if (
      beforeRank !== afterRank ||
      beforeComposite !== afterComposite
    ) {
      rankingChanges.push({
        competitor,
        displayName: after?.ranking.displayName ?? before?.ranking.displayName ?? competitor,
        beforeRank,
        afterRank,
        beforeComposite,
        afterComposite,
        rankDelta,
        compositeDelta,
      });
    }
  }

  rankingChanges.sort((a, b) => {
    const rankDeltaDiff = Math.abs(b.rankDelta) - Math.abs(a.rankDelta);
    if (rankDeltaDiff !== 0) return rankDeltaDiff;
    return Math.abs(b.compositeDelta) - Math.abs(a.compositeDelta);
  });

  return {
    previousGeneratedAt: previous.generatedAt,
    currentGeneratedAt: current.generatedAt,
    newCompetitors,
    removedCompetitors,
    rankingChanges,
  };
}

export function landscapeJsonPath_ (cwd: string): string {
  return landscapeJsonPath(cwd);
}

export {
  landscapeHistoryDir,
  landscapeJsonPath,
  landscapeMdPath,
  landscapeSnapshotPath,
};
