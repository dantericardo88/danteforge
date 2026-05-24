// compliance-report.ts — Generate a tamper-evident compliance report.
// Covers: audit trail summary, workspace role assignments, evidence files,
// Time Machine commit count, and overall compliance verdict.

import fs from 'fs/promises';
import path from 'path';
import { parseAuditLog, computeAuditSummary, filterByTimeRange, formatAuditSummary } from '../../core/audit-aggregator.js';
import { getRoleForUser } from '../../core/workspace-rbac.js';
import { loadState } from '../../core/state.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplianceReportOptions {
  cwd?: string;
  format?: 'markdown' | 'json';
  since?: string;   // ISO date string
  out?: string;     // output file path
  /** Injection seam: list evidence directory entries */
  _listDir?: (dir: string) => Promise<string[]>;
  /** Injection seam: count Time Machine commits via git log */
  _countCommits?: (cwd: string) => Promise<number>;
  /** Injection seam: write output file */
  _writeFile?: (filePath: string, content: string) => Promise<void>;
  /** Injection seam: load project state */
  _loadState?: typeof loadState;
  /** Injection seam: get workspace role */
  _getRoleForUser?: typeof getRoleForUser;
  /** Injection seam: emit to stdout */
  _stdout?: (line: string) => void;
}

export type ComplianceVerdict = 'CLEAN' | 'WARNINGS' | 'VIOLATIONS';

export interface ComplianceReport {
  generatedAt: string;
  cwd: string;
  since?: string;
  auditSummary: {
    totalEvents: number;
    successRate: number;
    timeRange: { from: string; to: string } | null;
    topActions: Array<{ action: string; count: number }>;
    recentFailures: Array<{ timestamp: string; actor: string; action: string }>;
  };
  workspaceRole: string | null;
  evidenceFiles: string[];
  timeMachineCommitCount: number;
  verdict: ComplianceVerdict;
  verdictReasons: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function listEvidenceFiles(
  cwd: string,
  _listDir?: (dir: string) => Promise<string[]>,
): Promise<string[]> {
  const evidenceDir = path.join(cwd, '.danteforge', 'evidence');
  if (_listDir) {
    try {
      return await _listDir(evidenceDir);
    } catch {
      return [];
    }
  }
  try {
    const entries = await fs.readdir(evidenceDir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile())
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function countTimeMachineCommits(
  cwd: string,
  _countCommits?: (cwd: string) => Promise<number>,
): Promise<number> {
  if (_countCommits) {
    try { return await _countCommits(cwd); } catch { return 0; }
  }
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('git', ['rev-list', '--count', 'HEAD'], { cwd });
    const count = parseInt(stdout.trim(), 10);
    return isNaN(count) ? 0 : count;
  } catch {
    return 0;
  }
}

function computeVerdict(report: Omit<ComplianceReport, 'verdict' | 'verdictReasons'>): {
  verdict: ComplianceVerdict;
  verdictReasons: string[];
} {
  const reasons: string[] = [];

  // Violations
  if (report.auditSummary.recentFailures.length > 0) {
    reasons.push(`${report.auditSummary.recentFailures.length} recent failure(s) in audit log`);
  }
  if (report.workspaceRole === null) {
    reasons.push('No workspace role configured — RBAC enforcement not active');
  }

  // Warnings
  const warningReasons: string[] = [];
  if (report.auditSummary.successRate < 90 && report.auditSummary.totalEvents > 0) {
    warningReasons.push(`Audit success rate ${report.auditSummary.successRate}% is below 90%`);
  }
  if (report.evidenceFiles.length === 0) {
    warningReasons.push('No evidence files found in .danteforge/evidence/');
  }
  if (report.timeMachineCommitCount === 0) {
    warningReasons.push('No git commits found — Time Machine coverage unknown');
  }

  const violations = reasons.filter(r =>
    r.includes('failure') || r.includes('No workspace')
  );
  const allReasons = [...violations, ...warningReasons];

  let verdict: ComplianceVerdict;
  if (violations.length > 0) {
    verdict = 'VIOLATIONS';
  } else if (warningReasons.length > 0) {
    verdict = 'WARNINGS';
  } else {
    verdict = 'CLEAN';
    allReasons.push('All compliance checks passed');
  }

  return { verdict, verdictReasons: allReasons };
}

function renderMarkdown(report: ComplianceReport): string {
  const lines: string[] = [
    '# DanteForge Compliance Report',
    '',
    `**Generated:** ${report.generatedAt}`,
    `**Project:** ${report.cwd}`,
  ];
  if (report.since) lines.push(`**Since:** ${report.since}`);

  lines.push(
    '',
    `## Verdict: ${report.verdict}`,
    '',
  );
  for (const r of report.verdictReasons) {
    lines.push(`- ${r}`);
  }

  lines.push('');

  // Audit summary
  const { auditSummary: a } = report;
  lines.push(
    '## Audit Trail',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total events | ${a.totalEvents} |`,
    `| Success rate | ${a.successRate}% |`,
  );
  if (a.timeRange) {
    lines.push(
      `| From | ${a.timeRange.from} |`,
      `| To   | ${a.timeRange.to} |`,
    );
  }

  if (a.topActions.length > 0) {
    lines.push('', '### Top Actions', '', '| Action | Count |', '|--------|-------|');
    for (const { action, count } of a.topActions) {
      lines.push(`| ${action} | ${count} |`);
    }
  }

  if (a.recentFailures.length > 0) {
    lines.push('', '### Recent Failures', '');
    for (const f of a.recentFailures) {
      lines.push(`- \`${f.timestamp}\` **${f.actor}** → ${f.action}`);
    }
  }

  // Workspace role
  lines.push(
    '',
    '## Workspace & RBAC',
    '',
    `**Current role:** ${report.workspaceRole ?? 'none (single-user mode)'}`,
  );

  // Evidence
  lines.push(
    '',
    '## Evidence Files',
    '',
    report.evidenceFiles.length === 0
      ? '_No evidence files found._'
      : report.evidenceFiles.map(f => `- ${f}`).join('\n'),
  );

  // Time Machine
  lines.push(
    '',
    '## Time Machine',
    '',
    `**Commit count:** ${report.timeMachineCommitCount}`,
    '',
  );

  return lines.join('\n');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a compliance report for the project at `options.cwd`.
 *
 * Outputs to stdout unless `--out <file>` is provided.
 * Supports markdown (default) and JSON formats.
 */
export async function runComplianceReport(options: ComplianceReportOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const format = options.format ?? 'markdown';
  const emit = options._stdout ?? ((l: string) => process.stdout.write(l + '\n'));
  const loadStateFn = options._loadState ?? loadState;
  const getRoleFn = options._getRoleForUser ?? getRoleForUser;
  const writeFn = options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf-8'));

  // Load state for audit log
  const state = await loadStateFn({ cwd });
  let events = parseAuditLog(state.auditLog ?? []);

  // Apply date filter
  if (options.since) {
    const toNow = new Date().toISOString();
    events = filterByTimeRange(events, options.since, toNow);
  }

  const summary = computeAuditSummary(events);

  // Workspace role
  const workspaceRole = await getRoleFn(cwd).catch(() => null);

  // Evidence files
  const evidenceFiles = await listEvidenceFiles(cwd, options._listDir);

  // Time Machine commit count
  const timeMachineCommitCount = await countTimeMachineCommits(cwd, options._countCommits);

  const partialReport: Omit<ComplianceReport, 'verdict' | 'verdictReasons'> = {
    generatedAt: new Date().toISOString(),
    cwd,
    since: options.since,
    auditSummary: {
      totalEvents: summary.totalEvents,
      successRate: summary.successRate,
      timeRange: summary.timeRange,
      topActions: summary.topActions,
      recentFailures: summary.recentFailures.map(f => ({
        timestamp: f.timestamp,
        actor: f.actor,
        action: f.action,
      })),
    },
    workspaceRole,
    evidenceFiles,
    timeMachineCommitCount,
  };

  const { verdict, verdictReasons } = computeVerdict(partialReport);
  const report: ComplianceReport = { ...partialReport, verdict, verdictReasons };

  let output: string;
  if (format === 'json') {
    output = JSON.stringify(report, null, 2);
  } else {
    output = renderMarkdown(report);
  }

  if (options.out) {
    await writeFn(options.out, output);
  } else {
    emit(output);
  }
}
