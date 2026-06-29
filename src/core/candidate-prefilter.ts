// candidate-prefilter.ts — Layer 1 of the three-layer measured scoring loop (COMPILOT's cheap, deterministic
// pre-filter that runs BEFORE any expensive compiler/test interaction). A candidate diff is killed here, fast
// and for free, if it: (1) touches the score/trust surface (Ornith's immutable trust boundary — a builder may
// not grade its own exam), (2) blows the file-size hard cap, or (3) trips the anti-stub scanner.
//
// This composes existing scanners rather than re-authoring them: the anti-stub `scanContent`, the score-
// surface globs (MATRIX_SCORE_SURFACE_PATTERNS), and the shared glob matcher. Pure given file contents, so it
// is fully unit-testable and orders-of-magnitude cheaper than Layer 2 (running the suite).

import { scanContent } from '../matrix/courts/no-stub-scanner.js';
import { MATRIX_SCORE_SURFACE_PATTERNS } from '../matrix/types/agent-evidence.js';
import { matchesAnyGlob } from '../matrix/util/glob.js';
import { SUPERVISOR_STATE_FILE } from './supervisor-state.js';

/** The file-size hard cap from the project standard (CLAUDE.md). */
export const FILE_SIZE_HARD_CAP = 750;

/** Paths a build candidate may NEVER touch — the trust boundary. Score surfaces (the kernel owns scores),
 *  supervisor campaign state, and the protected-line ledger. Reused by the P3 deterministic reward monitor. */
export const SUPERVISOR_TRUST_PATTERNS: readonly string[] = [
  ...MATRIX_SCORE_SURFACE_PATTERNS,
  SUPERVISOR_STATE_FILE,
  '.danteforge/protected-lines.json',
];

export interface ChangedFile {
  /** Repo-relative path (forward slashes). */
  path: string;
  content: string;
}

export type PrefilterCheck = 'forbidden-path' | 'file-size' | 'stub';

export interface PrefilterFinding {
  check: PrefilterCheck;
  path: string;
  detail: string;
}

export interface PrefilterResult {
  pass: boolean;
  findings: PrefilterFinding[];
}

/** Non-blank LOC — the metric the file-size standard and scoreMaintainability use. */
export function nonBlankLoc(content: string): number {
  return content.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

/** Which of the given paths touch the trust/score surface (empty = none). Shared with the P3 monitor. */
export function touchesTrustSurface(paths: string[]): string[] {
  return paths.filter((p) => matchesAnyGlob(p.replace(/\\/g, '/'), [...SUPERVISOR_TRUST_PATTERNS]));
}

/**
 * Run the Layer-1 cheap pre-filter over a candidate's changed files. Fail-fast and deterministic — no
 * subprocess, no compiler. A failing candidate is dropped before Layer 2 ever runs.
 */
export function prefilterCandidate(files: ChangedFile[], hardCap: number = FILE_SIZE_HARD_CAP): PrefilterResult {
  const findings: PrefilterFinding[] = [];

  // 1. Trust boundary — the most important and cheapest check.
  for (const p of touchesTrustSurface(files.map((f) => f.path))) {
    findings.push({ check: 'forbidden-path', path: p, detail: 'candidate touches the score/trust surface — forbidden (kernel owns scores)' });
  }

  for (const f of files) {
    if (!f.path.endsWith('.ts') && !f.path.endsWith('.tsx')) continue;
    // 2. File-size hard cap.
    const loc = nonBlankLoc(f.content);
    if (loc > hardCap) {
      findings.push({ check: 'file-size', path: f.path, detail: `${loc} non-blank LOC exceeds the ${hardCap} hard cap` });
    }
    // 3. Anti-stub scan (reuses scanContent over the changed file).
    for (const s of scanContent(f.path, f.content)) {
      findings.push({ check: 'stub', path: f.path, detail: `${s.kind} at line ${s.line}: ${s.snippet}` });
    }
  }

  return { pass: findings.length === 0, findings };
}
