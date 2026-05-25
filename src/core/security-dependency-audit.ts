// security-dependency-audit.ts — npm audit integration for the security dimension.
// Spawns real npm audit, parses structured JSON output, scores by severity.
// Injection seam: _runAudit replaces the real subprocess in tests.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuditVulnerability {
  name: string;
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info';
  via: string[];
  fixAvailable: boolean;
}

export interface DependencyAuditResult {
  ranAt: string;
  totalDependencies: number;
  vulnerabilities: AuditVulnerability[];
  counts: { critical: number; high: number; moderate: number; low: number; info: number };
  score: number;
  passed: boolean;
  rawExitCode: number;
}

export interface DependencyAuditOptions {
  cwd?: string;
  failOnSeverity?: 'critical' | 'high' | 'moderate' | 'low';
  /** Injection seam: override npm audit subprocess for tests. */
  _runAudit?: (cwd: string) => Promise<{ stdout: string; exitCode: number }>;
}

// ── Score calculation ─────────────────────────────────────────────────────────

export function scoreDependencyAudit(counts: DependencyAuditResult['counts']): number {
  if (counts.critical > 0) return Math.max(0, 3 - counts.critical);
  if (counts.high > 0) return Math.max(3, 5 - Math.floor(counts.high / 2));
  if (counts.moderate > 0) return Math.max(6, 7 - Math.floor(counts.moderate / 3));
  if (counts.low > 0) return 8;
  return 10;
}

// ── npm audit parser ──────────────────────────────────────────────────────────

function parseAuditJson(stdout: string, exitCode: number): DependencyAuditResult {
  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  const vulnerabilities: AuditVulnerability[] = [];

  try {
    const parsed = JSON.parse(stdout) as {
      metadata?: { totalDependencies?: number; vulnerabilities?: Record<string, number> };
      vulnerabilities?: Record<string, {
        name?: string;
        severity?: string;
        via?: unknown[];
        fixAvailable?: boolean;
      }>;
    };

    const meta = parsed.metadata ?? {};
    const totalDependencies = meta.totalDependencies ?? 0;

    // npm audit --json v7+ format
    for (const [, vuln] of Object.entries(parsed.vulnerabilities ?? {})) {
      const sev = (vuln.severity ?? 'info') as AuditVulnerability['severity'];
      if (sev in counts) counts[sev]++;
      vulnerabilities.push({
        name: vuln.name ?? 'unknown',
        severity: sev,
        via: (vuln.via ?? []).map(v => (typeof v === 'string' ? v : (v as { name?: string }).name ?? 'unknown')),
        fixAvailable: vuln.fixAvailable ?? false,
      });
    }

    return {
      ranAt: new Date().toISOString(),
      totalDependencies,
      vulnerabilities,
      counts,
      score: scoreDependencyAudit(counts),
      passed: counts.critical === 0 && counts.high === 0,
      rawExitCode: exitCode,
    };
  } catch {
    return {
      ranAt: new Date().toISOString(),
      totalDependencies: 0,
      vulnerabilities: [],
      counts,
      score: 5,
      passed: exitCode === 0,
      rawExitCode: exitCode,
    };
  }
}

// ── Real subprocess runner ────────────────────────────────────────────────────

async function defaultRunAudit(cwd: string): Promise<{ stdout: string; exitCode: number }> {
  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
      cwd,
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; code?: number };
    return { stdout: e.stdout ?? '{}', exitCode: e.code ?? 1 };
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function runDependencyAudit(options: DependencyAuditOptions = {}): Promise<DependencyAuditResult> {
  const cwd = options.cwd ?? process.cwd();
  const runAudit = options._runAudit ?? defaultRunAudit;
  const { stdout, exitCode } = await runAudit(cwd);
  const result = parseAuditJson(stdout, exitCode);

  if (options.failOnSeverity) {
    const order: AuditVulnerability['severity'][] = ['critical', 'high', 'moderate', 'low', 'info'];
    const threshold = order.indexOf(options.failOnSeverity);
    const hasFailing = order.slice(0, threshold + 1).some(s => result.counts[s] > 0);
    if (hasFailing) result.passed = false;
  }

  return result;
}

export function formatAuditSummary(result: DependencyAuditResult): string {
  const { counts, score, passed } = result;
  const lines = [
    `npm audit — score: ${score}/10 | ${passed ? 'PASS' : 'FAIL'}`,
    `  critical: ${counts.critical}  high: ${counts.high}  moderate: ${counts.moderate}  low: ${counts.low}`,
  ];
  if (result.vulnerabilities.length > 0) {
    const top = result.vulnerabilities
      .filter(v => v.severity === 'critical' || v.severity === 'high')
      .slice(0, 3);
    for (const v of top) {
      lines.push(`  [${v.severity.toUpperCase()}] ${v.name} — fix: ${v.fixAvailable ? 'yes' : 'no'}`);
    }
  }
  return lines.join('\n');
}
