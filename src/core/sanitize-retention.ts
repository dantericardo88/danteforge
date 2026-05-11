// DanteSanitize — Retention, undo, learning loop, --check (Sprint 7)
//
// - pruneBackups: deletes .bak files older than N days
// - undoLastSplit: restores from the most recent backup (best-effort)
// - recordLesson: appends a failed-split lesson to .danteforge/lessons.md
// - checkOnly: reports violators without modifying anything
import fs from 'node:fs/promises';
import path from 'node:path';
import { SANITIZE_BACKUP_DIR } from './sanitize-types.js';

export interface PruneBackupsOptions {
  cwd: string;
  retentionDays?: number;  // default 7
}

export interface PruneBackupsResult {
  scanned: number;
  deleted: number;
  retained: number;
  totalBytesFreed: number;
}

export async function pruneBackups(options: PruneBackupsOptions): Promise<PruneBackupsResult> {
  const cwd = options.cwd;
  const retentionDays = options.retentionDays ?? 7;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const backupDir = path.join(cwd, SANITIZE_BACKUP_DIR);

  let scanned = 0, deleted = 0, retained = 0, freed = 0;

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(backupDir, { withFileTypes: true });
  } catch {
    return { scanned: 0, deleted: 0, retained: 0, totalBytesFreed: 0 };
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.bak')) continue;
    scanned++;
    const full = path.join(backupDir, entry.name);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(full);
        deleted++;
        freed += stat.size;
      } else {
        retained++;
      }
    } catch { /* best-effort */ }
  }

  return { scanned, deleted, retained, totalBytesFreed: freed };
}

// ── Undo ─────────────────────────────────────────────────────────────────────

export interface UndoSplitOptions {
  cwd: string;
  /** Path to restore (cwd-relative). If omitted, restores the most recent .bak. */
  filePath?: string;
}

export interface UndoSplitResult {
  restored: string[];
  failed: string[];
  reason?: string;
}

export async function undoLastSplit(options: UndoSplitOptions): Promise<UndoSplitResult> {
  const backupDir = path.join(options.cwd, SANITIZE_BACKUP_DIR);
  let entries: { name: string; full: string; mtime: number }[];
  try {
    const raw = await fs.readdir(backupDir, { withFileTypes: true });
    entries = await Promise.all(
      raw.filter(e => e.isFile() && e.name.endsWith('.bak'))
        .map(async e => {
          const full = path.join(backupDir, e.name);
          const stat = await fs.stat(full);
          return { name: e.name, full, mtime: stat.mtimeMs };
        }),
    );
  } catch {
    return { restored: [], failed: [], reason: 'No backups directory found' };
  }

  if (entries.length === 0) {
    return { restored: [], failed: [], reason: 'No backups to restore' };
  }

  // Sort most-recent first
  entries.sort((a, b) => b.mtime - a.mtime);

  // Determine which backup to use
  let target: { name: string; full: string; mtime: number };
  if (options.filePath) {
    const stem = path.basename(options.filePath, path.extname(options.filePath));
    const match = entries.find(e => e.name.startsWith(stem + '-'));
    if (!match) {
      return { restored: [], failed: [options.filePath], reason: `No backup found for ${options.filePath}` };
    }
    target = match;
  } else {
    target = entries[0]!;
  }

  // Backup name format: {stem}-{timestamp}.bak
  // We need to figure out where the original file lives — store sidecar metadata in future.
  // For now, infer: backup name "compete-matrix-1234567.bak" → original "src/core/compete-matrix.ts" (guess)
  const stemFromBackup = target.name.replace(/-\d+\.bak$/, '');
  const possiblePaths = [
    `src/core/${stemFromBackup}.ts`,
    `src/cli/commands/${stemFromBackup}.ts`,
    `src/${stemFromBackup}.ts`,
  ];

  let restoredPath: string | null = null;
  let content: string;
  try {
    content = await fs.readFile(target.full, 'utf8');
  } catch (err) {
    return { restored: [], failed: [target.name], reason: `Could not read backup: ${String(err)}` };
  }

  for (const candidate of possiblePaths) {
    try {
      const fullPath = path.join(options.cwd, candidate);
      await fs.access(fullPath);
      await fs.writeFile(fullPath, content, 'utf8');
      restoredPath = candidate;
      break;
    } catch { /* try next */ }
  }

  if (!restoredPath) {
    return {
      restored: [],
      failed: [target.name],
      reason: `Could not determine destination for backup ${target.name}. Tried: ${possiblePaths.join(', ')}`,
    };
  }

  return { restored: [restoredPath], failed: [] };
}

// ── Learning loop ────────────────────────────────────────────────────────────

export interface RecordLessonOptions {
  cwd: string;
  filePath: string;
  reason: string;
  what_tried?: string;
}

export async function recordSanitizeLesson(options: RecordLessonOptions): Promise<void> {
  const lessonsPath = path.join(options.cwd, '.danteforge', 'lessons.md');
  const entry = `

## DanteSanitize — failed split (${new Date().toISOString().slice(0, 10)})

**File:** \`${options.filePath}\`
**Reason:** ${options.reason}
${options.what_tried ? `**Attempted:** ${options.what_tried}\n` : ''}
**Action:** This file needs manual review or a different split strategy.
`;
  try {
    await fs.mkdir(path.dirname(lessonsPath), { recursive: true });
    await fs.appendFile(lessonsPath, entry, 'utf8');
  } catch { /* best-effort — never blocks */ }
}

// ── Check-only mode ─────────────────────────────────────────────────────────

export interface CheckOnlyOptions {
  cwd: string;
  threshold?: number;
  _inspect?: import('./sanitize-types.js').SanitizeEngineOptions['_inspect'];
}

export interface CheckOnlyResult {
  ok: boolean;          // true if no violations
  violations: { path: string; loc: number }[];
  threshold: number;
}

export async function checkOnly(options: CheckOnlyOptions): Promise<CheckOnlyResult> {
  const threshold = options.threshold ?? 750;
  const { inspectSourceFileSizes } = await import('./file-size-hygiene.js');
  const inspector = options._inspect ?? inspectSourceFileSizes;
  const report = await inspector(options.cwd);
  const violations: { path: string; loc: number }[] = [];
  for (const entry of report.files) {
    if (entry.loc > threshold) {
      violations.push({ path: entry.relativePath, loc: entry.loc });
    }
  }
  violations.sort((a, b) => b.loc - a.loc);
  return { ok: violations.length === 0, violations, threshold };
}
