// harden.ts — Phase C deterministic hardening checks.
//
// Surfaces the harden gate as a standalone command so operators can:
//   - Run all 5 checks on every dim in the matrix
//   - Filter by --dim or --check
//   - Use --gate in CI to refuse any score above 7.0 that fails harden
//   - Migrate existing dims with --migrate (interactive walkthrough)

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { runHardenGate } from '../../matrix/engines/hardener.js';
import {
  HARDEN_GATE_THRESHOLD,
  type HardenCheckId,
  type HardenVerdict,
} from '../../matrix/types/harden-check.js';

const HARDEN_REPORT_PATH = path.join('.danteforge', 'harden-report.json');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunHardenOptions {
  cwd?: string;
  dim?: string;            // filter to one dimension id
  check?: HardenCheckId;   // filter to one check
  gate?: boolean;          // exit 1 if any dim above threshold fails
  json?: boolean;
  migrate?: boolean;       // dry-run inferred callsites
  migrateApply?: boolean;  // write inferred callsites to matrix.json
  // Injection seams
  _loadMatrix?: typeof loadMatrix;
  _runHardenGate?: typeof runHardenGate;
  _writeFile?: (p: string, d: string) => Promise<void>;
}

export interface HardenReport {
  cwd: string;
  ranAt: string;
  totalDimensions: number;
  dimensionsAboveThreshold: number;
  dimensionsClamped: number;
  cleanCount: number;
  failedCount: number;
  perDimension: Array<{
    dimensionId: string;
    currentScore: number;
    aboveThreshold: boolean;
    verdict: HardenVerdict | null;  // null when below threshold and no migration
    cappedScore: number | null;     // null when verdict missing
  }>;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runHardenAll(options: RunHardenOptions = {}): Promise<HardenReport> {
  const cwd = options.cwd ?? process.cwd();
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const hardenFn = options._runHardenGate ?? runHardenGate;
  const writeFn = options._writeFile ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });

  const matrix = await loadMatrixFn(cwd);
  if (!matrix) {
    throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);
  }
  const dims = options.dim
    ? matrix.dimensions.filter(d => d.id === options.dim)
    : matrix.dimensions;

  if (options.dim && dims.length === 0) {
    throw new Error(`Dimension "${options.dim}" not found in matrix.json`);
  }

  const report: HardenReport = {
    cwd, ranAt: new Date().toISOString(),
    totalDimensions: dims.length,
    dimensionsAboveThreshold: 0,
    dimensionsClamped: 0,
    cleanCount: 0,
    failedCount: 0,
    perDimension: [],
  };

  for (const dim of dims) {
    const currentScore = dim.scores.self;
    const aboveThreshold = currentScore >= HARDEN_GATE_THRESHOLD;
    if (aboveThreshold) report.dimensionsAboveThreshold++;

    if (!aboveThreshold && !options.migrate && !options.migrateApply) {
      // Below threshold and not migrating: skip the actual check, record placeholder.
      report.perDimension.push({
        dimensionId: dim.id, currentScore, aboveThreshold: false,
        verdict: null, cappedScore: null,
      });
      continue;
    }

    const verdict = await hardenFn({
      dimensionId: dim.id,
      dim,
      cwd,
      onlyChecks: options.check ? [options.check] : undefined,
    });
    if (verdict.allowed) report.cleanCount++; else report.failedCount++;
    const cappedScore = verdict.allowed ? currentScore : Math.min(currentScore, verdict.scoreCap);
    if (cappedScore < currentScore) report.dimensionsClamped++;

    report.perDimension.push({
      dimensionId: dim.id, currentScore, aboveThreshold,
      verdict, cappedScore,
    });
  }

  await writeFn(path.join(cwd, HARDEN_REPORT_PATH), JSON.stringify(report, null, 2));
  return report;
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatHardenReport(report: HardenReport): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\nDanteForge Harden Report'));
  lines.push(chalk.dim('─'.repeat(60)));
  lines.push('');
  lines.push(`  ${chalk.bold('Dimensions scanned:')} ${report.totalDimensions}`);
  lines.push(`  ${chalk.bold('Above threshold (≥7.0):')} ${report.dimensionsAboveThreshold}`);
  if (report.cleanCount > 0) lines.push(`  ${chalk.green('Clean:')}                ${report.cleanCount}`);
  if (report.failedCount > 0) lines.push(`  ${chalk.red('Failed:')}               ${report.failedCount}`);
  if (report.dimensionsClamped > 0) lines.push(`  ${chalk.yellow('Would clamp:')}          ${report.dimensionsClamped}`);
  lines.push('');

  const failed = report.perDimension.filter(d => d.verdict && !d.verdict.allowed);
  if (failed.length > 0) {
    lines.push(chalk.bold(`  Dimensions that would clamp:`));
    for (const d of failed.slice(0, 15)) {
      const delta = (d.cappedScore! - d.currentScore).toFixed(2);
      const failedNames = d.verdict!.checks
        .filter(c => !c.passed && !c.skipped)
        .map(c => c.check)
        .join(', ');
      lines.push(`    ${chalk.red('↓')} ${d.dimensionId.padEnd(28)} ${d.currentScore.toFixed(1)} → ${chalk.yellow(d.cappedScore!.toFixed(1))}  (${chalk.red(delta)})  ${chalk.dim(failedNames)}`);
    }
    if (failed.length > 15) lines.push(chalk.dim(`    … and ${failed.length - 15} more`));
    lines.push('');
    lines.push(chalk.bold('  Top findings:'));
    for (const d of failed.slice(0, 5)) {
      for (const check of d.verdict!.checks) {
        if (check.passed || check.skipped) continue;
        for (const finding of check.findings.slice(0, 2)) {
          lines.push(`    ${chalk.red('•')} ${chalk.cyan(d.dimensionId)}/${chalk.yellow(check.check)}: ${finding.file}:${finding.line}`);
          lines.push(`      ${chalk.dim(finding.reason)}`);
        }
      }
    }
    lines.push('');
  } else if (report.dimensionsAboveThreshold > 0) {
    lines.push(chalk.green('  All dimensions above threshold pass every check ✓'));
    lines.push('');
  }

  lines.push(chalk.dim(`  Report written to ${path.relative(process.cwd(), path.join(report.cwd, HARDEN_REPORT_PATH))}`));
  lines.push('');
  return lines.join('\n');
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runHardenCommand(opts: RunHardenOptions = {}): Promise<void> {
  const report = await runHardenAll(opts);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    logger.info(formatHardenReport(report));
  }

  if (opts.gate && report.failedCount > 0) {
    logger.error(`Harden gate failed: ${report.failedCount} dimension(s) above ${HARDEN_GATE_THRESHOLD} did not pass.`);
    process.exitCode = 1;
  }
}
