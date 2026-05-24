// Error reporter — aggregates errors, warnings, and fatals during a run.
// Provides a Markdown-friendly summary suitable for CLI output and audit logs.

import { isDanteForgeError } from './error-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorEntry {
  code: string;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface ErrorReport {
  errors: ErrorEntry[];
  warnings: string[];
  fatals: string[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createErrorReport(): ErrorReport {
  return { errors: [], warnings: [], fatals: [] };
}

// ---------------------------------------------------------------------------
// Mutation helpers
// ---------------------------------------------------------------------------

/** Add a structured error (DanteForgeError) or a plain Error/string to the report. */
export function addError(report: ErrorReport, err: unknown): void {
  if (isDanteForgeError(err)) {
    report.errors.push({
      code: err.code,
      message: err.message,
      timestamp: new Date().toISOString(),
      context: Object.keys(err.context).length > 0 ? err.context : undefined,
    });
  } else if (err instanceof Error) {
    report.errors.push({
      code: 'UNKNOWN_ERROR',
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  } else {
    report.errors.push({
      code: 'UNKNOWN_ERROR',
      message: String(err),
      timestamp: new Date().toISOString(),
    });
  }
}

/** Add a non-blocking warning message. */
export function addWarning(report: ErrorReport, message: string): void {
  report.warnings.push(message);
}

/** Add a fatal (blocking) message — treated as a hard failure. */
export function addFatal(report: ErrorReport, message: string): void {
  report.fatals.push(message);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Returns true when there are any fatal entries (blocking errors). */
export function hasBlockingErrors(report: ErrorReport): boolean {
  return report.fatals.length > 0;
}

/** Total number of errors + fatals. */
export function totalErrorCount(report: ErrorReport): number {
  return report.errors.length + report.fatals.length;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Render the report as a Markdown summary string. */
export function formatErrorReport(report: ErrorReport): string {
  const sections: string[] = [];

  sections.push('## Error Report');
  sections.push('');

  // Summary line
  const parts: string[] = [];
  if (report.fatals.length > 0) {
    parts.push(`${report.fatals.length} fatal(s)`);
  }
  if (report.errors.length > 0) {
    parts.push(`${report.errors.length} error(s)`);
  }
  if (report.warnings.length > 0) {
    parts.push(`${report.warnings.length} warning(s)`);
  }
  const totalIssues = report.fatals.length + report.errors.length + report.warnings.length;
  if (totalIssues === 0) {
    sections.push('No issues recorded.');
    return sections.join('\n');
  }
  sections.push(`**${parts.join(', ')}**`);
  sections.push('');

  // Fatals
  if (report.fatals.length > 0) {
    sections.push('### Fatals');
    for (const fatal of report.fatals) {
      sections.push(`- FATAL: ${fatal}`);
    }
    sections.push('');
  }

  // Errors
  if (report.errors.length > 0) {
    sections.push('### Errors');
    for (const entry of report.errors) {
      const ctx =
        entry.context && Object.keys(entry.context).length > 0
          ? ` (context: ${JSON.stringify(entry.context)})`
          : '';
      sections.push(`- \`[${entry.code}]\` ${entry.message}${ctx} — _${entry.timestamp}_`);
    }
    sections.push('');
  }

  // Warnings
  if (report.warnings.length > 0) {
    sections.push('### Warnings');
    for (const warn of report.warnings) {
      sections.push(`- ${warn}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}
