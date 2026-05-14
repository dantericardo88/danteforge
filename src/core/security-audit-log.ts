// Security audit logger — records security-relevant events to a structured JSONL file.
// Synchronous, best-effort: errors are swallowed so the caller's main path is never blocked.

import fs from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SecurityEventType =
  | 'api_key_access'
  | 'path_traversal_attempt'
  | 'shell_command'
  | 'file_write'
  | 'rate_limit_hit'
  | 'suspicious_input';

export type SecuritySeverity = 'info' | 'warn' | 'critical';

export interface SecurityEvent {
  type: SecurityEventType;
  severity: SecuritySeverity;
  detail: string;
  timestamp: string;
  command?: string;
}

export interface SecuritySummary {
  totalEvents: number;
  byType: Record<string, number>;
  bySeverity: Record<SecuritySeverity, number>;
  hasCritical: boolean;
  criticalEvents: SecurityEvent[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AUDIT_FILE = '.danteforge/security-audit.jsonl';

// ── Appender signature (injectable for tests) ─────────────────────────────────

export type AppendFn = (filePath: string, line: string) => void;

function defaultAppend(filePath: string, line: string): void {
  // Ensure directory exists synchronously (best-effort)
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch {
    // Never throw — audit log is best-effort
  }
}

// ── Reader signature (injectable for tests) ───────────────────────────────────

export type ReadFn = (filePath: string) => string;

function defaultRead(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Records a security event to `.danteforge/security-audit.jsonl`.
 * Synchronous, best-effort — never throws.
 *
 * @param event   The security event to record.
 * @param cwd     Project working directory (defaults to `process.cwd()`).
 * @param _append Injection seam for testing (defaults to fs.appendFileSync).
 */
export function logSecurityEvent(
  event: SecurityEvent,
  cwd?: string,
  _append?: AppendFn,
): void {
  try {
    const base = cwd ?? process.cwd();
    const filePath = path.join(base, AUDIT_FILE);
    const appendFn = _append ?? defaultAppend;
    const line = JSON.stringify(event);
    appendFn(filePath, line);
  } catch {
    // Best-effort — never propagate
  }
}

/**
 * Reads the security audit log and returns a summary.
 *
 * @param cwd   Project working directory (defaults to `process.cwd()`).
 * @param _read Injection seam for testing.
 */
export function getSecuritySummary(
  cwd?: string,
  _read?: ReadFn,
): SecuritySummary {
  const base = cwd ?? process.cwd();
  const filePath = path.join(base, AUDIT_FILE);
  const readFn = _read ?? defaultRead;

  const raw = readFn(filePath);
  const events: SecurityEvent[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as SecurityEvent);
    } catch {
      // Skip malformed lines
    }
  }

  const byType: Record<string, number> = {};
  const bySeverity: Record<SecuritySeverity, number> = { info: 0, warn: 0, critical: 0 };
  const criticalEvents: SecurityEvent[] = [];

  for (const ev of events) {
    byType[ev.type] = (byType[ev.type] ?? 0) + 1;
    bySeverity[ev.severity] = (bySeverity[ev.severity] ?? 0) + 1;
    if (ev.severity === 'critical') criticalEvents.push(ev);
  }

  return {
    totalEvents: events.length,
    byType,
    bySeverity,
    hasCritical: criticalEvents.length > 0,
    criticalEvents,
  };
}

/**
 * Builds a SecurityEvent with the current ISO timestamp.
 * Convenience factory used by callers that don't need to set timestamp manually.
 */
export function makeSecurityEvent(
  type: SecurityEventType,
  severity: SecuritySeverity,
  detail: string,
  command?: string,
): SecurityEvent {
  return { type, severity, detail, timestamp: new Date().toISOString(), command };
}
