#!/usr/bin/env node
/**
 * check-file-size.mjs
 *
 * Enforces a hard 750-LOC ceiling on every TypeScript source file.
 * The ideal target is 500 LOC (non-blank, non-comment lines); above that the
 * file gets a WARNING.  Above 750 it is a hard ERROR and the script exits 1
 * so verify:all and CI fail.
 *
 * Why these thresholds?
 *   500 LOC  — practical limit where a single file stays graspable for an LLM
 *              in one context window without risk of reasoning errors.
 *   750 LOC  — hard ceiling; beyond this LLMs reliably make structural mistakes
 *              (missing imports, wrong function scope, stale variable names).
 *
 * Skips: dist/, node_modules/, coverage/, *.d.ts, *.test.ts (tests are allowed
 * to be longer since they are read linearly, not modified holistically).
 *
 * Usage:
 *   node scripts/check-file-size.mjs          # check src/ and packages/
 *   node scripts/check-file-size.mjs --warn-only  # report but always exit 0
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';

const WARN_THRESHOLD = 500;
const HARD_THRESHOLD = 750;
const WARN_ONLY = process.argv.includes('--warn-only');

const ROOT = process.cwd();

// Load grandfathered pre-existing violations — these are technical debt entries
// that existed before the LOC standard. Do not add new files here.
function loadAllowlist(root) {
  const allowlistPath = join(root, '.file-size-allowlist');
  if (!existsSync(allowlistPath)) return new Set();
  return new Set(
    readFileSync(allowlistPath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
  );
}

const ALLOWLIST = loadAllowlist(ROOT);
const SCAN_DIRS = ['src', 'packages'].map(d => join(ROOT, d));
const SKIP_PATTERNS = [
  /node_modules/,
  /dist\//,
  /coverage\//,
  /\.d\.ts$/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
];

function shouldSkip(filePath) {
  return SKIP_PATTERNS.some(p => p.test(filePath.replace(/\\/g, '/')));
}

function countLines(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  let count = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
      inBlockComment = !trimmed.includes('*/');
      continue;
    }
    if (trimmed.startsWith('//') || trimmed === '') continue;
    count++;
  }
  return count;
}

function collectTs(dir) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectTs(full));
    } else if (extname(full) === '.ts' && !shouldSkip(full)) {
      results.push(full);
    }
  }
  return results;
}

const files = SCAN_DIRS.flatMap(collectTs);

let errors = 0;
let warnings = 0;
const errorLines = [];
const warnLines = [];

const grandfathered = [];

for (const file of files) {
  const loc = countLines(file);
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const isGrandfathered = ALLOWLIST.has(rel);

  if (loc > HARD_THRESHOLD) {
    if (isGrandfathered) {
      grandfathered.push(`  LEGACY ${loc.toString().padStart(5)} LOC  ${rel}`);
    } else {
      errors++;
      errorLines.push(`  ERROR  ${loc.toString().padStart(5)} LOC  ${rel}`);
    }
  } else if (loc > WARN_THRESHOLD) {
    warnings++;
    warnLines.push(`  WARN   ${loc.toString().padStart(5)} LOC  ${rel}`);
  }
}

const total = files.length;
console.log(`\nDanteForge file-size check — ${total} source files scanned`);
console.log(`  Ideal cap  : ${WARN_THRESHOLD} LOC (non-blank, non-comment lines)`);
console.log(`  Hard limit : ${HARD_THRESHOLD} LOC\n`);

if (warnLines.length > 0) {
  console.log(`Warnings (${warnLines.length} file(s) between ${WARN_THRESHOLD}–${HARD_THRESHOLD} LOC):`);
  warnLines.forEach(l => console.log(l));
  console.log();
}

if (grandfathered.length > 0) {
  console.log(`Grandfathered legacy files (${grandfathered.length} pre-existing — split when you touch them):`);
  grandfathered.forEach(l => console.log(l));
  console.log();
}

if (errorLines.length > 0) {
  console.log(`Errors (${errorLines.length} NEW file(s) exceed ${HARD_THRESHOLD} LOC — MUST be split before merge):`);
  errorLines.forEach(l => console.log(l));
  console.log();
}

if (errors === 0 && warnings === 0 && grandfathered.length === 0) {
  console.log('All files within limits. ');
} else if (errors === 0) {
  console.log('No new violations. ');
}

if (errors > 0 && !WARN_ONLY) {
  console.log(`FAIL — ${errors} file(s) exceed the ${HARD_THRESHOLD}-LOC hard limit.`);
  console.log('Split each into focused sub-modules (each ≤500 LOC).\n');
  process.exit(1);
}

if (errors > 0 && WARN_ONLY) {
  console.log(`(warn-only mode — ${errors} hard-limit violation(s) not enforced)\n`);
}

process.exit(0);
