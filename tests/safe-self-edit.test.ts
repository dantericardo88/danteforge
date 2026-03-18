import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  isProtectedPath,
  computeFileHash,
  auditSelfEdit,
  loadAuditLog,
  requestSelfEditApproval,
  type SelfEditAuditEntry,
} from '../src/core/safe-self-edit.js';

describe('isProtectedPath', () => {
  it('returns true for known protected files (exact match)', () => {
    assert.strictEqual(isProtectedPath('src/core/state.ts'), true);
    assert.strictEqual(isProtectedPath('src/core/gates.ts'), true);
    assert.strictEqual(isProtectedPath('src/core/handoff.ts'), true);
    assert.strictEqual(isProtectedPath('src/core/workflow-enforcer.ts'), true);
    assert.strictEqual(isProtectedPath('src/core/autoforge.ts'), true);
    assert.strictEqual(isProtectedPath('src/core/pdse.ts'), true);
    assert.strictEqual(isProtectedPath('src/cli/index.ts'), true);
  });

  it('returns true for protected files with leading ./', () => {
    assert.strictEqual(isProtectedPath('./src/core/state.ts'), true);
    assert.strictEqual(isProtectedPath('./src/cli/index.ts'), true);
  });

  it('returns true for protected files with backslash separators (Windows paths)', () => {
    assert.strictEqual(isProtectedPath('src\\core\\state.ts'), true);
    assert.strictEqual(isProtectedPath('src\\core\\gates.ts'), true);
  });

  it('returns true for protected files with absolute-path suffix', () => {
    assert.strictEqual(isProtectedPath('/project/danteforge/src/core/state.ts'), true);
    assert.strictEqual(isProtectedPath('C:/Projects/DanteForge/src/core/gates.ts'), true);
  });

  it('returns false for non-protected files', () => {
    assert.strictEqual(isProtectedPath('src/core/logger.ts'), false);
    assert.strictEqual(isProtectedPath('src/core/llm.ts'), false);
    assert.strictEqual(isProtectedPath('src/cli/commands/plan.ts'), false);
    assert.strictEqual(isProtectedPath('tests/state.test.ts'), false);
    assert.strictEqual(isProtectedPath('package.json'), false);
    assert.strictEqual(isProtectedPath('src/harvested/gsd/hooks/context-rot.ts'), false);
  });

  it('returns false for files that partially match a protected name but are distinct', () => {
    assert.strictEqual(isProtectedPath('src/core/state-backup.ts'), false);
    assert.strictEqual(isProtectedPath('src/core/gates-v2.ts'), false);
    assert.strictEqual(isProtectedPath('src/core/my-gates.ts'), false);
  });
});

describe('computeFileHash', () => {
  it('produces a non-empty hex string', () => {
    const hash = computeFileHash('hello world');
    assert.strictEqual(typeof hash, 'string');
    assert.ok(hash.length > 0);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it('produces consistent SHA-256 for the same input', () => {
    const input = 'deterministic content for hashing';
    assert.strictEqual(computeFileHash(input), computeFileHash(input));
  });

  it('produces different hashes for different inputs', () => {
    assert.notStrictEqual(computeFileHash('aaa'), computeFileHash('bbb'));
  });

  it('returns the known SHA-256 of an empty string', () => {
    // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hash = computeFileHash('');
    assert.strictEqual(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns a 64-character hex string (256 bits)', () => {
    const hash = computeFileHash('test content');
    assert.strictEqual(hash.length, 64);
  });
});

describe('auditSelfEdit + loadAuditLog', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-safe-self-edit-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates the audit directory and file on first write', async () => {
    const entry: SelfEditAuditEntry = {
      timestamp: new Date().toISOString(),
      filePath: 'src/core/state.ts',
      action: 'write',
      reason: 'test reason',
      approved: true,
    };

    await auditSelfEdit(entry, tmpDir);

    const auditFile = path.join(tmpDir, '.danteforge', 'audit', 'self-edit.log');
    const content = await fs.readFile(auditFile, 'utf8');
    assert.ok(content.includes('src/core/state.ts'));
    assert.ok(content.includes('test reason'));
  });

  it('appends entries as separate JSON lines', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-audit-multi-'));
    try {
      const entry1: SelfEditAuditEntry = {
        timestamp: '2026-01-01T00:00:00.000Z',
        filePath: 'src/core/gates.ts',
        action: 'write',
        reason: 'first entry',
        approved: true,
      };
      const entry2: SelfEditAuditEntry = {
        timestamp: '2026-01-02T00:00:00.000Z',
        filePath: 'src/cli/index.ts',
        action: 'delete',
        reason: 'second entry',
        approved: false,
      };

      await auditSelfEdit(entry1, cwd);
      await auditSelfEdit(entry2, cwd);

      const loaded = await loadAuditLog(cwd);
      assert.strictEqual(loaded.length, 2);
      assert.strictEqual(loaded[0]!.filePath, 'src/core/gates.ts');
      assert.strictEqual(loaded[1]!.filePath, 'src/cli/index.ts');
      assert.strictEqual(loaded[0]!.reason, 'first entry');
      assert.strictEqual(loaded[1]!.reason, 'second entry');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('loadAuditLog returns an empty array when the log does not exist', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-audit-empty-'));
    try {
      const entries = await loadAuditLog(freshDir);
      assert.ok(Array.isArray(entries));
      assert.strictEqual(entries.length, 0);
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('round-trips all SelfEditAuditEntry fields correctly', async () => {
    const roundTripDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-audit-rt-'));
    try {
      const entry: SelfEditAuditEntry = {
        timestamp: '2026-03-18T12:00:00.000Z',
        filePath: 'src/core/handoff.ts',
        action: 'rename',
        reason: 'Renaming for v0.8.0 refactor',
        approved: true,
        beforeHash: 'abc123',
        afterHash: 'def456',
      };

      await auditSelfEdit(entry, roundTripDir);
      const loaded = await loadAuditLog(roundTripDir);

      assert.strictEqual(loaded.length, 1);
      const loaded0 = loaded[0]!;
      assert.strictEqual(loaded0.timestamp, entry.timestamp);
      assert.strictEqual(loaded0.filePath, entry.filePath);
      assert.strictEqual(loaded0.action, entry.action);
      assert.strictEqual(loaded0.reason, entry.reason);
      assert.strictEqual(loaded0.approved, entry.approved);
      assert.strictEqual(loaded0.beforeHash, entry.beforeHash);
      assert.strictEqual(loaded0.afterHash, entry.afterHash);
    } finally {
      await fs.rm(roundTripDir, { recursive: true, force: true });
    }
  });
});

describe('requestSelfEditApproval', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-approval-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true for protected paths (auto-approved in v0.8.0)', async () => {
    const approved = await requestSelfEditApproval('src/core/state.ts', 'Unit test approval', tmpDir);
    assert.strictEqual(approved, true);
  });

  it('returns true for non-protected paths', async () => {
    const approved = await requestSelfEditApproval('src/core/logger.ts', 'Non-protected edit', tmpDir);
    assert.strictEqual(approved, true);
  });

  it('writes an audit entry for every call regardless of path protection', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-approval-audit-'));
    try {
      await requestSelfEditApproval('src/core/gates.ts', 'Protected test', dir);
      await requestSelfEditApproval('src/core/logger.ts', 'Non-protected test', dir);

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 2);
      assert.ok(entries.some(e => e.filePath === 'src/core/gates.ts'));
      assert.ok(entries.some(e => e.filePath === 'src/core/logger.ts'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
