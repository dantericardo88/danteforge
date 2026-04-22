// Share Patterns — exports anonymised attribution data as a portable bundle.
// Lets teams share proven pattern efficacy without exposing project internals.
// The receiving project imports via `danteforge import-patterns`.
//
// Anonymisation: project name is hashed (not stored), only aggregate statistics
// are exported (avgScoreDelta, verifyPassRate, sampleCount) — no raw code or paths.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '../../core/logger.js';
import { loadAttributionLog, type AttributionLog } from '../../core/causal-attribution.js';
import { loadRefusedPatterns, type RefusedPatternsStore } from '../../core/refused-patterns.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SharedPatternStats {
  patternName: string;
  sourceRepo: string;
  /** Average score improvement per adoption (pass records only). */
  avgScoreDelta: number;
  /** Fraction of adoptions that passed verify (0-1). */
  verifyPassRate: number;
  /** How many adoption records this is based on. */
  sampleCount: number;
  /** Fraction of outcome-check hypotheses that were validated (0-1). -1 if none. */
  hypothesisValidationRate: number;
}

export interface SharedPatternBundle {
  version: '1.0.0';
  exportedAt: string;
  /** SHA-256 of the project name — preserves anonymity while allowing dedup. */
  sourceProjectHash: string;
  patterns: SharedPatternStats[];
  /** Pattern names on the refused list — receivers should also avoid these. */
  refusedPatternNames: string[];
}

export interface SharePatternsOptions {
  cwd?: string;
  /** Min sampleCount to include a pattern. Default 1. */
  minSamples?: number;
  /** Inject for testing */
  _loadAttributionLog?: (cwd?: string) => Promise<AttributionLog>;
  _loadRefusedPatterns?: (cwd?: string) => Promise<RefusedPatternsStore>;
  _writeBundle?: (filePath: string, content: string) => Promise<void>;
  _getProjectName?: (cwd: string) => Promise<string>;
}

export interface SharePatternsResult {
  bundle: SharedPatternBundle;
  bundlePath: string;
  patternCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getProjectName(cwd: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function hashProjectName(name: string): string {
  return createHash('sha256').update(name).digest('hex').slice(0, 16);
}

function computePatternStats(
  log: AttributionLog,
  minSamples: number,
): SharedPatternStats[] {
  // Group records by patternName
  const groups = new Map<string, Array<(typeof log.records)[number]>>();
  for (const record of log.records) {
    const existing = groups.get(record.patternName) ?? [];
    existing.push(record);
    groups.set(record.patternName, existing);
  }

  const stats: SharedPatternStats[] = [];
  for (const [patternName, records] of groups.entries()) {
    if (records.length < minSamples) continue;

    const passing = records.filter(r => r.verifyStatus === 'pass');
    const avgScoreDelta = passing.length > 0
      ? passing.reduce((sum, r) => sum + r.scoreDelta, 0) / passing.length
      : 0;
    const verifyPassRate = records.length > 0
      ? passing.length / records.length
      : 0;

    // Hypothesis validation rate from extended outcome fields persisted by outcome-check.
    // These fields are written back to attribution-log.json as open-ended properties.
    type RecordWithOutcome = (typeof records)[number] & { hypothesisValidated?: boolean };
    const withHypothesis = (records as RecordWithOutcome[]).filter(
      r => r.outcomeHypothesis !== undefined,
    );
    const validated = withHypothesis.filter(r => r.hypothesisValidated === true);
    const hypothesisValidationRate = withHypothesis.length > 0
      ? validated.length / withHypothesis.length
      : -1;

    const sourceRepo = records[records.length - 1]?.sourceRepo ?? '';

    stats.push({ patternName, sourceRepo, avgScoreDelta, verifyPassRate, sampleCount: records.length, hypothesisValidationRate });
  }

  return stats.sort((a, b) => b.avgScoreDelta - a.avgScoreDelta);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runSharePatterns(
  opts: SharePatternsOptions = {},
): Promise<SharePatternsResult> {
  const cwd = opts.cwd ?? process.cwd();
  const minSamples = opts.minSamples ?? 1;

  const loadLog = opts._loadAttributionLog ?? loadAttributionLog;
  const loadRefused = opts._loadRefusedPatterns ?? loadRefusedPatterns;
  const writeBundle = opts._writeBundle ?? (async (p, c) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, c, 'utf8');
  });
  const getProject = opts._getProjectName ?? getProjectName;

  const [log, refusedStore, projectName] = await Promise.all([
    loadLog(cwd),
    loadRefused(cwd),
    getProject(cwd),
  ]);

  const patterns = computePatternStats(log, minSamples);
  const refusedPatternNames = refusedStore.patterns.map(p => p.patternName);

  const bundle: SharedPatternBundle = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    sourceProjectHash: hashProjectName(projectName),
    patterns,
    refusedPatternNames,
  };

  const filename = `shared-patterns-${Date.now()}.json`;
  const bundlePath = path.join(cwd, '.danteforge', filename);
  await writeBundle(bundlePath, JSON.stringify(bundle, null, 2));

  logger.info(`[share-patterns] Exported ${patterns.length} pattern(s) to ${path.relative(cwd, bundlePath)}`);
  if (refusedPatternNames.length > 0) {
    logger.info(`[share-patterns] Included ${refusedPatternNames.length} refused pattern name(s) for downstream filtering`);
  }

  return { bundle, bundlePath, patternCount: patterns.length };
}
