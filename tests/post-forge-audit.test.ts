// post-forge-audit tests — auditPostForgeProtectedMutations detective control
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  auditPostForgeProtectedMutations,
  loadAuditLog,
} from '../src/core/safe-self-edit.js';

let tmpDir: string;
before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-post-forge-audit-'));
});
after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function freshDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-pfa-'));
  return d;
}

describe('auditPostForgeProtectedMutations', () => {
  it('returns no violations when changedFiles is empty', async () => {
    const dir = await freshDir();
    try {
      const result = await auditPostForgeProtectedMutations([], 'deny', { cwd: dir });
      assert.deepStrictEqual(result.violations, []);
      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns no violations when no changed files are protected paths', async () => {
    const dir = await freshDir();
    try {
      const result = await auditPostForgeProtectedMutations(
        ['src/core/config.ts', 'tests/foo.test.ts', 'README.md'],
        'deny',
        { cwd: dir },
      );
      assert.deepStrictEqual(result.violations, []);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns violation for protected file with deny policy and writes audit entry', async () => {
    const dir = await freshDir();
    try {
      const result = await auditPostForgeProtectedMutations(
        ['src/core/state.ts', 'src/core/llm.ts'],
        'deny',
        { cwd: dir },
      );
      // Both state.ts and llm.ts are now protected (llm.ts added in security hardening)
      assert.deepStrictEqual(result.violations.sort(), ['src/core/llm.ts', 'src/core/state.ts']);
      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].approved, false);
      assert.strictEqual(entries[0].policy, 'deny');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns no violations for protected file with allow-with-audit policy', async () => {
    const dir = await freshDir();
    try {
      const result = await auditPostForgeProtectedMutations(
        ['src/core/gates.ts'],
        'allow-with-audit',
        { cwd: dir },
      );
      assert.deepStrictEqual(result.violations, []);
      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0].approved, true);
      assert.strictEqual(entries[0].policy, 'allow-with-audit');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('flags only protected files in a mixed list', async () => {
    const dir = await freshDir();
    try {
      const result = await auditPostForgeProtectedMutations(
        ['src/core/llm.ts', 'src/core/state.ts', 'tests/bar.test.ts', 'src/cli/index.ts'],
        'deny',
        { cwd: dir },
      );
      // llm.ts is now protected (added in security hardening sprint)
      assert.deepStrictEqual(result.violations.sort(), ['src/cli/index.ts', 'src/core/llm.ts', 'src/core/state.ts']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('audit entry has all required fields', async () => {
    const dir = await freshDir();
    try {
      await auditPostForgeProtectedMutations(['src/core/pdse.ts'], 'deny', { cwd: dir });
      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 1);
      const e = entries[0];
      assert.ok(typeof e.timestamp === 'string' && e.timestamp.length > 0);
      assert.strictEqual(e.filePath, 'src/core/pdse.ts');
      assert.strictEqual(e.action, 'write');
      assert.ok(typeof e.reason === 'string' && e.reason.includes('post-forge'));
      assert.strictEqual(e.approved, false);
      assert.strictEqual(e.policy, 'deny');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('writes multiple audit entries for multiple protected file violations', async () => {
    const dir = await freshDir();
    try {
      await auditPostForgeProtectedMutations(
        ['src/core/state.ts', 'src/core/gates.ts'],
        'deny',
        { cwd: dir },
      );
      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('confirm policy treats protected mutation as a violation (not auto-approved)', async () => {
    const dir = await freshDir();
    try {
      const result = await auditPostForgeProtectedMutations(
        ['src/core/autoforge.ts'],
        'confirm',
        { cwd: dir },
      );
      // In post-forge context, only allow-with-audit approves; confirm → violation
      assert.deepStrictEqual(result.violations, ['src/core/autoforge.ts']);
      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries[0].approved, false);
      assert.strictEqual(entries[0].policy, 'confirm');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
