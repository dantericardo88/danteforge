import fs from 'fs/promises';
import path from 'path';

import type { AssessmentHistoryEntry } from './harsh-scorer.js';

export interface CommunityMetrics {
  npmDownloadsMonthly?: number;
  githubStars?: number;
  githubContributors?: number;
}

export interface CommunityReadinessScore {
  score: number;
  maxScore?: number;
}

export async function fetchCommunityMetrics(
  packageName: string,
  repoSlug: string,
  opts: { _fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<CommunityMetrics> {
  const fetcher = opts._fetch ?? fetch;
  const timeout = opts.timeoutMs ?? 5000;
  const result: CommunityMetrics = {};

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetcher(`https://api.npmjs.org/downloads/point/last-month/${packageName}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      if (typeof data['downloads'] === 'number') result.npmDownloadsMonthly = data['downloads'];
    }
  } catch { /* best-effort */ }

  if (!repoSlug) return result;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetcher(
      `https://api.github.com/repos/${repoSlug}`,
      { signal: ctrl.signal, headers: { 'User-Agent': 'danteforge-scorer/1.0' } },
    );
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      if (typeof data['stargazers_count'] === 'number') result.githubStars = data['stargazers_count'];
    }
  } catch { /* best-effort */ }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetcher(
      `https://api.github.com/repos/${repoSlug}/contributors?per_page=1&anon=false`,
      { signal: ctrl.signal, headers: { 'User-Agent': 'danteforge-scorer/1.0' } },
    );
    clearTimeout(t);
    if (res.ok) {
      const link = res.headers.get('link') ?? '';
      const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
      if (match) {
        result.githubContributors = parseInt(match[1], 10);
      } else {
        const data = await res.json() as unknown[];
        result.githubContributors = Array.isArray(data) ? data.length : undefined;
      }
    }
  } catch { /* best-effort */ }

  return result;
}

export function computeCommunityAdoptionScore(
  metrics: CommunityMetrics = {},
  readiness?: CommunityReadinessScore,
): number {
  let score = 15;

  const stars = metrics.githubStars ?? 0;
  if (stars >= 1000) score += 60;
  else if (stars >= 500) score += 40;
  else if (stars >= 100) score += 20;
  else if (stars >= 1) score += 10;

  const downloads = metrics.npmDownloadsMonthly ?? 0;
  if (downloads >= 10000) score += 30;
  else if (downloads >= 1000) score += 25;
  else if (downloads >= 100) score += 15;
  else if (downloads >= 1) score += 5;

  const contributors = metrics.githubContributors ?? 1;
  if (contributors >= 6) score += 10;
  else if (contributors >= 2) score += 5;

  if (readiness) {
    const maxScore = readiness.maxScore && readiness.maxScore > 0 ? readiness.maxScore : 100;
    const readinessPct = Math.max(0, Math.min(100, (readiness.score / maxScore) * 100));
    const readinessScore = 15 + Math.round(readinessPct * 0.6);
    score = Math.max(score, readinessScore);
  }

  return Math.max(0, Math.min(100, score));
}

export function computeCausalCoherenceScore(globalCausalCoherence: number, totalAttributions: number): number {
  if (totalAttributions === 0) return 20;
  if (totalAttributions < 5) return 30;
  const sampleBonus = totalAttributions >= 50 ? 10 : totalAttributions >= 20 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(globalCausalCoherence * 100) + sampleBonus));
}

export async function readCoveragePercent(
  cwd: string,
  _readFile?: (p: string) => Promise<string>,
): Promise<number | null> {
  const readFile = _readFile ?? ((p: string) => fs.readFile(p, 'utf-8'));
  const candidates = [
    path.join(cwd, '.danteforge', 'coverage-summary.json'),
    path.join(cwd, 'coverage', 'coverage-summary.json'),
  ];
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(await readFile(candidate)) as Record<string, unknown>;
      const total = data['total'] as Record<string, unknown> | undefined;
      const lines = total?.['lines'] as Record<string, unknown> | undefined;
      if (typeof lines?.['pct'] === 'number') return lines['pct'];
    } catch { /* try next */ }
  }
  return null;
}

export async function readAssessmentHistory(cwd: string): Promise<AssessmentHistoryEntry[]> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, '.danteforge', 'assessment-history.json'), 'utf-8')) as AssessmentHistoryEntry[];
  } catch {
    return [];
  }
}

export async function writeAssessmentHistory(cwd: string, entries: AssessmentHistoryEntry[]): Promise<void> {
  const dir = path.join(cwd, '.danteforge');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'assessment-history.json'), JSON.stringify(entries, null, 2));
}

export async function listSourceFiles(cwd: string): Promise<string[]> {
  try {
    return await walkDir(path.join(cwd, 'src'), cwd, '.ts');
  } catch {
    return [];
  }
}

async function walkDir(dir: string, base: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Array<import('node:fs').Dirent> = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkDir(full, base, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}
