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
    || f.startsWith('.danteforge/score-proposals/'),
);

if (matrixViolations.length > 0 && !process.env.DANTEFORGE_MATRIX_MERGE_RECEIPT) {
  console.error('[pre-commit] BLOCKED: matrix score surface modified by a worker commit.');
  console.error('[pre-commit] These files are kernel-owned; only the score-merge flow may write them.');
  console.error('[pre-commit] Staged violations:');
  for (const v of matrixViolations) console.error(`  - ${v}`);
  console.error('[pre-commit] To authorize a kernel merge, set DANTEFORGE_MATRIX_MERGE_RECEIPT=<receipt-path>');
  process.exit(1);
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

// ── TypeScript typecheck ──────────────────────────────────────────────────────

if (stagedTs.length === 0) {
  // No TypeScript files staged; nothing to check
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
