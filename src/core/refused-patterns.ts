// Refused Patterns — a blocklist of patterns proven not to work.
// When outcome-check falsifies a hypothesis (laggingDelta ≤ 0), the pattern is
// added here so OSS-intel never re-suggests it in future adoption queues.
//
// Pattern derived from danger/danger-js: failed experiments are attributed to a
// specific boundary and recorded so they cannot silently recur.

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RefuseReason = 'hypothesis-falsified' | 'verify-failed' | 'manual';

export interface RefusedPattern {
  patternName: string;
  sourceRepo: string;
  refusedAt: string;          // ISO timestamp
  reason: RefuseReason;
  /** The outcome hypothesis that was falsified (if applicable). */
  hypothesis?: string;
  /** Lagging score delta observed at outcome-check time. */
  laggingDelta?: number;
}

export interface RefusedPatternsStore {
  version: '1.0.0';
  patterns: RefusedPattern[];
  updatedAt: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

export function getRefusedPatternsPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'refused-patterns.json');
}

function emptyStore(): RefusedPatternsStore {
  return { version: '1.0.0', patterns: [], updatedAt: new Date().toISOString() };
}

// ── I/O ───────────────────────────────────────────────────────────────────────

export async function loadRefusedPatterns(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<RefusedPatternsStore> {
  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(getRefusedPatternsPath(cwd));
    const parsed = JSON.parse(raw) as RefusedPatternsStore;
    if (!Array.isArray(parsed.patterns)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function saveRefusedPatterns(
  store: RefusedPatternsStore,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const filePath = getRefusedPatternsPath(cwd);
  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  try {
    await write(filePath, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2));
  } catch {
    // best-effort — never throws
  }
}

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Add a pattern to the refused list. Idempotent — if the pattern is already
 * refused for any reason, the existing entry is kept and no duplicate is added.
 */
export async function addRefusedPattern(
  entry: RefusedPattern,
  cwd?: string,
  opts?: {
    _fsRead?: (p: string) => Promise<string>;
    _fsWrite?: (p: string, d: string) => Promise<void>;
  },
): Promise<void> {
  const store = await loadRefusedPatterns(cwd, opts?._fsRead);
  const alreadyRefused = store.patterns.some(p => p.patternName === entry.patternName);
  if (alreadyRefused) return; // idempotent

  store.patterns.push(entry);
  await saveRefusedPatterns(store, cwd, opts?._fsWrite);
}

/**
 * Check whether a pattern name is on the refused list.
 * Case-sensitive exact match — same as the adoption queue uses.
 */
export function isPatternRefused(
  patternName: string,
  store: RefusedPatternsStore,
): boolean {
  return store.patterns.some(p => p.patternName === patternName);
}

/**
 * Build the "REFUSED PATTERNS" section injected into OSS-intel LLM prompts
 * so the model never re-suggests rejected work.
 */
export function buildRefusedPatternsPromptSection(store: RefusedPatternsStore): string {
  if (store.patterns.length === 0) return '';

  const lines = [
    '## REFUSED PATTERNS (do not suggest or re-adopt)',
    'These patterns were adopted, validated, and subsequently found to produce no lasting improvement.',
    'Do NOT include them in any adoption queue or recommendation.',
    '',
    ...store.patterns.map(p => {
      const reason = p.reason === 'hypothesis-falsified'
        ? `Hypothesis falsified (lagging delta: ${p.laggingDelta?.toFixed(2) ?? 'unknown'})`
        : p.reason === 'verify-failed'
          ? 'Failed verify gate'
          : 'Manually refused';
      return `- ${p.patternName} (${p.sourceRepo}) — ${reason}`;
    }),
  ];

  return lines.join('\n');
}

/**
 * Remove a pattern from the refused list (e.g., if circumstances have changed).
 * Returns true if a pattern was removed, false if it was not found.
 */
export async function removeRefusedPattern(
  patternName: string,
  cwd?: string,
  opts?: {
    _fsRead?: (p: string) => Promise<string>;
    _fsWrite?: (p: string, d: string) => Promise<void>;
  },
): Promise<boolean> {
  const store = await loadRefusedPatterns(cwd, opts?._fsRead);
  const before = store.patterns.length;
  store.patterns = store.patterns.filter(p => p.patternName !== patternName);
  if (store.patterns.length === before) return false;
  await saveRefusedPatterns(store, cwd, opts?._fsWrite);
  return true;
}
