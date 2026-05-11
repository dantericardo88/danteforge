// Tests for DanteSanitize retention/undo/lessons/check (Sprint 7)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  pruneBackups,
  undoLastSplit,
  recordSanitizeLesson,
  checkOnly,
} from '../src/core/sanitize-retention.js';
import { SANITIZE_BACKUP_DIR } from '../src/core/sanitize-types.js';

const tmpDirs: string[] = [];
async function makeTmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-retention-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

// ── pruneBackups ─────────────────────────────────────────────────────────────

describe('pruneBackups', () => {
  it('returns zero counts when no backup dir exists', async () => {
    const cwd = await makeTmp();
    const r = await pruneBackups({ cwd });
    assert.equal(r.scanned, 0);
    assert.equal(r.deleted, 0);
  });

  it('deletes files older than retentionDays', async () => {
    const cwd = await makeTmp();
    const backupDir = path.join(cwd, SANITIZE_BACKUP_DIR);
    await fs.mkdir(backupDir, { recursive: true });
    const old = path.join(backupDir, 'old.bak');
    const fresh = path.join(backupDir, 'fresh.bak');
    await fs.writeFile(old, 'old content');
    await fs.writeFile(fresh, 'fresh content');
    // Age the old file by 30 days
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await fs.utimes(old, oldDate, oldDate);

    const r = await pruneBackups({ cwd, retentionDays: 7 });
    assert.equal(r.scanned, 2);
    assert.equal(r.deleted, 1);
    assert.equal(r.retained, 1);
    assert.ok(r.totalBytesFreed > 0);
    await assert.rejects(() => fs.access(old));
    await fs.access(fresh);  // still exists
  });

  it('ignores non-.bak files', async () => {
    const cwd = await makeTmp();
    const backupDir = path.join(cwd, SANITIZE_BACKUP_DIR);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, 'not-a-backup.txt'), 'x');
    const r = await pruneBackups({ cwd });
    assert.equal(r.scanned, 0);
  });
});

// ── undoLastSplit ────────────────────────────────────────────────────────────

describe('undoLastSplit', () => {
  it('returns failure when no backups exist', async () => {
    const cwd = await makeTmp();
    const r = await undoLastSplit({ cwd });
    assert.equal(r.restored.length, 0);
    assert.ok(r.reason);
  });

  it('restores the most recent backup', async () => {
    const cwd = await makeTmp();
    const backupDir = path.join(cwd, SANITIZE_BACKUP_DIR);
    const sourceDir = path.join(cwd, 'src', 'core');
    await fs.mkdir(backupDir, { recursive: true });
    await fs.mkdir(sourceDir, { recursive: true });

    // Create a backup file with timestamp suffix
    const backupPath = path.join(backupDir, 'foo-1234567890.bak');
    await fs.writeFile(backupPath, 'export const ORIGINAL_CONTENT = 1;');
    // Create the destination file (modified state)
    const sourcePath = path.join(sourceDir, 'foo.ts');
    await fs.writeFile(sourcePath, 'export const MODIFIED = 2;');

    const r = await undoLastSplit({ cwd });
    assert.equal(r.restored.length, 1);
    assert.equal(r.failed.length, 0);
    const restored = await fs.readFile(sourcePath, 'utf8');
    assert.ok(restored.includes('ORIGINAL_CONTENT'));
  });
});

// ── recordSanitizeLesson ────────────────────────────────────────────────────

describe('recordSanitizeLesson', () => {
  it('appends a lesson to .danteforge/lessons.md', async () => {
    const cwd = await makeTmp();
    await recordSanitizeLesson({
      cwd,
      filePath: 'src/big.ts',
      reason: 'tsserver refused complex move',
    });
    const lessonsPath = path.join(cwd, '.danteforge', 'lessons.md');
    const content = await fs.readFile(lessonsPath, 'utf8');
    assert.ok(content.includes('src/big.ts'));
    assert.ok(content.includes('tsserver refused'));
    assert.ok(content.includes('DanteSanitize'));
  });

  it('appends instead of overwriting', async () => {
    const cwd = await makeTmp();
    await recordSanitizeLesson({ cwd, filePath: 'a.ts', reason: 'first' });
    await recordSanitizeLesson({ cwd, filePath: 'b.ts', reason: 'second' });
    const content = await fs.readFile(path.join(cwd, '.danteforge', 'lessons.md'), 'utf8');
    assert.ok(content.includes('a.ts'));
    assert.ok(content.includes('b.ts'));
    assert.ok(content.includes('first'));
    assert.ok(content.includes('second'));
  });
});

// ── checkOnly ────────────────────────────────────────────────────────────────

describe('checkOnly', () => {
  function mockInspect(files: Record<string, number>) {
    return async (cwd: string) => ({
      cwd,
      files: Object.entries(files).map(([p, loc]) => ({
        relativePath: p,
        absolutePath: `${cwd}/${p}`,
        loc,
        status: (loc > 750 ? 'error' : 'ok') as 'error' | 'ok',
        allowed: true,
      })),
      summary: { totalFiles: Object.keys(files).length, idealLimit: 500, hardLimit: 750, warnings: 0, hardViolations: 0, grandfathered: 0 },
    }) as never;
  }

  it('returns ok:true when no files exceed threshold', async () => {
    const cwd = await makeTmp();
    const r = await checkOnly({
      cwd,
      threshold: 750,
      _inspect: mockInspect({ 'src/a.ts': 200, 'src/b.ts': 600 }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.violations.length, 0);
  });

  it('lists violations sorted by LOC desc', async () => {
    const cwd = await makeTmp();
    const r = await checkOnly({
      cwd,
      threshold: 750,
      _inspect: mockInspect({ 'src/small.ts': 200, 'src/medium.ts': 800, 'src/huge.ts': 1500 }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.violations.length, 2);
    assert.equal(r.violations[0]!.path, 'src/huge.ts');
    assert.equal(r.violations[1]!.path, 'src/medium.ts');
  });
});
