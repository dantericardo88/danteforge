// code-health.ts — Unified code maintainability report
// Aggregates file-size (LOC), JSDoc coverage, and TODO/FIXME counts into one report.
// Exits 1 when any hard threshold is breached.

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileHealthMetrics {
  path: string;
  nonBlankLines: number;
  todoCount: number;
  exportedSymbols: number;
  documentedSymbols: number;
}

export interface CodeHealthReport {
  totalFiles: number;
  totalLines: number;
  filesOver500: FileHealthMetrics[];
  filesOver750: FileHealthMetrics[];
  todoTotal: number;
  exportedTotal: number;
  documentedTotal: number;
  jsdocCoveragePercent: number;
  verdict: 'CLEAN' | 'WARN' | 'FAIL';
  reasons: string[];
}

export interface CodeHealthOptions {
  cwd?: string;
  json?: boolean;
  srcDir?: string;
  hardCap?: number;
  softCap?: number;
  jsdocMinPercent?: number;
  // Injection seams
  _readdir?: (p: string) => Promise<string[]>;
  _readFile?: (p: string) => Promise<string>;
  _isDirectory?: (p: string) => Promise<boolean>;
  _stdout?: (line: string) => void;
}

// ── Scanner ───────────────────────────────────────────────────────────────────

async function collectTsFiles(
  dir: string,
  readdirFn: (p: string) => Promise<string[]>,
  isDirFn: (p: string) => Promise<boolean>,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdirFn(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry);
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      try {
        if (await isDirFn(full)) {
          await walk(full);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
          out.push(full);
        }
      } catch { /* skip */ }
    }
  }
  await walk(dir);
  return out;
}

async function defaultIsDir(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

const EXPORT_RE = /^export\s+(?:async\s+)?(function|class|const|interface|type)\s+(\w+)/gm;
const JSDOC_RE = /\/\*\*[\s\S]*?\*\/\s*$/;
const TODO_RE = /\b(TODO|FIXME|XXX|HACK)\b/g;

function analyzeFile(filePath: string, content: string): FileHealthMetrics {
  const nonBlankLines = content.split('\n').filter(l => l.trim().length > 0).length;
  const todoMatches = content.match(TODO_RE);
  const todoCount = todoMatches?.length ?? 0;

  let exportedSymbols = 0;
  let documentedSymbols = 0;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = line.match(/^export\s+(?:async\s+)?(function|class|const|interface|type)\s+(\w+)/);
    if (!match) continue;
    exportedSymbols++;
    const contextLines = lines.slice(Math.max(0, i - 30), i).join('\n');
    if (JSDOC_RE.test(contextLines)) documentedSymbols++;
  }
  EXPORT_RE.lastIndex = 0;

  return { path: filePath, nonBlankLines, todoCount, exportedSymbols, documentedSymbols };
}

// ── Main analyzer ─────────────────────────────────────────────────────────────

export async function analyzeCodeHealth(options: CodeHealthOptions = {}): Promise<CodeHealthReport> {
  const cwd = options.cwd ?? process.cwd();
  const srcDir = options.srcDir ?? path.join(cwd, 'src');
  const readdirFn = options._readdir ?? ((p: string) => fs.readdir(p));
  const readFileFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const isDirFn = options._isDirectory ?? defaultIsDir;
  const hardCap = options.hardCap ?? 750;
  const softCap = options.softCap ?? 500;
  const jsdocMin = options.jsdocMinPercent ?? 60;

  const files = await collectTsFiles(srcDir, readdirFn, isDirFn);
  const metrics: FileHealthMetrics[] = [];

  for (const f of files) {
    try {
      const content = await readFileFn(f);
      metrics.push(analyzeFile(f, content));
    } catch { /* skip unreadable */ }
  }

  const totalFiles = metrics.length;
  const totalLines = metrics.reduce((s, m) => s + m.nonBlankLines, 0);
  const filesOver500 = metrics.filter(m => m.nonBlankLines > softCap && m.nonBlankLines <= hardCap);
  const filesOver750 = metrics.filter(m => m.nonBlankLines > hardCap);
  const todoTotal = metrics.reduce((s, m) => s + m.todoCount, 0);
  const exportedTotal = metrics.reduce((s, m) => s + m.exportedSymbols, 0);
  const documentedTotal = metrics.reduce((s, m) => s + m.documentedSymbols, 0);
  const jsdocCoveragePercent = exportedTotal > 0
    ? Math.round((documentedTotal / exportedTotal) * 100)
    : 100;

  const reasons: string[] = [];
  let verdict: 'CLEAN' | 'WARN' | 'FAIL' = 'CLEAN';

  if (filesOver750.length > 0) {
    verdict = 'FAIL';
    reasons.push(`${filesOver750.length} file(s) exceed the ${hardCap}-LOC hard cap`);
  }
  if (jsdocCoveragePercent < jsdocMin) {
    if (verdict !== 'FAIL') verdict = 'FAIL';
    reasons.push(`JSDoc coverage ${jsdocCoveragePercent}% is below the ${jsdocMin}% threshold`);
  }
  if (verdict === 'CLEAN' && filesOver500.length > 0) {
    verdict = 'WARN';
    reasons.push(`${filesOver500.length} file(s) above the ${softCap}-LOC ideal cap (under hard cap)`);
  }
  if (verdict === 'CLEAN' && todoTotal > 100) {
    verdict = 'WARN';
    reasons.push(`${todoTotal} TODO/FIXME markers found — consider triaging`);
  }
  if (verdict === 'CLEAN') reasons.push('All maintainability thresholds met');

  return {
    totalFiles, totalLines,
    filesOver500, filesOver750,
    todoTotal, exportedTotal, documentedTotal, jsdocCoveragePercent,
    verdict, reasons,
  };
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatCodeHealthReport(report: CodeHealthReport): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\nDanteForge Code Health Report'));
  lines.push(chalk.dim('─'.repeat(50)));
  lines.push('');
  lines.push(`  ${chalk.bold('Files scanned:')} ${report.totalFiles}`);
  lines.push(`  ${chalk.bold('Total non-blank LOC:')} ${report.totalLines.toLocaleString()}`);
  lines.push(`  ${chalk.bold('Exported symbols:')} ${report.exportedTotal}`);
  lines.push(`  ${chalk.bold('JSDoc coverage:')} ${formatPct(report.jsdocCoveragePercent)} (${report.documentedTotal}/${report.exportedTotal})`);
  lines.push(`  ${chalk.bold('TODO/FIXME markers:')} ${report.todoTotal > 50 ? chalk.yellow(report.todoTotal) : report.todoTotal}`);
  lines.push('');

  if (report.filesOver750.length > 0) {
    lines.push(chalk.bold(`  ${chalk.red('Hard-cap violations')} (${report.filesOver750.length}):`));
    for (const f of report.filesOver750.slice(0, 5)) {
      lines.push(`    ${chalk.red('FAIL')} ${f.nonBlankLines} LOC  ${path.relative(process.cwd(), f.path)}`);
    }
    if (report.filesOver750.length > 5) lines.push(chalk.dim(`    … and ${report.filesOver750.length - 5} more`));
    lines.push('');
  }

  if (report.filesOver500.length > 0) {
    lines.push(chalk.bold(`  ${chalk.yellow('Soft-cap warnings')} (${report.filesOver500.length}):`));
    for (const f of report.filesOver500.slice(0, 5)) {
      lines.push(`    ${chalk.yellow('WARN')} ${f.nonBlankLines} LOC  ${path.relative(process.cwd(), f.path)}`);
    }
    if (report.filesOver500.length > 5) lines.push(chalk.dim(`    … and ${report.filesOver500.length - 5} more`));
    lines.push('');
  }

  const verdictColor = report.verdict === 'CLEAN' ? chalk.green : report.verdict === 'WARN' ? chalk.yellow : chalk.red;
  lines.push(`  ${chalk.bold('Verdict:')} ${verdictColor(report.verdict)}`);
  for (const r of report.reasons) lines.push(`    ${chalk.dim('-')} ${r}`);
  lines.push('');

  return lines.join('\n');
}

function formatPct(p: number): string {
  if (p >= 80) return chalk.green(`${p}%`);
  if (p >= 60) return chalk.yellow(`${p}%`);
  return chalk.red(`${p}%`);
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runCodeHealth(opts: { cwd?: string; json?: boolean } = {}): Promise<void> {
  const report = await analyzeCodeHealth({ cwd: opts.cwd });

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      verdict: report.verdict,
      totalFiles: report.totalFiles,
      totalLines: report.totalLines,
      jsdocCoveragePercent: report.jsdocCoveragePercent,
      filesOver750: report.filesOver750.length,
      filesOver500: report.filesOver500.length,
      todoTotal: report.todoTotal,
      reasons: report.reasons,
    }, null, 2) + '\n');
  } else {
    logger.info(formatCodeHealthReport(report));
  }

  if (report.verdict === 'FAIL') process.exitCode = 1;
}
