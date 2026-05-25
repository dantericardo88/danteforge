// Matrix Kernel — Diff-Aware Test Selection
//
// Given a list of changed source files (a lease's blast radius), select the
// subset of `tests/**/*.test.ts` that should run to validate the diff.
// Reduces verify-court's `npm test` from a 5-minute full-suite invocation
// to a focused 20-60 second invocation that catches the regressions the
// lease could have actually caused.
//
// Strategy:
//   1. Direct match — for each changed source file `src/x/y/foo.ts`, find
//      tests/foo.test.ts, tests/foo-*.test.ts, tests/x/y/foo.test.ts.
//   2. Import-graph match — find tests that explicitly import any of the
//      changed source files (regex-scan the test file's contents).
//   3. Always-run override — union with the `alwaysRun` patterns from
//      verify-test-config (matrix-golden-flow, command-skill-coverage,
//      anything else the project declares as load-bearing).
//
// Safety bias: when in doubt, INCLUDE a test. The cost of running an extra
// test is much smaller than the cost of missing a regression. We deliberately
// don't try to be clever about transitive imports — basename + direct-import
// covers the common case; integration tests fall through the always-run net.

import fs from 'node:fs/promises';
import path from 'node:path';
import { matchesGlob } from '../util/glob.js';

const TESTS_ROOT = 'tests';

export interface SelectTestsOptions {
  /** Changed source files relative to repo root (e.g. ['src/core/foo.ts']). */
  changedFiles: string[];
  /** Project root. */
  cwd?: string;
  /** Always-run patterns from verify-test-config (file paths or globs). */
  alwaysRun?: string[];
  /** Injection seam: override the test-file discovery for tests. */
  _listTests?: (cwd: string) => Promise<string[]>;
  /** Injection seam: override the test-content reader for import-graph matching. */
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>;
}

/**
 * Pick the tests to run for a lease's diff. Returns paths relative to cwd,
 * suitable for passing to `npx tsx --test <files>`.
 */
export async function selectTestsForDiff(options: SelectTestsOptions): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const listTests = options._listTests ?? defaultListTests;
  const read = options._readFile ?? ((p: string, enc: BufferEncoding) => fs.readFile(p, enc) as Promise<string>);
  const alwaysRun = options.alwaysRun ?? [];

  const allTests = await listTests(cwd);
  if (options.changedFiles.length === 0) {
    // No diff (or all diff is non-source) → just always-run.
    return resolveAlwaysRun(allTests, alwaysRun);
  }

  const selected = new Set<string>();

  // (1) Direct basename match — most common case.
  const changedBasenames = new Set(
    options.changedFiles
      .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
      .map(f => path.basename(f, '.ts')),
  );

  for (const test of allTests) {
    const testBase = path.basename(test, '.test.ts');
    // Exact match: src/foo.ts ↔ tests/foo.test.ts
    if (changedBasenames.has(testBase)) {
      selected.add(test);
      continue;
    }
    // Prefix match: src/foo.ts ↔ tests/foo-helpers.test.ts, foo-edge.test.ts
    for (const base of changedBasenames) {
      if (testBase.startsWith(`${base}-`)) {
        selected.add(test);
        break;
      }
    }
  }

  // (2) Import-graph match — catch integration tests that explicitly
  // reference a changed source file by path.
  const changedRelPaths = options.changedFiles
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map(f => f.replace(/\\/g, '/'));

  for (const test of allTests) {
    if (selected.has(test)) continue; // already in by basename
    let content: string;
    try {
      content = await read(path.join(cwd, test), 'utf8');
    } catch {
      continue; // skip unreadable test files
    }
    if (testImportsAnyOf(content, changedRelPaths)) {
      selected.add(test);
    }
  }

  // (3) Always-run override — union the load-bearing tests.
  for (const t of resolveAlwaysRun(allTests, alwaysRun)) {
    selected.add(t);
  }

  return [...selected].sort();
}

/**
 * Return true when the test file's source mentions any of the changed
 * source files in an import statement. Tolerant regex — handles both
 * `../src/core/foo.js` and `../../src/core/foo.js` patterns plus
 * `.ts` and `.js` extensions.
 */
function testImportsAnyOf(testContent: string, changedFiles: string[]): boolean {
  const importPattern = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
  let match: RegExpExecArray | null;
  const imports: string[] = [];
  while ((match = importPattern.exec(testContent)) !== null) {
    imports.push(match[1]!);
  }
  if (imports.length === 0) return false;

  for (const changed of changedFiles) {
    const noExt = changed.replace(/\.tsx?$/, '');
    const baseName = path.basename(noExt);
    for (const imp of imports) {
      // Strip extension from import for comparison; tsconfig allows .js extension
      // even when the actual source is .ts (ESM convention).
      const impNoExt = imp.replace(/\.(?:tsx?|jsx?)$/, '');
      if (impNoExt.endsWith(noExt) || impNoExt.endsWith(`/${baseName}`)) {
        return true;
      }
    }
  }
  return false;
}

function resolveAlwaysRun(allTests: string[], alwaysRun: string[]): string[] {
  if (alwaysRun.length === 0) return [];
  const out: string[] = [];
  const normalized = alwaysRun.map(p => p.replace(/\\/g, '/'));
  for (const test of allTests) {
    const norm = test.replace(/\\/g, '/');
    if (normalized.some(p => norm === p || norm.endsWith(`/${p}`) || matchesGlob(norm, p))) {
      out.push(test);
    }
  }
  return out;
}

/** Default test-file discovery — recursive walk of tests/**.test.ts. */
async function defaultListTests(cwd: string): Promise<string[]> {
  const root = path.join(cwd, TESTS_ROOT);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        out.push(path.relative(cwd, full).replace(/\\/g, '/'));
      }
    }
  }
  await walk(root);
  return out.sort();
}
