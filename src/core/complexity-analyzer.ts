// complexity-analyzer.ts — static complexity metrics for DanteForge codebase
// Counts functions, LOC, and estimates cyclomatic complexity using regex heuristics.

import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FunctionMetrics {
  name: string;
  startLine: number;
  loc: number;
  cyclomaticComplexity: number;
}

export interface FileComplexityReport {
  filePath: string;
  totalLines: number;
  nonBlankLines: number;
  functionCount: number;
  avgFunctionLength: number;
  maxFunctionLength: number;
  avgCyclomaticComplexity: number;
  maxCyclomaticComplexity: number;
  complexityScore: number;
  functions: FunctionMetrics[];
  exceedsLocLimit: boolean;
}

export interface ProjectComplexityReport {
  srcDir: string;
  fileCount: number;
  totalLines: number;
  avgComplexityScore: number;
  maxComplexityScore: number;
  files: FileComplexityReport[];
  topComplexFiles: FileComplexityReport[];
  filesExceedingLocLimit: FileComplexityReport[];
  functionsExceedingLocLimit: Array<{ filePath: string; function: FunctionMetrics }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const LOC_LIMIT = 500;
const FUNCTION_LOC_LIMIT = 50;
const TOP_COMPLEX_COUNT = 10;

// ── Complexity estimation helpers ─────────────────────────────────────────────

// Count cyclomatic complexity decision points in a block of source code.
function estimateCyclomaticComplexity(block: string): number {
  // Start at 1 (the function itself counts as one path)
  let count = 1;

  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bswitch\s*\(/g,
    /\bcatch\s*\(/g,
    /\?\?/g,            // nullish coalescing
    /\bcase\s+/g,
    /&&/g,
    /\|\|/g,
  ];

  for (const pattern of patterns) {
    const matches = block.match(pattern);
    if (matches) count += matches.length;
  }

  return count;
}

// Detect function start lines using common TypeScript/JavaScript patterns.
function findFunctionStarts(lines: string[]): Array<{ name: string; lineIndex: number }> {
  const starts: Array<{ name: string; lineIndex: number }> = [];

  // Match: function foo(, async function foo(, export function foo(, export async function foo(
  const namedFunctionRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[\(<]/;
  // Match: const foo = (...) => {, const foo = async (...) => {
  const arrowFunctionRe = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(.*\)\s*(?::\s*\S+\s*)?=>\s*\{/;
  // Match: foo(...) { (method definitions)
  const methodRe = /^\s+(?:async\s+)?(\w+)\s*\(.*\)\s*(?::\s*\S+\s*)?\{/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const namedMatch = namedFunctionRe.exec(line);
    if (namedMatch) {
      starts.push({ name: namedMatch[1], lineIndex: i });
      continue;
    }
    const arrowMatch = arrowFunctionRe.exec(line);
    if (arrowMatch) {
      starts.push({ name: arrowMatch[1], lineIndex: i });
      continue;
    }
    const methodMatch = methodRe.exec(line);
    if (methodMatch && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
      starts.push({ name: methodMatch[1], lineIndex: i });
    }
  }

  return starts;
}

// ── File analysis ─────────────────────────────────────────────────────────────

export function analyzeFileComplexity(filePath: string, content: string): FileComplexityReport {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const nonBlankLines = lines.filter(l => l.trim().length > 0).length;

  const functionStarts = findFunctionStarts(lines);
  const functions: FunctionMetrics[] = [];

  for (let i = 0; i < functionStarts.length; i++) {
    const start = functionStarts[i];
    const endLineIndex = functionStarts[i + 1]
      ? functionStarts[i + 1].lineIndex - 1
      : lines.length - 1;

    const loc = endLineIndex - start.lineIndex + 1;
    const block = lines.slice(start.lineIndex, endLineIndex + 1).join('\n');
    const cyclomaticComplexity = estimateCyclomaticComplexity(block);

    functions.push({
      name: start.name,
      startLine: start.lineIndex + 1,
      loc,
      cyclomaticComplexity,
    });
  }

  const avgFunctionLength = functions.length > 0
    ? functions.reduce((s, f) => s + f.loc, 0) / functions.length
    : 0;
  const maxFunctionLength = functions.length > 0
    ? Math.max(...functions.map(f => f.loc))
    : 0;
  const avgCyclomaticComplexity = functions.length > 0
    ? functions.reduce((s, f) => s + f.cyclomaticComplexity, 0) / functions.length
    : 1;
  const maxCyclomaticComplexity = functions.length > 0
    ? Math.max(...functions.map(f => f.cyclomaticComplexity))
    : 1;

  // Composite complexity score: normalise to roughly 0-100
  const locFactor = Math.min(nonBlankLines / 50, 10);
  const cyclFactor = Math.min(avgCyclomaticComplexity / 2, 10);
  const functionFactor = Math.min(functions.length / 5, 5);
  const complexityScore = locFactor + cyclFactor + functionFactor;

  return {
    filePath,
    totalLines,
    nonBlankLines,
    functionCount: functions.length,
    avgFunctionLength: Math.round(avgFunctionLength * 10) / 10,
    maxFunctionLength,
    avgCyclomaticComplexity: Math.round(avgCyclomaticComplexity * 10) / 10,
    maxCyclomaticComplexity,
    complexityScore: Math.round(complexityScore * 10) / 10,
    functions,
    exceedsLocLimit: nonBlankLines > LOC_LIMIT,
  };
}

// ── Project analysis ──────────────────────────────────────────────────────────

type ReadFileFn = (p: string, enc: 'utf8') => Promise<string>;
type GlobFn = (pattern: string, opts: { cwd: string }) => Promise<string[]>;

async function defaultGlob(pattern: string, opts: { cwd: string }): Promise<string[]> {
  const { glob } = await import('glob');
  return glob(pattern, opts);
}

async function defaultReadFile(p: string, enc: 'utf8'): Promise<string> {
  const fs = await import('fs/promises');
  return fs.readFile(p, enc);
}

export async function analyzeProjectComplexity(
  srcDir: string,
  _readFile?: ReadFileFn,
  _glob?: GlobFn,
): Promise<ProjectComplexityReport> {
  const readFile = _readFile ?? defaultReadFile;
  const globFn = _glob ?? defaultGlob;

  const relPaths = await globFn('**/*.ts', { cwd: srcDir });
  const reports: FileComplexityReport[] = [];

  for (const rel of relPaths) {
    const absPath = path.join(srcDir, rel);
    try {
      const content = await readFile(absPath, 'utf8');
      const report = analyzeFileComplexity(absPath, content);
      reports.push(report);
    } catch {
      // skip unreadable files
    }
  }

  const totalLines = reports.reduce((s, r) => s + r.totalLines, 0);
  const avgComplexityScore = reports.length > 0
    ? reports.reduce((s, r) => s + r.complexityScore, 0) / reports.length
    : 0;
  const maxComplexityScore = reports.length > 0
    ? Math.max(...reports.map(r => r.complexityScore))
    : 0;

  const sortedByComplexity = [...reports].sort((a, b) => b.complexityScore - a.complexityScore);
  const topComplexFiles = sortedByComplexity.slice(0, TOP_COMPLEX_COUNT);
  const filesExceedingLocLimit = reports.filter(r => r.exceedsLocLimit);

  const functionsExceedingLocLimit: Array<{ filePath: string; function: FunctionMetrics }> = [];
  for (const r of reports) {
    for (const fn of r.functions) {
      if (fn.loc > FUNCTION_LOC_LIMIT) {
        functionsExceedingLocLimit.push({ filePath: r.filePath, function: fn });
      }
    }
  }

  return {
    srcDir,
    fileCount: reports.length,
    totalLines,
    avgComplexityScore: Math.round(avgComplexityScore * 10) / 10,
    maxComplexityScore: Math.round(maxComplexityScore * 10) / 10,
    files: sortedByComplexity,
    topComplexFiles,
    filesExceedingLocLimit,
    functionsExceedingLocLimit,
  };
}
