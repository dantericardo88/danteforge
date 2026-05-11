import fs from 'node:fs/promises';
import path from 'node:path';

export const IDEAL_SOURCE_LOC = 500;
export const HARD_SOURCE_LOC = 750;

const DEFAULT_SCAN_DIRS = ['src', 'packages'];
const SKIP_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /\.d\.ts$/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
];

export type FileSizeStatus = 'ok' | 'warn' | 'error' | 'legacy';

export interface SourceFileSize {
  relativePath: string;
  absolutePath: string;
  loc: number;
  status: FileSizeStatus;
  allowed: boolean;
}

export interface FileSizeSummary {
  totalFiles: number;
  idealLimit: number;
  hardLimit: number;
  warnings: number;
  hardViolations: number;
  grandfathered: number;
}

export interface FileSizeReport {
  cwd: string;
  files: SourceFileSize[];
  summary: FileSizeSummary;
}

export interface InspectSourceFileSizesOptions {
  scanDirs?: string[];
  allowlistPath?: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function shouldSkip(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return SKIP_PATTERNS.some(pattern => pattern.test(normalized));
}

export function countMaintainableLoc(content: string): number {
  let count = 0;
  let inBlockComment = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
      inBlockComment = !trimmed.includes('*/');
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    count++;
  }

  return count;
}

async function loadAllowlist(cwd: string, allowlistPath = '.file-size-allowlist'): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(cwd, allowlistPath), 'utf8');
    return new Set(
      raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')),
    );
  } catch {
    return new Set();
  }
}

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkip(`${fullPath}/`)) results.push(...await collectTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === '.ts' && !shouldSkip(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function classifyFile(loc: number, allowed: boolean): FileSizeStatus {
  if (loc > HARD_SOURCE_LOC) return allowed ? 'legacy' : 'error';
  if (loc > IDEAL_SOURCE_LOC) return 'warn';
  return 'ok';
}

export async function inspectSourceFileSizes(
  cwd: string,
  options: InspectSourceFileSizesOptions = {},
): Promise<FileSizeReport> {
  const scanDirs = options.scanDirs ?? DEFAULT_SCAN_DIRS;
  const allowlist = await loadAllowlist(cwd, options.allowlistPath);
  const files = (await Promise.all(
    scanDirs.map(scanDir => collectTypeScriptFiles(path.join(cwd, scanDir))),
  )).flat();

  const reports: SourceFileSize[] = [];
  for (const absolutePath of files.sort()) {
    const relativePath = normalizePath(path.relative(cwd, absolutePath));
    const loc = countMaintainableLoc(await fs.readFile(absolutePath, 'utf8'));
    const allowed = allowlist.has(relativePath);
    reports.push({
      absolutePath,
      relativePath,
      loc,
      status: classifyFile(loc, allowed),
      allowed,
    });
  }

  const summary: FileSizeSummary = {
    totalFiles: reports.length,
    idealLimit: IDEAL_SOURCE_LOC,
    hardLimit: HARD_SOURCE_LOC,
    warnings: reports.filter(file => file.status === 'warn').length,
    hardViolations: reports.filter(file => file.loc > HARD_SOURCE_LOC).length,
    grandfathered: reports.filter(file => file.status === 'legacy').length,
  };

  return { cwd, files: reports, summary };
}

function suggestedSplit(relativePath: string): string {
  const parsed = path.posix.parse(relativePath);
  const stem = path.posix.join(parsed.dir, parsed.name);
  return [
    `${stem}.ts`,
    `${stem}-types.ts`,
    `${stem}-helpers.ts`,
    `${stem}-runner.ts`,
  ].join(', ');
}

export function buildFileSizeRefactorPlan(report: FileSizeReport): string {
  const candidates = report.files
    .filter(file => file.loc > IDEAL_SOURCE_LOC)
    .sort((a, b) => b.loc - a.loc);
  const lines = [
    '# DanteForge File-Size Refactor Plan',
    '',
    `Generated for: ${report.cwd}`,
    '',
    `Ideal target: ${report.summary.idealLimit} LOC`,
    `Hard cap: ${report.summary.hardLimit} LOC`,
    `Files scanned: ${report.summary.totalFiles}`,
    '',
  ];

  if (candidates.length === 0) {
    lines.push('All scanned source files are at or below the ideal target.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| Priority | File | LOC | Status | Suggested Split |');
  lines.push('|---|---:|---:|---|---|');
  candidates.forEach((file, index) => {
    const priority = file.loc > HARD_SOURCE_LOC ? `P${Math.min(index, 2)}` : 'P3';
    lines.push(`| ${priority} | ${file.relativePath} | ${file.loc} | ${file.status} | ${suggestedSplit(file.relativePath)} |`);
  });
  lines.push('');
  lines.push('## Process');
  lines.push('');
  lines.push('1. Split pure types and interfaces first.');
  lines.push('2. Move cohesive helper groups next, keeping public exports backward compatible.');
  lines.push('3. Run targeted tests after each file split.');
  lines.push('4. Remove allowlist entries only after each legacy file falls below the hard cap.');
  return `${lines.join('\n')}\n`;
}

export async function writeFileSizeRefactorPlan(cwd: string, report?: FileSizeReport): Promise<string> {
  const actualReport = report ?? await inspectSourceFileSizes(cwd);
  const outDir = path.join(cwd, '.danteforge', 'evidence', 'hygiene');
  const outPath = path.join(outDir, 'file-size-refactor-plan.md');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outPath, buildFileSizeRefactorPlan(actualReport), 'utf8');
  return outPath;
}
