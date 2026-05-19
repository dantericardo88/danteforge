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
  buildMigrationProposals,
  applyMigrationProposals,
  type MigrationResult,
  type Confidence,
} from '../../matrix/engines/harden-migrate.js';
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

// ── Migrate subcommand ────────────────────────────────────────────────────────

export interface RunMigrateOptions {
  cwd?: string;
  apply?: boolean;             // write inferred callsites to matrix.json
  acceptConfidence?: Array<'high' | 'medium' | 'low'>;
  json?: boolean;
  _loadMatrix?: typeof loadMatrix;
  _writeMatrix?: (cwd: string, m: unknown) => Promise<void>;
}

export function formatMigrationReport(result: MigrationResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold('\nDanteForge Harden Migration Proposal'));
  lines.push(chalk.dim('─'.repeat(60)));
  lines.push('');
  lines.push(`  ${chalk.bold('Total dimensions:')}     ${result.totalDimensions}`);
  lines.push(`  ${chalk.green('Already declared:')}    ${result.alreadyDeclared}`);
  lines.push(`  ${chalk.green('Inferred (high):')}     ${result.inferredHigh}`);
  lines.push(`  ${chalk.yellow('Inferred (medium):')}   ${result.inferredMedium}`);
  lines.push(`  ${chalk.yellow('Inferred (low):')}      ${result.inferredLow}`);
  lines.push(`  ${chalk.red('Unable to infer:')}     ${result.unableToInfer}`);
  lines.push('');

  const grouped = new Map<Confidence | 'declared' | 'none', typeof result.proposals>();
  for (const p of result.proposals) {
    const key = p.alreadyDeclared ? 'declared' : (p.inferred ? p.confidence : 'none');
    const list = grouped.get(key) ?? [];
    list.push(p);
    grouped.set(key, list);
  }

  const order: Array<{ key: Confidence | 'declared' | 'none'; label: string; color: typeof chalk.green }> = [
    { key: 'high', label: 'HIGH CONFIDENCE — safe to --apply', color: chalk.green },
    { key: 'medium', label: 'MEDIUM CONFIDENCE — review then --apply', color: chalk.yellow },
    { key: 'low', label: 'LOW CONFIDENCE — manual review recommended', color: chalk.yellow },
    { key: 'none', label: 'NO INFERENCE — declare manually', color: chalk.red },
    { key: 'declared', label: 'ALREADY DECLARED — skipped', color: chalk.dim },
  ];

  for (const { key, label, color } of order) {
    const items = grouped.get(key);
    if (!items || items.length === 0) continue;
    lines.push(color(`  ${label} (${items.length}):`));
    for (const p of items.slice(0, 25)) {
      const tail = p.inferred ? `${p.inferred.file}::${p.inferred.symbol}` : chalk.red('(no proposal)');
      lines.push(`    ${chalk.cyan(p.dimensionId.padEnd(30))} → ${tail}`);
      lines.push(`      ${chalk.dim(p.reason)}`);
    }
    if (items.length > 25) lines.push(chalk.dim(`    … and ${items.length - 25} more`));
    lines.push('');
  }
  return lines.join('\n');
}

export async function runHardenMigrateCommand(opts: RunMigrateOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const loadMatrixFn = opts._loadMatrix ?? loadMatrix;
  const matrix = await loadMatrixFn(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);

  const result = await buildMigrationProposals(matrix as unknown as { dimensions: import('../../core/compete-matrix.js').MatrixDimension[] }, { cwd });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    logger.info(formatMigrationReport(result));
  }

  if (opts.apply) {
    const accept = opts.acceptConfidence ?? ['high', 'medium'];
    const count = applyMigrationProposals(
      matrix as unknown as { dimensions: import('../../core/compete-matrix.js').MatrixDimension[] },
      result,
      accept,
    );
    if (count > 0) {
      const writeMatrix = opts._writeMatrix ?? (async (cwd: string, m: unknown) => {
        const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
        await fs.writeFile(matrixPath, JSON.stringify(m, null, 2), 'utf8');
      });
      await writeMatrix(cwd, matrix);
      logger.success(`Applied ${count} callsite declaration(s) to matrix.json (confidence: ${accept.join(', ')}).`);
    } else {
      logger.info('No changes to apply.');
    }
  } else if (!opts.json) {
    logger.info(chalk.dim('  Dry-run: matrix.json was NOT modified. Use --apply to write.'));
  }
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

// ── audit-orphans (Three Pillars Pillar 2) ───────────────────────────────────
//
// Wraps the orphan-audit harden check as a dedicated subcommand. Produces a
// structured report of every dim whose capability_callsite is only imported
// from test/spec files, capped at score 6.0 per the substrate gate.

export interface AuditOrphansResult {
  cwd: string;
  totalDimensions: number;
  orphans: Array<{ dimensionId: string; cap: number; reason: string; callsite?: { file: string; symbol: string } }>;
  clean: number;
}

export async function runHardenAuditOrphans(opts: RunHardenOptions = {}): Promise<AuditOrphansResult> {
  // Audit subcommands run the check on EVERY dim regardless of the 7.0 harden
  // gate threshold — the gate matters for proposal-acceptance, the audit is a
  // standalone "show me every orphan" inspection. Call the engine directly.
  const cwd = opts.cwd ?? process.cwd();
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);
  const dims = opts.dim
    ? matrix.dimensions.filter(d => d.id === opts.dim)
    : matrix.dimensions;
  const { checkOrphanAudit } = await import('../../matrix/engines/hardener.js');
  const result: AuditOrphansResult = {
    cwd,
    totalDimensions: dims.length,
    orphans: [],
    clean: 0,
  };
  for (const dim of dims) {
    const checkResult = await checkOrphanAudit(dim, cwd);
    if (checkResult.skipped) {
      // No callsite declared — nothing to audit.
      result.clean++;
      continue;
    }
    if (!checkResult.passed) {
      const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as { file: string; symbol: string } | undefined;
      result.orphans.push({
        dimensionId: dim.id,
        cap: checkResult.scoreCap,
        reason: checkResult.findings[0]?.reason ?? 'orphan: no production imports',
        ...(callsite ? { callsite } : {}),
      });
    } else {
      result.clean++;
    }
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    logger.info('');
    logger.info(chalk.bold('Orphan Audit (Three Pillars P2)'));
    logger.info(chalk.dim('─'.repeat(60)));
    if (result.orphans.length === 0) {
      logger.success(`All ${result.totalDimensions} dimension(s) are wired into production.`);
    } else {
      logger.warn(`${result.orphans.length} orphan dim(s) found (capped at 6.0):`);
      for (const o of result.orphans) {
        const loc = o.callsite ? `${chalk.cyan(o.callsite.file)}::${chalk.bold(o.callsite.symbol)}` : chalk.dim('(no callsite declared)');
        logger.info(`  ${chalk.red('●')} ${o.dimensionId}  ${loc}  ${chalk.dim(`cap=${o.cap}`)}`);
        logger.info(`     ${chalk.dim(o.reason)}`);
      }
    }
    logger.info('');
  }
  return result;
}

// ── audit-recency (Three Pillars Pillar 3) ───────────────────────────────────

export interface AuditRecencyResult {
  cwd: string;
  totalDimensions: number;
  stale: Array<{ dimensionId: string; cap: number; reason: string; daysSinceFreshest: number; callsite?: { file: string; symbol: string } }>;
  fresh: number;
  thresholdDays: number;
}

export async function runHardenAuditRecency(opts: RunHardenOptions & { thresholdDays?: number } = {}): Promise<AuditRecencyResult> {
  const thresholdDays = opts.thresholdDays ?? 30;
  const cwd = opts.cwd ?? process.cwd();
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);
  const dims = opts.dim
    ? matrix.dimensions.filter(d => d.id === opts.dim)
    : matrix.dimensions;
  const { checkRecencyCheck } = await import('../../matrix/engines/hardener.js');
  const { createSearchEngine } = await import('../../matrix/search/factory.js');
  const engine = createSearchEngine({ preference: 'native' });
  await engine.index(cwd).catch(() => undefined);

  const result: AuditRecencyResult = {
    cwd,
    totalDimensions: dims.length,
    stale: [],
    fresh: 0,
    thresholdDays,
  };
  for (const dim of dims) {
    const checkResult = await checkRecencyCheck(dim, cwd, undefined, engine);
    if (checkResult.skipped) {
      result.fresh++;
      continue;
    }
    if (!checkResult.passed) {
      const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as { file: string; symbol: string } | undefined;
      const daysMatch = checkResult.findings[0]?.reason.match(/(\d+) days/);
      const daysSinceFreshest = daysMatch ? parseInt(daysMatch[1]!, 10) : thresholdDays + 1;
      result.stale.push({
        dimensionId: dim.id,
        cap: checkResult.scoreCap,
        reason: checkResult.findings[0]?.reason ?? 'stale: no fresh production import',
        daysSinceFreshest,
        ...(callsite ? { callsite } : {}),
      });
    } else {
      result.fresh++;
    }
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    logger.info('');
    logger.info(chalk.bold(`Recency Audit (Three Pillars P3, threshold=${thresholdDays}d)`));
    logger.info(chalk.dim('─'.repeat(60)));
    if (result.stale.length === 0) {
      logger.success(`All ${result.totalDimensions} dimension(s) have fresh production imports.`);
    } else {
      logger.warn(`${result.stale.length} stale dim(s) found (capped at 7.0):`);
      for (const s of result.stale) {
        const loc = s.callsite ? `${chalk.cyan(s.callsite.file)}::${chalk.bold(s.callsite.symbol)}` : chalk.dim('(no callsite declared)');
        logger.info(`  ${chalk.yellow('●')} ${s.dimensionId}  ${loc}  ${chalk.dim(`cap=${s.cap}  ${s.daysSinceFreshest}d`)}`);
        logger.info(`     ${chalk.dim(s.reason)}`);
      }
    }
    logger.info('');
  }
  return result;
}
