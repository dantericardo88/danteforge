#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Get all staged files (any type)
let allStaged;
let stagedTs;
try {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  });
  allStaged = output.split('\n').filter(Boolean);
  stagedTs = allStaged.filter((f) => f.endsWith('.ts'));
} catch {
  // git not available or not in a repo — skip
  process.exit(0);
}

// ── Fix B: Matrix score-surface guard ────────────────────────────────────────
// Worker agents (dimension-engineer role) must never commit matrix.json or
// sibling score files directly. Only the kernel's score-merge flow may write them.
// If DANTEFORGE_MATRIX_MERGE_RECEIPT is set in the environment, a kernel merge
// is in progress and the write is authorized.
const MATRIX_SCORE_PATTERNS = [
  '.danteforge/compete/matrix.json',
  '.danteforge/compete/COMPETE_REPORT.md',
];

const matrixViolations = allStaged.filter(f =>
  MATRIX_SCORE_PATTERNS.some(p => f === p || f.startsWith('.danteforge/compete/matrix-'))
    || f.startsWith('.danteforge/scores/')
    || f.startsWith('.danteforge/score-proposals/')
    // court-audit #2: outcome-evidence is the trust root the scorer READS — a worker committing
    // hand-authored receipts there forges the factual basis of every derived score. Kernel-owned,
    // same as the score surface (matches MATRIX_SCORE_SURFACE_PATTERNS in matrix/types/agent-evidence.ts).
    || f.startsWith('.danteforge/outcome-evidence/'),
);

if (matrixViolations.length > 0 && !process.env.DANTEFORGE_MATRIX_MERGE_RECEIPT) {
  console.error('[pre-commit] BLOCKED: matrix score surface modified by a worker commit.');
  console.error('[pre-commit] These files are kernel-owned; only the score-merge flow may write them.');
  console.error('[pre-commit] Staged violations:');
  for (const v of matrixViolations) console.error(`  - ${v}`);
  console.error('[pre-commit] To authorize a kernel merge, set DANTEFORGE_MATRIX_MERGE_RECEIPT=<receipt-path>');
  process.exit(1);
}

// ── Phase A: Runtime-evidence guard for matrix.json writes ──────────────────
// If a kernel-authorized commit touches matrix.json, require fresh build evidence
// no older than the matrix change. This blocks score inflation even when the
// merge-receipt env is set, because the merge-receipt itself must be backed by
// an honest probe. See plan §"Phase A — Project-local safety net".
const matrixStaged = allStaged.some(f => f === '.danteforge/compete/matrix.json');
if (matrixStaged && process.env.DANTEFORGE_MATRIX_MERGE_RECEIPT) {
  const evidenceDir = path.join(process.cwd(), '.danteforge', 'runtime-evidence');
  if (!fs.existsSync(evidenceDir)) {
    // CH-024 safe activation: enforce freshness only when runtime-evidence is actually in USE. A project
    // (or the autonomous merge flow) that does not yet produce probe-evidence is NOT blocked — Fix B
    // (kernel merge-receipt required) still gates the write; Phase A adds the freshness layer on top of
    // it where evidence exists. This keeps the guard real without breaking a loop mid-campaign.
    console.warn('[pre-commit] NOTE: matrix.json staged with no .danteforge/runtime-evidence/ — Fix B (merge-receipt) gates this; run `danteforge probe` to add the freshness layer.');
  } else {
  let stagedMatrixMtime;
  try {
    const matrixAbs = path.join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
    stagedMatrixMtime = fs.statSync(matrixAbs).mtimeMs;
  } catch {
    stagedMatrixMtime = Date.now();
  }
  let evidenceFiles = [];
  try {
    evidenceFiles = fs.readdirSync(evidenceDir).filter(f => f.endsWith('.json'));
  } catch {
    evidenceFiles = [];
  }
  const freshEvidence = evidenceFiles.some(f => {
    try {
      const mtime = fs.statSync(path.join(evidenceDir, f)).mtimeMs;
      return mtime >= stagedMatrixMtime - 1000;
    } catch {
      return false;
    }
  });
  if (!freshEvidence) {
    console.error('[pre-commit] BLOCKED: matrix.json staged but no runtime-evidence file is newer than the matrix.');
    console.error('[pre-commit] Run `danteforge probe --tier T1` to refresh build evidence before committing.');
    console.error(`[pre-commit] Evidence dir: ${evidenceDir}`);
    process.exit(1);
  }
  }
}

// ── Fix C: Protected-line guard ───────────────────────────────────────────────
// If a staged file intersects a protected line range recorded in
// .danteforge/protected-lines.json, the commit requires --touches-protected
// in the commit message AND a passing capability_test re-run.
const PROTECTED_LINES_PATH = path.join(process.cwd(), '.danteforge', 'protected-lines.json');
if (fs.existsSync(PROTECTED_LINES_PATH)) {
  let protectedLines;
  try {
    const raw = fs.readFileSync(PROTECTED_LINES_PATH, 'utf8').replace(/^\uFEFF/, '');
    protectedLines = JSON.parse(raw);
  } catch {
    protectedLines = { protections: [] };
  }
  const protections = protectedLines.protections ?? [];

  const commitMsgPath = path.join(process.cwd(), '.git', 'COMMIT_EDITMSG');
  let commitMsg = '';
  try { commitMsg = fs.readFileSync(commitMsgPath, 'utf8'); } catch { /* no message yet */ }

  const touchesFlag = commitMsg.includes('--touches-protected');

  for (const prot of protections) {
    if (!allStaged.some(f => f === prot.file || f.replace(/\\/g, '/') === prot.file)) continue;
    if (!touchesFlag) {
      console.error(`[pre-commit] BLOCKED: "${prot.file}" contains protected lines (dimension: ${prot.dimensionId}).`);
      console.error('[pre-commit] Add "--touches-protected" to your commit message and re-run the capability_test.');
      console.error(`[pre-commit] Protected range: lines ${prot.startLine}–${prot.endLine}`);
      console.error(`[pre-commit] Reason: ${prot.reason ?? 'capability proven by test'}`);
      process.exit(1);
    }
  }
}

// ── Pillar 1: Symbol-level score-write guard ──────────────────────────────────
// Catches any new code path that writes `dim.scores.self = ...` outside the
// modules architecturally permitted to do so. The file-level guard above stops
// matrix.json commits; this catches the upstream bug — writing the in-memory
// matrix without going through the writeScoreProposal → mergeScoreProposals
// chokepoint. Exempt modules:
//   - src/core/compete-matrix.ts: owns the matrix API (derived-score writeback
//     in loadMatrix, legacy applyAdversarialCalibration retained for tests)
//   - src/core/compete-matrix-score.ts: HOME of the reconciler — updateDimensionScore,
//     applyAdversarialCalibration, and clampDimScore all live here and are the
//     sanctioned write path every other module is required to funnel through
//   - src/cli/commands/honest-rescore.ts: writes a CLONE to matrix.honest.json,
//     never to matrix.json
//   - src/core/ascend-engine.ts: strict-override + swe-bench recalibration writes
//     that clamp via clampDimScore inline (cap holds) and intentionally skip
//     sprint_history so recalibration does not masquerade as improvement sprints
// Regex matches ANY variable's `.scores['self'] = ` / `.scores.self = ` assignment
// (not just `dim.`), so a rename like `matDim` cannot smuggle a write past the guard.
// The (?!=) lookahead excludes equality comparisons (===, ==).
const SCORE_WRITE_RE = /\.scores(\['?self'?\]|\.self)\s*=(?!=)/;
const SCORE_WRITE_EXEMPT = new Set([
  'src/core/compete-matrix.ts',
  'src/core/compete-matrix-score.ts',
  'src/cli/commands/honest-rescore.ts',
  'src/core/ascend-engine.ts',
]);
const stagedNonTestTs = stagedTs.filter(f => !f.startsWith('tests/') && !f.includes('/test/') && !/\.test\.ts$/.test(f));
const scoreViolations = [];
for (const f of stagedNonTestTs) {
  const normalized = f.replace(/\\/g, '/');
  if (SCORE_WRITE_EXEMPT.has(normalized)) continue;
  let content = '';
  try { content = fs.readFileSync(path.join(process.cwd(), f), 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (SCORE_WRITE_RE.test(lines[i])) {
      scoreViolations.push(`  ${normalized}:${i + 1}  ${lines[i].trim()}`);
    }
  }
}
if (scoreViolations.length > 0) {
  console.error('[pre-commit] BLOCKED: direct writes to dim.scores.self outside the reconciler.');
  console.error('[pre-commit] Score changes must flow through writeScoreProposal → mergeScoreProposals.');
  console.error('[pre-commit] Violations:');
  for (const v of scoreViolations) console.error(v);
  console.error('[pre-commit] Exempt files: src/core/compete-matrix.ts (matrix API), src/cli/commands/honest-rescore.ts (clone-only).');
  process.exit(1);
}

// ── Pillar 2: Zero-tolerance stub/mock/TODO guard ──────────────────────────────
// Depth doctrine: No mocks. No stubs. No TODOs. Code without receipts is a
// hypothesis, not a feature. Blocks any commit that introduces these patterns
// into src/ TypeScript files. Tests may use mocking frameworks in test files
// (*.test.ts) — but production src/ files must not.
const STUB_PATTERNS = [
  { re: /\/\/\s*(TODO|FIXME|XXX)(\b|:)/i, label: 'TODO/FIXME comment' },
  { re: /throw\s+new\s+Error\s*\(\s*['"`].*not\s+implemented.*['"`]\s*\)/i, label: 'not-implemented throw' },
  { re: /throw\s+new\s+Error\s*\(\s*['"`]\s*TODO\b/i, label: 'TODO throw' },
  { re: /\bjest\.mock\s*\(/, label: 'jest.mock() in production code' },
  { re: /\bvi\.mock\s*\(/, label: 'vi.mock() in production code' },
  { re: /\bsinon\.stub\s*\(/, label: 'sinon.stub() in production code' },
  { re: /\bsinon\.mock\s*\(/, label: 'sinon.mock() in production code' },
];

// Only scan production src/ files, not test files
const stagedSrcTs = stagedTs.filter(f => {
  const norm = f.replace(/\\/g, '/');
  return norm.startsWith('src/') && !norm.endsWith('.test.ts') && !norm.endsWith('.spec.ts') && !norm.includes('/test/');
});

const stubViolations = [];
for (const f of stagedSrcTs) {
  let content = '';
  try { content = fs.readFileSync(path.join(process.cwd(), f), 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { re, label } of STUB_PATTERNS) {
      if (re.test(line)) {
        stubViolations.push(`  ${f.replace(/\\/g, '/')}:${i + 1}  [${label}]  ${line.trim()}`);
        break;
      }
    }
  }
}
if (stubViolations.length > 0) {
  console.error('[pre-commit] BLOCKED (zero-tolerance): stub/mock/TODO patterns in production src/ files.');
  console.error('[pre-commit] No mocks. No stubs. No TODOs. Code without receipts is a hypothesis.');
  console.error('[pre-commit] Violations:');
  for (const v of stubViolations) console.error(v);
  console.error('[pre-commit] Fix: implement the real thing, or write a capability_test that fails cleanly.');
  process.exit(1);
}

// ── TypeScript typecheck ──────────────────────────────────────────────────────

if (stagedTs.length === 0) {
  // No TypeScript files staged; nothing to check
  process.exit(0);
}

// The security guards above are the integrity core (CH-024) and always run. The full-project typecheck
// is correctness-not-integrity and is slow on every commit — let a fast workflow opt out of just this
// step (CI/verify still typechecks). The guards above are NOT skippable.
if (process.env.DANTEFORGE_SKIP_PRECOMMIT_TSC === '1') {
  console.log('[pre-commit] DANTEFORGE_SKIP_PRECOMMIT_TSC=1 — skipping typecheck (security guards still ran).');
  process.exit(0);
}

console.log(`[pre-commit] Typechecking ${stagedTs.length} staged .ts file(s)...`);

try {
  execFileSync('npx', ['tsc', '--noEmit'], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
} catch (err) {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
    // tsc / npx not available — skip gracefully
    console.warn('[pre-commit] tsc not available, skipping typecheck.');
    process.exit(0);
  }
  console.error('[pre-commit] TypeScript typecheck failed. Fix errors before committing.');
  process.exit(1);
}

console.log('[pre-commit] Typecheck passed.');
process.exit(0);
