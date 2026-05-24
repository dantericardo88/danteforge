// Traceability command — maps spec requirements to plan/task coverage.
// Usage: danteforge traceability [--json] [--spec <path>] [--plan <path>]

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { buildTraceabilityReport, type TraceabilityReport } from '../../core/plan-quality-scorer.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const STATE_DIR = '.danteforge';

export interface TraceabilityOptions {
  json?: boolean;
  specFile?: string;
  planFile?: string;
  cwd?: string;
  /** Injection seam for file reads (testing) */
  _readFile?: (p: string) => Promise<string>;
}

// ── Text rendering ────────────────────────────────────────────────────────────

function renderTable(report: TraceabilityReport): string {
  const lines: string[] = [];
  const sep = '─'.repeat(80);

  lines.push('');
  lines.push(sep);
  lines.push('  SPEC-TO-PLAN TRACEABILITY REPORT');
  lines.push(`  Requirements: ${report.totalRequirements} | Covered: ${report.totalRequirements - report.uncoveredCount} | Coverage: ${report.coveragePercent}%`);
  lines.push(sep);

  if (report.rows.length === 0) {
    lines.push('  No requirements found in spec. Add numbered items or REQ-NNN labels.');
    lines.push(sep);
    return lines.join('\n');
  }

  const idW = 10;
  const reqW = 40;
  const statusW = 8;
  const taskW = 80 - idW - reqW - statusW - 4;

  const header = [
    'Req ID'.padEnd(idW),
    'Requirement'.padEnd(reqW),
    'Status'.padEnd(statusW),
    'Covering Task(s)',
  ].join(' | ');
  lines.push(`  ${header}`);
  lines.push(`  ${'─'.repeat(header.length)}`);

  for (const row of report.rows) {
    const status = row.covered ? 'COVERED' : 'MISSING';
    const statusFmt = row.covered ? status : `!${status}`;
    const taskSummary =
      row.coveringTasks.length === 0
        ? '(no matching task)'
        : row.coveringTasks[0].slice(0, taskW) +
          (row.coveringTasks.length > 1 ? ` (+${row.coveringTasks.length - 1} more)` : '');

    const reqTrunc = row.requirementText.slice(0, reqW - 1).padEnd(reqW);
    const rowLine = [
      row.reqId.padEnd(idW),
      reqTrunc,
      statusFmt.padEnd(statusW),
      taskSummary,
    ].join(' | ');

    lines.push(`  ${rowLine}`);
  }

  lines.push(sep);

  if (report.uncoveredCount > 0) {
    lines.push(`\n  WARNING: ${report.uncoveredCount} requirement(s) have no matching plan task.`);
    lines.push('  Add tasks that explicitly address these requirements.');
  } else {
    lines.push('\n  All requirements are covered by at least one plan task.');
  }

  lines.push('');
  return lines.join('\n');
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function traceability(options: TraceabilityOptions = {}): Promise<void> {
  return withErrorBoundary('traceability', async () => {
    const cwd = options.cwd ?? process.cwd();
    const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

    const specPath = options.specFile ?? path.join(cwd, STATE_DIR, 'SPEC.md');
    const planPath = options.planFile ?? path.join(cwd, STATE_DIR, 'TASKS.md');

    let specText = '';
    let planText = '';

    // Try SPEC.md
    try {
      specText = await readFile(specPath);
    } catch {
      // Fallback to AGENTS.md as secondary spec source
      try {
        specText = await readFile(path.join(cwd, 'AGENTS.md'));
      } catch {
        logger.warn('[traceability] No SPEC.md found. Pass --spec <path> or create .danteforge/SPEC.md');
      }
    }

    // Try TASKS.md first, then PLAN.md
    try {
      planText = await readFile(planPath);
    } catch {
      try {
        const fallbackPlanPath = options.planFile
          ? planPath
          : path.join(cwd, STATE_DIR, 'PLAN.md');
        planText = await readFile(fallbackPlanPath);
      } catch {
        logger.warn('[traceability] No TASKS.md or PLAN.md found. Pass --plan <path> or run "danteforge tasks" first.');
      }
    }

    const report = buildTraceabilityReport(specText, planText);

    if (options.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return;
    }

    const table = renderTable(report);
    console.log(table);

    if (report.uncoveredCount > 0) {
      process.exitCode = 1;
    }
  });
}
