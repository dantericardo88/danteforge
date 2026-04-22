// harvest-pattern — Focused OSS pattern harvesting with Y/N confirmation loop.
// Usage: danteforge harvest-pattern "error boundary pattern"
// Searches top OSS repos, presents one pattern gap at a time, implements on Y.
// --url flag bypasses GitHub search to target a specific repo directly.
// Always writes a harvest receipt to .danteforge/evidence/oss-harvest.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { appendLesson } from './lessons.js';
import type { HarshScorerOptions, HarshScoreResult, ScoringDimension } from '../../core/harsh-scorer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OSSRepo {
  name: string;
  url: string;
  stars: number;
  language: string;
}

export interface PatternGap {
  description: string;
  sourceRepo: string;
  sourceFile: string;
  sourceLine?: number;
  estimatedDimension: ScoringDimension;
  estimatedGain: number;   // 0.0-1.0
}

export interface ImplementResult {
  success: boolean;
  filesChanged: string[];
  scoreDelta?: number;
}

/**
 * Harvest receipt — written after every harvest attempt, regardless of outcome.
 * Status 'no-harvest' means nothing was implemented (0 repos found or 0 gaps implemented).
 * Status 'partial' means some gaps were presented but not all were implemented.
 * Status 'complete' means at least one gap was implemented.
 */
export interface OSSHarvestReceipt {
  timestamp: string;
  pattern: string;
  url?: string;
  reposFound: number;
  reposLanguages: string[];
  gapsPresented: number;
  gapsImplemented: number;
  beforeScore: number | null;
  afterScore: number | null;
  beforeGitSha: string | null;
  afterGitSha: string | null;
  status: 'no-harvest' | 'partial' | 'complete';
  notes: string[];
}

export interface HarvestPatternOptions {
  pattern: string;
  cwd?: string;
  maxRepos?: number;
  /** Target a specific GitHub repo URL directly — bypasses GitHub search. */
  url?: string;
  // Injection seams
  _searchRepos?: (query: string, maxRepos: number) => Promise<OSSRepo[]>;
  _extractGaps?: (repo: OSSRepo, cwd: string) => Promise<PatternGap[]>;
  _implementPattern?: (gap: PatternGap, cwd: string) => Promise<ImplementResult>;
  _harshScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
  _appendLesson?: (entry: string, cwd?: string) => Promise<void>;
  _confirm?: (message: string) => Promise<boolean>;
  _stdout?: (line: string) => void;
  /** Injection seam: write receipt to .danteforge/evidence/oss-harvest.json */
  _writeReceipt?: (cwd: string, receipt: OSSHarvestReceipt) => Promise<void>;
  /** Injection seam: get current git SHA */
  _getGitSha?: (cwd: string) => Promise<string | null>;
  /** Injection seam: get initial score before harvest */
  _initialScore?: (cwd: string) => Promise<number | null>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function harvestPattern(options: HarvestPatternOptions): Promise<void> {
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  const cwd = options.cwd ?? process.cwd();
  const maxRepos = options.maxRepos ?? 5;

  const searchRepos = options._searchRepos ?? defaultSearchRepos;
  const extractGaps = options._extractGaps ?? defaultExtractGaps;
  const implementPattern = options._implementPattern ?? defaultImplementPattern;
  const harshScoreFn = options._harshScore ?? defaultHarshScore;
  const appendLessonFn = options._appendLesson ?? appendLesson;
  const confirmFn = options._confirm ?? defaultConfirm;
  const writeReceiptFn = options._writeReceipt ?? defaultWriteReceipt;
  const getGitShaFn = options._getGitSha ?? defaultGetGitSha;
  const initialScoreFn = options._initialScore ?? defaultInitialScore;

  // Capture before-state for receipt
  const beforeGitSha = await getGitShaFn(cwd).catch(() => null);
  const beforeScore = await initialScoreFn(cwd).catch(() => null);

  const receiptNotes: string[] = [];
  let repos: OSSRepo[];

  emit('');

  if (options.url) {
    // --url mode: bypass GitHub search, target specific repo directly
    const urlStr = options.url;
    const name = urlStr.replace(/^.*github\.com\//, '').replace(/\/$/, '');
    repos = [{ name, url: urlStr, stars: 0, language: 'unknown' }];
    emit(`  Targeting repo directly: ${urlStr}`);
    receiptNotes.push(`--url mode: targeted ${urlStr} directly, bypassed GitHub search`);
  } else {
    emit(`  Searching for OSS implementations of: "${options.pattern}"`);
    repos = await searchRepos(options.pattern, maxRepos);
    emit(`  Found ${repos.length} repo${repos.length !== 1 ? 's' : ''}.`);
  }

  emit('');

  // Collect all gaps across repos
  const allGaps: PatternGap[] = [];
  for (const repo of repos) {
    const gaps = await extractGaps(repo, cwd);
    allGaps.push(...gaps);
  }

  const reposLanguages = repos.map(r => r.language);

  if (allGaps.length === 0) {
    if (repos.length === 0) {
      receiptNotes.push(`GitHub search returned 0 repos for "${options.pattern}" (TypeScript only, >100 stars). Use --url to target a specific repo.`);
    }
    emit('  No actionable gaps found — your project may already implement this pattern.');
    if (repos.length === 0) {
      emit('  Tip: use --url <github-url> to target a specific repo directly.');
      receiptNotes.push('No repos found — cannot extract gaps without a target repo.');
    } else {
      receiptNotes.push('extractGaps returned 0 gaps — no LLM available or project already implements pattern.');
    }
    emit('');

    // Always write a receipt even on failure
    const receipt: OSSHarvestReceipt = {
      timestamp: new Date().toISOString(),
      pattern: options.pattern,
      url: options.url,
      reposFound: repos.length,
      reposLanguages,
      gapsPresented: 0,
      gapsImplemented: 0,
      beforeScore,
      afterScore: beforeScore, // no change
      beforeGitSha,
      afterGitSha: beforeGitSha, // no change
      status: 'no-harvest',
      notes: receiptNotes,
    };
    await writeReceiptFn(cwd, receipt).catch(() => { /* best-effort */ });
    return;
  }

  // Sort by estimated gain descending
  allGaps.sort((a, b) => b.estimatedGain - a.estimatedGain);

  emit(`  Found ${allGaps.length} gap${allGaps.length !== 1 ? 's' : ''} — sorted by estimated impact.`);
  emit('');

  let implemented = 0;
  let presented = 0;

  for (const gap of allGaps) {
    presented++;
    emit(`  Pattern: ${gap.description}`);
    emit(`  Source:  ${gap.sourceRepo} → ${gap.sourceFile}${gap.sourceLine !== undefined ? `:${gap.sourceLine}` : ''}`);
    emit(`  Dimension: ${gap.estimatedDimension}  |  Est. gain: +${(gap.estimatedGain * 10).toFixed(1)}`);

    const yes = await confirmFn(`  Implement this pattern? (Y/n)`);
    if (!yes) {
      emit('  Skipped.');
      emit('');
      continue;
    }

    emit('  Implementing...');
    const result = await implementPattern(gap, cwd);

    if (result.success) {
      // Score delta
      let deltaStr = '';
      try {
        const scoreResult = await harshScoreFn({ cwd });
        deltaStr = `  Score: ${scoreResult.displayScore.toFixed(1)}/10`;
      } catch {
        // best-effort
      }

      const timestamp = new Date().toISOString().slice(0, 10);
      const entry = [
        `## ${timestamp} | ${gap.estimatedDimension} | important`,
        `Rule: ${gap.description}`,
        `Context: Harvested from ${gap.sourceRepo} via \`danteforge harvest-pattern\``,
        `Tags: harvest, oss-pattern, ${gap.estimatedDimension}`,
        '',
      ].join('\n');
      await appendLessonFn(entry, cwd);

      emit(`  Implemented — ${result.filesChanged.length} file${result.filesChanged.length !== 1 ? 's' : ''} changed.`);
      if (deltaStr) emit(deltaStr);
      emit('  Lesson captured.');
      implemented++;
    } else {
      emit('  Implementation failed — skipping.');
    }
    emit('');
  }

  emit(`  Done — ${implemented} pattern${implemented !== 1 ? 's' : ''} implemented.`);
  emit('');

  // Capture after-state for receipt
  const afterGitSha = await getGitShaFn(cwd).catch(() => null);
  const afterScore = implemented > 0
    ? await initialScoreFn(cwd).catch(() => null)
    : beforeScore;

  const status: OSSHarvestReceipt['status'] =
    implemented === 0 ? 'no-harvest' :
    implemented < presented ? 'partial' :
    'complete';

  if (implemented === 0 && presented > 0) {
    receiptNotes.push('Gaps were presented but none were implemented (all declined or failed).');
  }

  const receipt: OSSHarvestReceipt = {
    timestamp: new Date().toISOString(),
    pattern: options.pattern,
    url: options.url,
    reposFound: repos.length,
    reposLanguages,
    gapsPresented: presented,
    gapsImplemented: implemented,
    beforeScore,
    afterScore,
    beforeGitSha,
    afterGitSha,
    status,
    notes: receiptNotes,
  };

  await writeReceiptFn(cwd, receipt).catch(() => { /* best-effort */ });
}

// ── Defaults (production-wired) ───────────────────────────────────────────────

/** Search GitHub for repos matching the pattern query. No auth required (60 req/hr). */
async function defaultSearchRepos(query: string, maxRepos: number): Promise<OSSRepo[]> {
  try {
    const encoded = encodeURIComponent(`${query} language:typescript stars:>100`);
    const url = `https://api.github.com/search/repositories?q=${encoded}&sort=stars&order=desc&per_page=${maxRepos}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'danteforge/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      items?: Array<{ name: string; html_url: string; stargazers_count: number; language: string }>;
    };
    return (data.items ?? []).map(r => ({
      name: r.name,
      url: r.html_url,
      stars: r.stargazers_count,
      language: r.language ?? 'unknown',
    }));
  } catch {
    return [];
  }
}

/** Use LLM to identify gaps between a repo's patterns and the current project. */
async function defaultExtractGaps(repo: OSSRepo, cwd: string): Promise<PatternGap[]> {
  try {
    const { callLLM } = await import('../../core/llm.js');
    const { loadState } = await import('../../core/state.js');
    const state = await loadState({ cwd }).catch(() => ({})) as { project?: string };
    const project = state.project ?? 'this project';
    const prompt = [
      `You are a code quality analyst. Identify 1–3 actionable patterns from the OSS repo "${repo.name}" (${repo.url})`,
      `that are missing from "${project}".`,
      ``,
      `Return a JSON array (no markdown fences) with this shape for each gap:`,
      `[{"description":"<what the pattern does>","sourceRepo":"${repo.name}","sourceFile":"<best-guess filename>","estimatedDimension":"<one of: functionality|testing|errorHandling|security|uxPolish|documentation|performance|maintainability>","estimatedGain":<0.0–1.0>}]`,
      ``,
      `Return only the JSON array. If there are no relevant gaps, return [].`,
    ].join('\n');
    const raw = await callLLM(prompt);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1)) as PatternGap[];
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch {
    return [];
  }
}

/** Run a magic cycle with the gap description as the goal. The goal string flows into
 *  the LLM context so the implementation is targeted at this specific pattern. */
async function defaultImplementPattern(gap: PatternGap, _cwd: string): Promise<ImplementResult> {
  try {
    const { magic } = await import('./magic.js');
    const goal = `Implement "${gap.description}" — ${gap.estimatedDimension} pattern from ${gap.sourceRepo}`;
    await magic(goal, { profile: 'balanced' });
    return { success: true, filesChanged: [] };
  } catch {
    return { success: false, filesChanged: [] };
  }
}

async function defaultHarshScore(opts: HarshScorerOptions): Promise<HarshScoreResult> {
  const { computeHarshScore } = await import('../../core/harsh-scorer.js');
  return computeHarshScore(opts);
}

async function defaultConfirm(_message: string): Promise<boolean> {
  // Non-TTY: default to false (safe). TTY: prompt via stdin.
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question('Implement this pattern? [Y/n] ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

/**
 * Write receipt to .danteforge/evidence/oss-harvest.json.
 * Creates the directory if it doesn't exist. Overwrites any previous receipt
 * for this session (last-write-wins, consistent with how score history works).
 */
export async function defaultWriteReceipt(cwd: string, receipt: OSSHarvestReceipt): Promise<void> {
  const evidenceDir = path.join(cwd, '.danteforge', 'evidence');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(
    path.join(evidenceDir, 'oss-harvest.json'),
    JSON.stringify(receipt, null, 2),
    'utf8',
  );
}

export async function defaultGetGitSha(cwd: string): Promise<string | null> {
  try {
    const { execSync } = await import('node:child_process');
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export async function defaultInitialScore(cwd: string): Promise<number | null> {
  try {
    const { computeHarshScore } = await import('../../core/harsh-scorer.js');
    const result = await computeHarshScore({
      cwd,
      _readHistory: async () => [],
      _writeHistory: async () => {},
    });
    return result.displayScore;
  } catch {
    return null;
  }
}
