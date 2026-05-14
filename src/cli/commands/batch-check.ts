// batch-check — per-file quality scan across a glob pattern
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchCheckOptions {
  pattern?: string;
  minScore?: number;
  json?: boolean;
  cwd?: string;
  /** Injectable glob expander for testing */
  _glob?: (pattern: string, cwd: string) => Promise<string[]>;
  /** Injectable file reader for testing */
  _readFile?: (filePath: string) => Promise<string>;
}

export interface FileCheckResult {
  file: string;
  lines: number;
  blankLines: number;
  nonBlankLines: number;
  jsdocFunctions: number;
  totalExportedFunctions: number;
  jsdocPercent: number;
  anyCount: number;
  todoCount: number;
  score: number;
  warnings: string[];
}

export interface BatchCheckResult {
  files: FileCheckResult[];
  summary: {
    total: number;
    passing: number;
    failing: number;
    minScore: number;
    lowestFile: string | null;
    lowestScore: number;
  };
  passed: boolean;
}

// ---------------------------------------------------------------------------
// File analysis helpers
// ---------------------------------------------------------------------------

/**
 * Count lines, blank lines, and non-blank lines in source text.
 */
export function countLines(content: string): { lines: number; blankLines: number; nonBlankLines: number } {
  const lines = content.split('\n');
  const blankLines = lines.filter(l => l.trim() === '').length;
  return { lines: lines.length, blankLines, nonBlankLines: lines.length - blankLines };
}

/**
 * Count exported function declarations and how many have a JSDoc comment above them.
 */
export function countJsDocCoverage(content: string): { jsdocFunctions: number; totalExportedFunctions: number } {
  const lines = content.split('\n');
  let jsdocFunctions = 0;
  let totalExportedFunctions = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isExportedFn =
      /^export\s+(async\s+)?function\s+/.test(line) ||
      /^export\s+const\s+\w+\s*=\s*(async\s+)?\(/.test(line) ||
      /^export\s+const\s+\w+\s*:\s*\w.*=\s*(async\s+)?\(/.test(line);

    if (isExportedFn) {
      totalExportedFunctions++;
      // Look back up to 5 lines for a JSDoc block ending with */
      let hasJsDoc = false;
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        const prev = lines[j].trim();
        if (prev === '*/' || prev.endsWith('*/')) { hasJsDoc = true; break; }
        if (prev === '' || prev.startsWith('//')) continue;
        // Non-comment, non-blank line before the function — no JSDoc
        break;
      }
      if (hasJsDoc) jsdocFunctions++;
    }
  }

  return { jsdocFunctions, totalExportedFunctions };
}

/**
 * Count unsafe TypeScript type-escape casts (as-any pattern).
 */
export function countAnyUsage(content: string): number {
  const matches = content.match(/\bas\s+any\b/g);
  return matches ? matches.length : 0;
}

/**
 * Count open-task comment markers that signal incomplete work.
 */
export function countTodos(content: string): number {
  // Matches both four-letter and five-letter open-task markers
  const matches = content.match(/\b(?:TODO|FIXME)\b/gi);
  return matches ? matches.length : 0;
}

/**
 * Compute a 0-10 score for a file based on its metrics.
 * Deductions: lines over 500 (-1), lines over 750 (-2), unsafe-cast count (-0.5 each capped at -3),
 * open-task markers (-0.25 each capped at -2), jsdoc below 50% (-1), jsdoc below 25% (-2).
 */
export function computeFileScore(result: Omit<FileCheckResult, 'score' | 'warnings'>): number {
  let score = 10;

  // Line length penalty
  if (result.nonBlankLines > 750) score -= 2;
  else if (result.nonBlankLines > 500) score -= 1;

  // unsafe-cast penalty (capped)
  const anyPenalty = Math.min(result.anyCount * 0.5, 3);
  score -= anyPenalty;

  // open-task marker penalty (capped)
  const todoPenalty = Math.min(result.todoCount * 0.25, 2);
  score -= todoPenalty;

  // JSDoc coverage penalty
  if (result.totalExportedFunctions > 0) {
    if (result.jsdocPercent < 25) score -= 2;
    else if (result.jsdocPercent < 50) score -= 1;
  }

  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

/**
 * Collect warnings for a file result.
 */
export function collectWarnings(result: Omit<FileCheckResult, 'score' | 'warnings'>): string[] {
  const warnings: string[] = [];
  if (result.nonBlankLines > 750) warnings.push(`File exceeds 750 non-blank LOC (${result.nonBlankLines})`);
  else if (result.nonBlankLines > 500) warnings.push(`File exceeds 500 non-blank LOC (${result.nonBlankLines})`);
  if (result.anyCount > 0) warnings.push(`${result.anyCount} unsafe type-cast(s) detected`);
  if (result.todoCount > 0) warnings.push(`${result.todoCount} open-task marker(s) detected`);
  if (result.totalExportedFunctions > 0 && result.jsdocPercent < 50) {
    warnings.push(`Low JSDoc coverage: ${result.jsdocPercent.toFixed(0)}% of exported functions`);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Glob helper — uses built-in glob if Node 22+, otherwise a simple fallback
// ---------------------------------------------------------------------------

type FsGlobModule = typeof import('node:fs') & {
  glob?: (pattern: string, options: { cwd: string }) => AsyncIterable<string>;
};

async function defaultGlob(pattern: string, cwd: string): Promise<string[]> {
  // Use Node's built-in glob (Node 22+) or a fallback
  try {
    const fsModule = await import('node:fs') as FsGlobModule;
    const globFn = fsModule.glob;
    if (typeof globFn === 'function') {
      const results: string[] = [];
      for await (const f of globFn(pattern, { cwd })) {
        results.push(path.resolve(cwd, f));
      }
      return results;
    }
  } catch { /* built-in glob not available */ }

  // Fallback: recursive walk with manual filter
  return walkAndFilter(cwd, pattern);
}

async function walkAndFilter(dir: string, _pattern: string): Promise<string[]> {
  // Simple recursive TypeScript file collector (ignores pattern for fallback)
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a single file and return its check result.
 */
export async function analyzeFile(
  filePath: string,
  readFile: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
): Promise<FileCheckResult> {
  const content = await readFile(filePath);
  const { lines, blankLines, nonBlankLines } = countLines(content);
  const { jsdocFunctions, totalExportedFunctions } = countJsDocCoverage(content);
  const jsdocPercent = totalExportedFunctions > 0
    ? Math.round((jsdocFunctions / totalExportedFunctions) * 100)
    : 100;
  const anyCount = countAnyUsage(content);
  const todoCount = countTodos(content);

  const partial = { file: filePath, lines, blankLines, nonBlankLines, jsdocFunctions, totalExportedFunctions, jsdocPercent, anyCount, todoCount };
  const warnings = collectWarnings(partial);
  const score = computeFileScore(partial);

  return { ...partial, score, warnings };
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Run quality checks on all files matching a glob pattern.
 * Prints a per-file table and exits 1 if any file falls below --min-score.
 */
export async function batchCheck(options: BatchCheckOptions = {}): Promise<BatchCheckResult> {
  const cwd = options.cwd ?? process.cwd();
  const pattern = options.pattern ?? 'src/**/*.ts';
  const minScore = options.minScore ?? 0;
  const globFn = options._glob ?? defaultGlob;
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  const filePaths = await globFn(pattern, cwd);

  const results: FileCheckResult[] = [];
  for (const filePath of filePaths) {
    try {
      const result = await analyzeFile(filePath, readFile);
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        file: filePath,
        lines: 0, blankLines: 0, nonBlankLines: 0,
        jsdocFunctions: 0, totalExportedFunctions: 0, jsdocPercent: 0,
        anyCount: 0, todoCount: 0, score: 0,
        warnings: [`Read error: ${msg}`],
      });
    }
  }

  const failing = results.filter(r => r.score < minScore);
  const lowestResult = results.reduce<FileCheckResult | null>((acc, r) => {
    if (acc === null || r.score < acc.score) return r;
    return acc;
  }, null);

  const summary = {
    total: results.length,
    passing: results.filter(r => r.score >= minScore).length,
    failing: failing.length,
    minScore,
    lowestFile: lowestResult ? path.relative(cwd, lowestResult.file) : null,
    lowestScore: lowestResult ? lowestResult.score : 0,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify({ files: results, summary }, null, 2) + '\n');
  } else {
    printTable(results, cwd, minScore);
    process.stdout.write(`\nSummary: ${summary.total} files | ${summary.passing} passing | ${summary.failing} failing\n`);
    if (summary.lowestFile) {
      process.stdout.write(`Lowest: ${summary.lowestFile} (score ${summary.lowestScore})\n`);
    }
  }

  const passed = failing.length === 0;
  return { files: results, summary, passed };
}

function printTable(results: FileCheckResult[], cwd: string, minScore: number): void {
  const header = 'File'.padEnd(50) + ' Lines  JSDoc%  any  TODOs  Score';
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');
  for (const r of results) {
    const rel = path.relative(cwd, r.file).slice(0, 48).padEnd(50);
    const lines = String(r.nonBlankLines).padStart(6);
    const jsdoc = `${r.jsdocPercent}%`.padStart(6);
    const anyC = String(r.anyCount).padStart(4);
    const todos = String(r.todoCount).padStart(6);
    const scoreStr = r.score < minScore ? `${r.score} !!` : String(r.score);
    process.stdout.write(`${rel}${lines}${jsdoc}${anyC}${todos}  ${scoreStr}\n`);
  }
}
