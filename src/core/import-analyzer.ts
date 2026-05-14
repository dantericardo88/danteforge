/**
 * import-analyzer.ts
 *
 * Static analysis helpers for measuring CLI startup cost.
 * Reads import statements from TypeScript/JS source files
 * and classifies them by weight so the startup-bench command
 * can surface the heaviest dependencies.
 *
 * Deliberately uses regex (not AST) — we want this module to
 * be as fast and zero-dependency as possible, since it is used
 * to diagnose startup cost.
 */
import { readFile } from 'node:fs/promises';

// ── types ──────────────────────────────────────────────────────────────────

export type ImportWeight = 'heavy' | 'medium' | 'light';

export interface ClassifiedImport {
  /** The raw module specifier exactly as it appears in the source. */
  specifier: string;
  /** Weight classification. */
  weight: ImportWeight;
}

// ── classification rules ───────────────────────────────────────────────────

/**
 * Module specifier prefixes / substrings that indicate a heavy dependency.
 * Heavy means: large transitive dependency graph, slow to `require()`, or
 * loads native addons.
 */
const HEAVY_PATTERNS: readonly RegExp[] = [
  /\/matrix\//,
  /mcp-server/,
  /figma/i,
  /openai/i,
  /anthropic/i,
  /@anthropic/,
  /@openai/,
  /llama/i,
  /tensorflow/i,
  /esbuild/,
  /tsup/,
  /playwright/,
  /puppeteer/,
  /chromium/,
];

/**
 * Module specifier prefixes that indicate a light (near-zero cost) dependency.
 * Node.js built-ins and tiny utility packages.
 */
const LIGHT_PATTERNS: readonly RegExp[] = [
  /^node:/,
  /^fs$/,
  /^path$/,
  /^os$/,
  /^url$/,
  /^util$/,
  /^child_process$/,
  /^crypto$/,
  /^events$/,
  /^stream$/,
  /^buffer$/,
  /^assert$/,
  /^process$/,
  /^readline$/,
  /^http$/,
  /^https$/,
  /^net$/,
  /^tls$/,
  /^zlib$/,
  /^cluster$/,
  /^worker_threads$/,
  /^perf_hooks$/,
  /^module$/,
  /^vm$/,
  /^constants$/,
  /^string_decoder$/,
  /^timers$/,
  /^querystring$/,
  /^dns$/,
  /^dgram$/,
  /^diagnostics_channel$/,
];

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Classify a module specifier as `'heavy'`, `'medium'`, or `'light'`.
 *
 * Rules applied in order:
 * 1. Heavy patterns match → `'heavy'` (large transitive deps, native addons)
 * 2. Light patterns match → `'light'` (Node.js built-ins, zero-dep utilities)
 * 3. Fallback → `'medium'`
 *
 * @param importPath - The raw module specifier string (e.g. `'node:fs'`,
 *   `'@anthropic-ai/sdk'`, `'./utils.js'`).
 * @returns `'heavy'`, `'medium'`, or `'light'`.
 *
 * @example
 * classifyImportWeight('node:fs');          // 'light'
 * classifyImportWeight('@anthropic-ai/sdk'); // 'heavy'
 * classifyImportWeight('chalk');            // 'medium'
 */
export function classifyImportWeight(importPath: string): ImportWeight {
  for (const pattern of HEAVY_PATTERNS) {
    if (pattern.test(importPath)) return 'heavy';
  }
  for (const pattern of LIGHT_PATTERNS) {
    if (pattern.test(importPath)) return 'light';
  }
  return 'medium';
}

/**
 * Extract all top-level static `import` statements from `source` and return
 * their module specifiers. Dynamic `import()` expressions and `require()`
 * calls are intentionally excluded — they are already deferred and do not
 * contribute to startup cost.
 *
 * Handles all TypeScript/ES static import forms:
 * - `import 'foo'`
 * - `import foo from 'foo'`
 * - `import { a, b } from 'foo'`
 * - `import type { T } from 'foo'`
 * - `import * as ns from 'foo'`
 * - `import foo, { a } from 'foo'`
 *
 * Does NOT match:
 * - `const x = await import('foo')` — dynamic, intentionally deferred
 * - `require('foo')` — CommonJS, excluded by design
 *
 * @param source - Raw TypeScript or JavaScript source code string.
 * @returns Array of module specifier strings in declaration order.
 */
export function extractTopLevelImports(source: string): string[] {
  // Match static import statements. We look for lines that start with
  // `import` (possibly with `type`) and capture the quoted module path.
  const pattern =
    /^import\s+(?:type\s+)?(?:[^'"`\n]*\s+from\s+)?(['"`])((?:\\.|[^\\])*?)\1/gm;

  const specifiers: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const specifier = match[2];
    if (specifier) specifiers.push(specifier);
  }

  return specifiers;
}

/**
 * Read `entryFile` from disk, extract all top-level `import` specifiers, and
 * return them sorted by weight (heavy first, then medium, then light).
 *
 * Returns an empty array when the file cannot be read (e.g. ENOENT).
 *
 * @param entryFile - Absolute or relative path to the TypeScript/JavaScript
 *   source file to analyse.
 * @returns Classified imports sorted so the heaviest (most startup-cost)
 *   dependencies appear first. Each entry has `{ specifier, weight }`.
 *
 * @example
 * const imports = await analyzeTopLevelImports('src/cli/index.ts');
 * const heavy = imports.filter(i => i.weight === 'heavy');
 * console.log('Heavy imports:', heavy.map(i => i.specifier));
 */
export async function analyzeTopLevelImports(
  entryFile: string,
): Promise<ClassifiedImport[]> {
  let source: string;
  try {
    source = await readFile(entryFile, 'utf8');
  } catch {
    return [];
  }

  const specifiers = extractTopLevelImports(source);
  const classified = specifiers.map((s) => ({
    specifier: s,
    weight: classifyImportWeight(s),
  }));

  // Sort: heavy first, then medium, then light — most actionable on top.
  const order: Record<ImportWeight, number> = { heavy: 0, medium: 1, light: 2 };
  classified.sort((a, b) => order[a.weight] - order[b.weight]);

  return classified;
}
