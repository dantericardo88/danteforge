// src/dossier/landscape.ts — Assembles full competitive matrix from all dossiers

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dossier, LandscapeMatrix, LandscapeRanking, LandscapeGap } from './types.js';

export type ReadDirFn = (p: string) => Promise<string[]>;
export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;
export type WriteFileFn = (p: string, d: string) => Promise<void>;
export type MkdirFn = (p: string, opts: { recursive: boolean }) => Promise<unknown>;

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

export function isLandscapeStale(
  landscape: LandscapeMatrix,
  maxAgeDays = 7,
): boolean {
  const ageMs = Date.now() - new Date(landscape.generatedAt).getTime();
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

export function landscapeJsonPath_ (cwd: string): string {
  return landscapeJsonPath(cwd);
}
