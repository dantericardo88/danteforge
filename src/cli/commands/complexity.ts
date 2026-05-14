// complexity.ts — `danteforge complexity` command
// Runs static complexity analysis on src/ and prints a report.

import path from 'path';
import { logger } from '../../core/logger.js';
import {
  analyzeProjectComplexity,
  type ProjectComplexityReport,
  type FileComplexityReport,
} from '../../core/complexity-analyzer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplexityOptions {
  threshold?: number;
  json?: boolean;
  cwd?: string;
  watch?: boolean;
  // Injection seams for testing
  _analyzeProject?: typeof analyzeProjectComplexity;
  _stdout?: (line: string) => void;
  _setInterval?: typeof setInterval;
  _setExitCode?: (code: number) => void;
}

export interface ComplexityResult {
  report: ProjectComplexityReport;
  exceedsThreshold: boolean;
  threshold: number;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatRow(r: FileComplexityReport, cwd: string): string {
  const rel = path.relative(cwd, r.filePath);
  const score = r.complexityScore.toFixed(1).padStart(6);
  const lines = String(r.nonBlankLines).padStart(6);
  const fns = String(r.functionCount).padStart(5);
  const limit = r.exceedsLocLimit ? ' [>500]' : '';
  return `${score}  ${lines} LOC  ${fns} fn  ${rel}${limit}`;
}

function printReport(result: ComplexityResult, cwd: string, emit: (l: string) => void): void {
  const { report, threshold } = result;

  emit(`\n## Complexity Analysis — ${path.relative(process.cwd(), report.srcDir) || 'src/'}`);
  emit(`Files scanned: ${report.fileCount}  |  Total LOC: ${report.totalLines}  |  Avg score: ${report.avgComplexityScore}  |  Max score: ${report.maxComplexityScore}`);
  emit('');
  emit('### Top 10 Most Complex Files');
  emit(' Score    LOC    Fns  File');
  emit('------  ------  ----  --------------------------');
  for (const r of report.topComplexFiles) {
    emit(formatRow(r, cwd));
  }

  if (report.filesExceedingLocLimit.length > 0) {
    emit('');
    emit(`### Files Exceeding ${500} LOC (${report.filesExceedingLocLimit.length})`);
    for (const r of report.filesExceedingLocLimit) {
      emit(`  ${path.relative(cwd, r.filePath)}  (${r.nonBlankLines} non-blank lines)`);
    }
  }

  if (report.functionsExceedingLocLimit.length > 0) {
    emit('');
    emit(`### Functions Exceeding 50 LOC (${report.functionsExceedingLocLimit.length})`);
    for (const entry of report.functionsExceedingLocLimit.slice(0, 20)) {
      const rel = path.relative(cwd, entry.filePath);
      emit(`  ${entry.function.name}() — ${entry.function.loc} LOC  (${rel}:${entry.function.startLine})`);
    }
  }

  if (result.exceedsThreshold) {
    emit('');
    emit(`Threshold exceeded: at least one file scored above ${threshold}. Exit 1.`);
  } else {
    emit('');
    emit(`All files within threshold (${threshold}).`);
  }
}

// ── Main command function ─────────────────────────────────────────────────────

export async function complexity(options: ComplexityOptions = {}): Promise<ComplexityResult> {
  const cwd = options.cwd ?? process.cwd();
  const srcDir = path.join(cwd, 'src');
  const threshold = options.threshold ?? 20;
  const emit = options._stdout ?? ((l: string) => logger.info(l));
  const analyzeProject = options._analyzeProject ?? analyzeProjectComplexity;
  const setExitCode = options._setExitCode ?? ((code: number) => { process.exitCode = code; });

  const report = await analyzeProject(srcDir);
  const exceedsThreshold = report.files.some(f => f.complexityScore > threshold);
  const result: ComplexityResult = { report, exceedsThreshold, threshold };

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printReport(result, cwd, emit);
  }

  if (exceedsThreshold) {
    setExitCode(1);
  }

  if (options.watch) {
    const intervalFn = options._setInterval ?? setInterval;
    emit('\nWatching for changes (poll every 5s, Ctrl+C to stop)...');
    intervalFn(async () => {
      const freshReport = await analyzeProject(srcDir);
      const freshExceeds = freshReport.files.some(f => f.complexityScore > threshold);
      const freshResult: ComplexityResult = { report: freshReport, exceedsThreshold: freshExceeds, threshold };
      printReport(freshResult, cwd, emit);
    }, 5000);
  }

  return result;
}
