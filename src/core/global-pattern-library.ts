// Global Pattern Library — cross-project pattern sharing stored at ~/.danteforge/pattern-library.json.
// Projects publish their best patterns and query others' patterns to bootstrap new dimensions.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GlobalPatternEntry {
  patternName: string;
  category: string;
  implementationSnippet: string;
  whyItWorks: string;
  adoptionComplexity: 'low' | 'medium' | 'high';
  sourceRepo: string;
  sourceProject: string;   // project name/path that published this
  publishedAt: string;     // ISO timestamp
  lastValidatedAt?: string; // ISO timestamp of last successful adoption / ROI update
  useCount: number;        // how many projects adopted this
  avgRoi: number;          // 0-1 average ROI across adoptions
  /** 'active' = validated within staleAfterDays; 'decaying' = not validated recently; 'stale' = very old */
  fitness: 'active' | 'decaying' | 'stale';
}

/** Days before a pattern is considered decaying (no recent adoption validation). */
export const PATTERN_DECAY_DAYS = 90;
/** Days before a pattern is considered fully stale (requires re-harvest to validate). */
export const PATTERN_STALE_DAYS = 180;

export interface PatternLibraryIndex {
  version: '1.0.0';
  entries: GlobalPatternEntry[];
  updatedAt: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function getLibraryPath(): string {
  return path.join(os.homedir(), '.danteforge', 'pattern-library.json');
}

function emptyIndex(): PatternLibraryIndex {
  return { version: '1.0.0', entries: [], updatedAt: new Date().toISOString() };
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export async function loadLibrary(
  _fsRead?: (p: string) => Promise<string>,
): Promise<PatternLibraryIndex> {
  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(getLibraryPath());
    const parsed = JSON.parse(raw) as PatternLibraryIndex;
    if (!parsed.entries || !Array.isArray(parsed.entries)) return emptyIndex();
    return parsed;
  } catch {
    return emptyIndex();
  }
}

export async function saveLibrary(
  index: PatternLibraryIndex,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  try {
    await write(getLibraryPath(), JSON.stringify(index, null, 2));
  } catch {
    // best-effort — never throws
  }
}

// ── Publish ───────────────────────────────────────────────────────────────────

export async function publishToLibrary(
  pattern: Omit<GlobalPatternEntry, 'publishedAt' | 'useCount' | 'avgRoi' | 'fitness' | 'lastValidatedAt'>,
  opts?: {
    _fsRead?: (p: string) => Promise<string>;
    _fsWrite?: (p: string, d: string) => Promise<void>;
  },
): Promise<void> {
  const index = await loadLibrary(opts?._fsRead);
  const existing = index.entries.find(
    (e) => e.patternName === pattern.patternName && e.sourceRepo === pattern.sourceRepo,
  );
  if (existing) {
    // Update in place, increment useCount, preserve avgRoi
    Object.assign(existing, {
      ...pattern,
      publishedAt: existing.publishedAt,
      useCount: existing.useCount + 1,
      avgRoi: existing.avgRoi,
    });
  } else {
    index.entries.push({
      ...pattern,
      publishedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      useCount: 1,
      avgRoi: 0.5,
      fitness: 'active',
    });
  }
  index.updatedAt = new Date().toISOString();
  await saveLibrary(index, opts?._fsWrite);
}

// ── Query ─────────────────────────────────────────────────────────────────────

const COMPLEXITY_ORDER: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export async function queryLibrary(
  opts: {
    category?: string;
    maxComplexity?: 'low' | 'medium' | 'high';
    minAvgRoi?: number;
    limit?: number;
  },
  _fsRead?: (p: string) => Promise<string>,
): Promise<GlobalPatternEntry[]> {
  const index = await loadLibrary(_fsRead);
  const limit = opts.limit ?? 20;

  let results = index.entries.filter((e) => {
    if (opts.category !== undefined && e.category !== opts.category) return false;
    if (
      opts.maxComplexity !== undefined &&
      COMPLEXITY_ORDER[e.adoptionComplexity] > COMPLEXITY_ORDER[opts.maxComplexity]
    ) {
      return false;
    }
    if (opts.minAvgRoi !== undefined && e.avgRoi < opts.minAvgRoi) return false;
    return true;
  });

  // Active patterns rank above decaying/stale; within each tier, sort by avgRoi descending
  const fitnessScore = (f: GlobalPatternEntry['fitness'] | undefined) =>
    f === 'stale' ? 0 : f === 'decaying' ? 1 : 2;

  results.sort((a, b) => {
    const fitnessDiff = fitnessScore(b.fitness) - fitnessScore(a.fitness);
    if (fitnessDiff !== 0) return fitnessDiff;
    return b.avgRoi - a.avgRoi;
  });
  return results.slice(0, limit);
}

// ── Fitness decay ─────────────────────────────────────────────────────────────

/**
 * Compute the current fitness of a pattern based on its lastValidatedAt date.
 * Called inline by decayPatterns — pure function, no I/O.
 */
export function computeFitness(entry: GlobalPatternEntry, nowMs = Date.now()): GlobalPatternEntry['fitness'] {
  const validatedAt = entry.lastValidatedAt ?? entry.publishedAt;
  const daysSince = (nowMs - new Date(validatedAt).getTime()) / 86_400_000;
  if (daysSince >= PATTERN_STALE_DAYS) return 'stale';
  if (daysSince >= PATTERN_DECAY_DAYS) return 'decaying';
  return 'active';
}

/**
 * Re-evaluate fitness of all patterns in the library and persist.
 * Call periodically (e.g., at the start of each harvest-forge run).
 * Returns counts of patterns by fitness state.
 */
export async function decayPatterns(
  opts?: {
    _fsRead?: (p: string) => Promise<string>;
    _fsWrite?: (p: string, d: string) => Promise<void>;
    _now?: () => number;
  },
): Promise<{ active: number; decaying: number; stale: number }> {
  const index = await loadLibrary(opts?._fsRead);
  const now = opts?._now?.() ?? Date.now();

  let active = 0, decaying = 0, stale = 0;
  for (const entry of index.entries) {
    entry.fitness = computeFitness(entry, now);
    if (entry.fitness === 'active') active++;
    else if (entry.fitness === 'decaying') decaying++;
    else stale++;
  }

  index.updatedAt = new Date(now).toISOString();
  await saveLibrary(index, opts?._fsWrite);
  return { active, decaying, stale };
}

// ── ROI update ────────────────────────────────────────────────────────────────

export async function updatePatternRoi(
  patternName: string,
  sourceRepo: string,
  newRoi: number,
  opts?: {
    _fsRead?: (p: string) => Promise<string>;
    _fsWrite?: (p: string, d: string) => Promise<void>;
  },
): Promise<void> {
  const index = await loadLibrary(opts?._fsRead);
  const entry = index.entries.find(
    (e) => e.patternName === patternName && e.sourceRepo === sourceRepo,
  );
  if (!entry) return;
  entry.avgRoi = 0.7 * entry.avgRoi + 0.3 * newRoi;
  entry.lastValidatedAt = new Date().toISOString();
  entry.fitness = 'active'; // ROI update counts as validation
  index.updatedAt = new Date().toISOString();
  await saveLibrary(index, opts?._fsWrite);
}
