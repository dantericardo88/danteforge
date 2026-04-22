// Causal Attribution — sequential micro-adoption tracking.
// Adopts one pattern at a time, verifies, records delta, and builds an attribution log
// tracking which patterns actually moved the quality needle.

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttributionRecord {
  patternName: string;
  sourceRepo: string;
  adoptedAt: string;        // ISO timestamp
  preAdoptionScore: number; // 0-10 quality score before
  postAdoptionScore: number; // 0-10 quality score after
  scoreDelta: number;       // postAdoption - preAdoption
  verifyStatus: 'pass' | 'fail' | 'rejected';
  filesModified: string[];
  gitSha?: string;          // SHA before adoption (rollback point)
  /** Short statement describing which dimension this pattern is expected to affect and why.
   *  Written at adoption time; outcome-check validates whether the hypothesis was correct. */
  outcomeHypothesis?: string;
}

export interface AttributionLog {
  version: '1.0.0';
  records: AttributionRecord[];
  updatedAt: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function getAttributionLogPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'attribution-log.json');
}

function emptyLog(): AttributionLog {
  return { version: '1.0.0', records: [], updatedAt: new Date().toISOString() };
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export async function loadAttributionLog(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<AttributionLog> {
  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(getAttributionLogPath(cwd));
    const parsed = JSON.parse(raw) as AttributionLog;
    if (!parsed.records || !Array.isArray(parsed.records)) return emptyLog();
    return parsed;
  } catch {
    return emptyLog();
  }
}

export async function saveAttributionLog(
  log: AttributionLog,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const logPath = getAttributionLogPath(cwd);
  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  try {
    await write(logPath, JSON.stringify(log, null, 2));
  } catch {
    // best-effort — never throws
  }
}

// ── Record ────────────────────────────────────────────────────────────────────

export async function recordAdoptionResult(
  record: AttributionRecord,
  cwd?: string,
  opts?: {
    _fsRead?: (p: string) => Promise<string>;
    _fsWrite?: (p: string, d: string) => Promise<void>;
  },
): Promise<void> {
  const log = await loadAttributionLog(cwd, opts?._fsRead);
  log.records.push(record);
  log.updatedAt = new Date().toISOString();
  await saveAttributionLog(log, cwd, opts?._fsWrite);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export function computePatternROI(patternName: string, log: AttributionLog): number {
  const passing = log.records.filter(
    (r) => r.patternName === patternName && r.verifyStatus === 'pass',
  );
  if (passing.length === 0) return 0;
  const total = passing.reduce((sum, r) => sum + r.scoreDelta, 0);
  return total / passing.length;
}

export function getHighROICategories(log: AttributionLog, minRoi?: number): string[] {
  const threshold = minRoi ?? 0.5;

  // Derive category from patternName prefix before '-'
  const categoryMap = new Map<string, number[]>();
  for (const record of log.records) {
    if (record.verifyStatus !== 'pass') continue;
    const category = record.patternName.includes('-')
      ? record.patternName.split('-')[0]
      : record.patternName;
    const existing = categoryMap.get(category) ?? [];
    existing.push(record.scoreDelta);
    categoryMap.set(category, existing);
  }

  const results: Array<{ category: string; avgRoi: number }> = [];
  for (const [category, deltas] of categoryMap.entries()) {
    const avgRoi = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    if (avgRoi >= threshold) {
      results.push({ category, avgRoi });
    }
  }

  results.sort((a, b) => b.avgRoi - a.avgRoi);
  return results.map((r) => r.category);
}

export function getRollbackSha(
  patternName: string,
  log: AttributionLog,
): string | undefined {
  // Find the most recent record matching this pattern name
  for (let i = log.records.length - 1; i >= 0; i--) {
    const record = log.records[i];
    if (record.patternName === patternName && record.gitSha !== undefined) {
      return record.gitSha;
    }
  }
  return undefined;
}
