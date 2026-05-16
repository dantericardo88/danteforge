// Tests for Fix C: Protected line provenance
// Verifies: add/remove/list protections, violation detection, pre-commit logic.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readProtectedLines,
  writeProtectedLines,
  addProtection,
  removeProtection,
  findViolations,
} from '../src/matrix/engines/protected-lines.js';
import {
  parseFileRange,
  matrixProtect,
  matrixProtectedLines,
  matrixUnprotect,
} from '../src/cli/commands/matrix-protected-lines.js';

// ── parseFileRange ────────────────────────────────────────────────────────────

describe('parseFileRange', () => {
  it('parses valid range', () => {
    const r = parseFileRange('src/core/feature.ts:42-80');
    assert.ok(r);
    assert.strictEqual(r.file, 'src/core/feature.ts');
    assert.strictEqual(r.startLine, 42);
    assert.strictEqual(r.endLine, 80);
  });

  it('returns null for missing range', () => {
    assert.strictEqual(parseFileRange('src/file.ts'), null);
  });

  it('returns null for reversed range', () => {
    assert.strictEqual(parseFileRange('src/file.ts:80-10'), null);
  });

  it('returns null for invalid line numbers', () => {
    assert.strictEqual(parseFileRange('src/file.ts:0-5'), null);
  });
});

// ── Engine: add / remove / read ───────────────────────────────────────────────

const tmpDirs: string[] = [];

async function makeTmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prot-test-'));
  tmpDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  await writeProtectedLines({ version: 1, description: '', protections: [] }, dir);
  return dir;
}

after(async () => {
  for (const d of tmpDirs) {
    try { await fs.rm(d, { recursive: true }); } catch { /* best-effort */ }
  }
});

describe('addProtection + readProtectedLines', () => {
  it('writes and reads back a protection', async () => {
    const cwd = await makeTmp();
    const now = () => '2026-05-16T00:00:00.000Z';
    await addProtection({
      file: 'src/core/feature.ts', startLine: 10, endLine: 50,
      dimensionId: 'testing', reason: 'core test loop', cwd, _now: now,
    });
    const data = await readProtectedLines(cwd);
    assert.strictEqual(data.protections.length, 1);
    const p = data.protections[0]!;
    assert.strictEqual(p.file, 'src/core/feature.ts');
    assert.strictEqual(p.startLine, 10);
    assert.strictEqual(p.endLine, 50);
    assert.strictEqual(p.dimensionId, 'testing');
    assert.strictEqual(p.protectedAt, '2026-05-16T00:00:00.000Z');
  });

  it('de-duplicates on same file+range+dimension', async () => {
    const cwd = await makeTmp();
    const now = () => '2026-05-16T00:00:00.000Z';
    await addProtection({ file: 'a.ts', startLine: 1, endLine: 10, dimensionId: 'x', cwd, _now: now });
    await addProtection({ file: 'a.ts', startLine: 1, endLine: 10, dimensionId: 'x', cwd, _now: now });
    const data = await readProtectedLines(cwd);
    assert.strictEqual(data.protections.length, 1);
  });

  it('normalizes backslashes to forward slashes', async () => {
    const cwd = await makeTmp();
    const now = () => '2026-05-16T00:00:00.000Z';
    await addProtection({ file: 'src\\core\\feat.ts', startLine: 1, endLine: 5, dimensionId: 'x', cwd, _now: now });
    const data = await readProtectedLines(cwd);
    assert.strictEqual(data.protections[0]!.file, 'src/core/feat.ts');
  });
});

describe('removeProtection', () => {
  it('removes a protection by file+range', async () => {
    const cwd = await makeTmp();
    const now = () => '2026-05-16T00:00:00.000Z';
    await addProtection({ file: 'b.ts', startLine: 1, endLine: 10, dimensionId: 'y', cwd, _now: now });
    await removeProtection({ file: 'b.ts', startLine: 1, endLine: 10, cwd });
    const data = await readProtectedLines(cwd);
    assert.strictEqual(data.protections.length, 0);
  });

  it('throws when no matching protection found', async () => {
    const cwd = await makeTmp();
    await assert.rejects(
      () => removeProtection({ file: 'nonexistent.ts', startLine: 1, endLine: 5, cwd }),
      /No protection found/,
    );
  });
});

// ── findViolations ────────────────────────────────────────────────────────────

describe('findViolations', () => {
  it('returns empty when no staged files intersect protections', () => {
    const protections = [
      { file: 'src/core/feat.ts', startLine: 1, endLine: 10, dimensionId: 'd', protectedAt: '' },
    ];
    const violations = findViolations(['tests/foo.test.ts'], protections);
    assert.strictEqual(violations.length, 0);
  });

  it('returns violations when staged file matches protected file', () => {
    const protections = [
      { file: 'src/core/feat.ts', startLine: 1, endLine: 10, dimensionId: 'd', protectedAt: '' },
    ];
    const violations = findViolations(['src/core/feat.ts'], protections);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0]!.file, 'src/core/feat.ts');
  });

  it('normalizes backslashes in staged file paths', () => {
    const protections = [
      { file: 'src/core/feat.ts', startLine: 1, endLine: 10, dimensionId: 'd', protectedAt: '' },
    ];
    const violations = findViolations(['src\\core\\feat.ts'], protections);
    assert.strictEqual(violations.length, 1);
  });
});

// ── matrixProtect / matrixUnprotect / matrixProtectedLines ────────────────────

describe('matrixProtect command', () => {
  it('rejects invalid fileRange format', async () => {
    const cwd = await makeTmp();
    const exitCodeBefore = process.exitCode;
    process.exitCode = 0;
    await matrixProtect('src/foo.ts', 'testing', { cwd });
    // Valid: no exit code change (matrixProtect sets exitCode=1 on error)
    // Invalid format:
    await matrixProtect('no-colon-range', 'testing', { cwd });
    assert.strictEqual(process.exitCode, 1);
    process.exitCode = exitCodeBefore ?? 0;
  });

  it('adds protection with valid range', async () => {
    const cwd = await makeTmp();
    const now = () => '2026-05-16T00:00:00.000Z';
    await matrixProtect('src/feature.ts:10-50', 'testing', { cwd, _now: now });
    const data = await readProtectedLines(cwd);
    assert.strictEqual(data.protections.length, 1);
  });
});

describe('matrixUnprotect command', () => {
  it('removes a protection', async () => {
    const cwd = await makeTmp();
    const now = () => '2026-05-16T00:00:00.000Z';
    await addProtection({ file: 'src/x.ts', startLine: 5, endLine: 20, dimensionId: 'z', cwd, _now: now });
    await matrixUnprotect('src/x.ts:5-20', { cwd });
    const data = await readProtectedLines(cwd);
    assert.strictEqual(data.protections.length, 0);
  });
});

describe('matrixProtectedLines command', () => {
  it('runs without error on empty protections', async () => {
    const cwd = await makeTmp();
    // Should not throw
    await assert.doesNotReject(() => matrixProtectedLines({ cwd }));
  });
});
