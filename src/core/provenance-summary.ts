import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProvenanceSummary {
  project: string;
  evidenceFileCount: number;
  timeMachineCommitCount: number;
  sessionCount: number;
  recentActions: ProvenanceAction[];
  integrityStatus: 'CLEAN' | 'WARNINGS' | 'TAMPERED';
  verifiedCount: number;
  failedCount: number;
}

export interface ProvenanceAction {
  date: string;
  command: string;
  filesChanged: number;
  outcome: 'success' | 'failure' | 'unknown';
  sessionId?: string;
}

// ── Internal audit log entry shape ────────────────────────────────────────────

interface AuditLogEntry {
  timestamp?: string;
  eventType?: string;
  command?: string;
  actor?: string;
  status?: string;
  outcome?: string;
  sessionId?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
}

// ── Injected dependencies interface (for testability) ─────────────────────────

export interface ProvenanceSummaryDeps {
  _readDir?: (p: string) => Promise<string[]>;
  _readFile?: (p: string) => Promise<string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveOutcome(entry: AuditLogEntry): 'success' | 'failure' | 'unknown' {
  const raw = (entry.status ?? entry.outcome ?? '').toLowerCase();
  if (raw === 'success' || raw === 'pass' || raw === 'passed') return 'success';
  if (raw === 'failure' || raw === 'fail' || raw === 'failed' || raw === 'error') return 'failure';
  return 'unknown';
}

function extractCommand(entry: AuditLogEntry): string {
  if (entry.command) return entry.command;
  if (entry.eventType) return entry.eventType;
  if (entry.actor) return entry.actor;
  return 'agent-action';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return iso;
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

async function safeReadDir(
  dirPath: string,
  readDir: (p: string) => Promise<string[]>,
): Promise<string[]> {
  try {
    return await readDir(toPosix(dirPath));
  } catch {
    return [];
  }
}

async function safeReadFile(
  filePath: string,
  readFile: (p: string) => Promise<string>,
): Promise<string> {
  try {
    return await readFile(toPosix(filePath));
  } catch {
    return '';
  }
}

// ── Core builder ──────────────────────────────────────────────────────────────

export async function buildProvenanceSummary(
  cwd: string,
  options: ProvenanceSummaryDeps = {},
): Promise<ProvenanceSummary> {
  const readDir = options._readDir ?? ((p) => fs.readdir(p));
  const readFile = options._readFile ?? ((p) => fs.readFile(p, 'utf8'));

  const dfDir = path.join(cwd, '.danteforge');

  // ── Project name from STATE.yaml (best-effort) ──────────────────────────────
  let project = path.basename(cwd);
  const stateRaw = await safeReadFile(path.join(dfDir, 'STATE.yaml'), readFile);
  const projectMatch = stateRaw.match(/^project:\s*(.+)$/m);
  if (projectMatch) project = projectMatch[1].trim();

  // ── Evidence file count ────────────────────────────────────────────────────
  const evidenceDir = path.join(dfDir, 'evidence');
  const evidenceFiles = await safeReadDir(evidenceDir, readDir);
  const evidenceFileCount = evidenceFiles.filter(f => f.endsWith('.json')).length;

  // ── Integrity check — evidence files must be valid JSON ───────────────────
  let verifiedCount = 0;
  let failedCount = 0;
  for (const file of evidenceFiles.filter(f => f.endsWith('.json'))) {
    const raw = await safeReadFile(path.join(evidenceDir, file), readFile);
    if (!raw) { failedCount++; continue; }
    try {
      JSON.parse(raw);
      verifiedCount++;
    } catch {
      failedCount++;
    }
  }

  const integrityStatus: ProvenanceSummary['integrityStatus'] =
    failedCount > 0 ? 'TAMPERED' : evidenceFileCount > 0 ? 'CLEAN' : 'CLEAN';

  // ── Time Machine commit count ──────────────────────────────────────────────
  const tmCommitsDir = path.join(dfDir, 'time-machine', 'commits');
  const tmFiles = await safeReadDir(tmCommitsDir, readDir);
  const timeMachineCommitCount = tmFiles.filter(f => f.endsWith('.json')).length;

  // ── Parse audit log ────────────────────────────────────────────────────────
  const auditLogPath = path.join(dfDir, 'audit', 'detailed.jsonl');
  const auditRaw = await safeReadFile(auditLogPath, readFile);

  const entries: AuditLogEntry[] = [];
  if (auditRaw) {
    for (const line of auditRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as AuditLogEntry);
      } catch {
        // skip malformed lines
      }
    }
  }

  // ── Unique sessions ────────────────────────────────────────────────────────
  const sessionIds = new Set<string>();
  for (const entry of entries) {
    if (entry.sessionId) sessionIds.add(entry.sessionId);
  }
  const sessionCount = sessionIds.size;

  // ── Recent actions (last 10) ───────────────────────────────────────────────
  const sorted = entries
    .filter(e => e.timestamp)
    .sort((a, b) => {
      const ta = new Date(a.timestamp ?? 0).getTime();
      const tb = new Date(b.timestamp ?? 0).getTime();
      return tb - ta;
    });

  const recentActions: ProvenanceAction[] = sorted.slice(0, 10).map(entry => ({
    date: formatDate(entry.timestamp ?? ''),
    command: extractCommand(entry),
    filesChanged: entry.filePath ? 1 : 0,
    outcome: resolveOutcome(entry),
    sessionId: entry.sessionId,
  }));

  return {
    project,
    evidenceFileCount,
    timeMachineCommitCount,
    sessionCount,
    recentActions,
    integrityStatus,
    verifiedCount,
    failedCount,
  };
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatProvenanceSummary(summary: ProvenanceSummary): string {
  const lines: string[] = [];

  lines.push('Agent Activity Provenance Summary');
  lines.push('==================================');
  lines.push(`Project: ${summary.project}`);
  lines.push(`Evidence files: ${summary.evidenceFileCount}`);
  lines.push(`Time Machine commits: ${summary.timeMachineCommitCount}`);
  lines.push(`Sessions: ${summary.sessionCount} unique session IDs`);
  lines.push('');

  if (summary.recentActions.length > 0) {
    lines.push('Recent activity (last 10 agent actions):');
    for (const action of summary.recentActions) {
      const files = action.filesChanged === 1 ? '1 file' : `${action.filesChanged} files`;
      lines.push(`  ${action.date}  ${action.command}  ${files}  ${action.outcome}`);
    }
  } else {
    lines.push('Recent activity: no agent actions recorded yet');
  }

  lines.push('');
  const integrityLine = summary.integrityStatus === 'CLEAN'
    ? `Proof integrity: CLEAN (${summary.verifiedCount} verified, ${summary.failedCount} failed)`
    : summary.integrityStatus === 'WARNINGS'
    ? `Proof integrity: WARNINGS (${summary.verifiedCount} verified, ${summary.failedCount} failed)`
    : `Proof integrity: TAMPERED (${summary.verifiedCount} verified, ${summary.failedCount} failed)`;
  lines.push(integrityLine);
  lines.push('');
  lines.push('Run `danteforge time-machine query --kind session-graph` for full graph.');

  return lines.join('\n');
}
