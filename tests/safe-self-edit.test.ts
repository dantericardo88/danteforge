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
  type SelfEditApprovalOptions,
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
    assert.strictEqual(isProtectedPath('package.json'), true);  // package.json is protected — forge must not corrupt it
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
      policy: 'allow-with-audit',
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
        policy: 'allow-with-audit',
      };
      const entry2: SelfEditAuditEntry = {
        timestamp: '2026-01-02T00:00:00.000Z',
        filePath: 'src/cli/index.ts',
        action: 'delete',
        reason: 'second entry',
        approved: false,
        policy: 'deny',
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
        reason: 'Renaming for v0.9.0 refactor',
        approved: true,
        policy: 'allow-with-audit',
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
      assert.strictEqual(loaded0.policy, entry.policy);
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

  it('returns false for protected paths with default deny policy', async () => {
    const approved = await requestSelfEditApproval('src/core/state.ts', 'Unit test deny', tmpDir);
    assert.strictEqual(approved, false);
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

describe('requestSelfEditApproval — policy enforcement', () => {
  it('deny policy: returns false for protected path and true for non-protected', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-deny-'));
    try {
      const protectedResult = await requestSelfEditApproval(
        'src/core/state.ts',
        'deny test',
        { cwd: dir, policy: 'deny' },
      );
      const nonProtectedResult = await requestSelfEditApproval(
        'src/core/logger.ts',
        'deny test non-protected',
        { cwd: dir, policy: 'deny' },
      );
      assert.strictEqual(protectedResult, false);
      assert.strictEqual(nonProtectedResult, true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('allow-with-audit policy: returns true for protected path with audit entry', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-audit-'));
    try {
      const result = await requestSelfEditApproval(
        'src/core/gates.ts',
        'explicit audit approval',
        { cwd: dir, policy: 'allow-with-audit' },
      );
      assert.strictEqual(result, true);

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]!.approved, true);
      assert.strictEqual(entries[0]!.policy, 'allow-with-audit');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('confirm policy + _isTTY=false: degrades to deny for protected path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-confirm-no-tty-'));
    try {
      const result = await requestSelfEditApproval(
        'src/core/autoforge.ts',
        'confirm without TTY',
        { cwd: dir, policy: 'confirm', _isTTY: false },
      );
      assert.strictEqual(result, false);

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries[0]!.approved, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('confirm policy + _readLine returning "y": returns true for protected path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-confirm-yes-'));
    try {
      const opts: SelfEditApprovalOptions = {
        cwd: dir,
        policy: 'confirm',
        _isTTY: true,
        _readLine: async () => 'y',
      };
      const result = await requestSelfEditApproval('src/core/pdse.ts', 'user says yes', opts);
      assert.strictEqual(result, true);

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries[0]!.approved, true);
      assert.strictEqual(entries[0]!.policy, 'confirm');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('confirm policy + _readLine returning "n": returns false for protected path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-confirm-no-'));
    try {
      const opts: SelfEditApprovalOptions = {
        cwd: dir,
        policy: 'confirm',
        _isTTY: true,
        _readLine: async () => 'n',
      };
      const result = await requestSelfEditApproval('src/core/handoff.ts', 'user says no', opts);
      assert.strictEqual(result, false);

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries[0]!.approved, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('backward compat: string cwd argument defaults to deny policy for protected paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-compat-'));
    try {
      const result = await requestSelfEditApproval('src/core/state.ts', 'compat test', dir);
      assert.strictEqual(result, false);

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries[0]!.policy, 'deny');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('policy field is present in every audit entry', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-field-'));
    try {
      await requestSelfEditApproval('src/core/state.ts', 'protected deny', { cwd: dir, policy: 'deny' });
      await requestSelfEditApproval('src/core/logger.ts', 'non-protected', { cwd: dir, policy: 'deny' });
      await requestSelfEditApproval('src/core/gates.ts', 'allow-with-audit', { cwd: dir, policy: 'allow-with-audit' });

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 3);
      for (const entry of entries) {
        assert.ok(
          entry.policy === 'deny' || entry.policy === 'allow-with-audit' || entry.policy === 'confirm',
          `Expected valid policy, got: ${entry.policy}`,
        );
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('non-protected path is always approved regardless of policy', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-nonprotected-'));
    try {
      const deny = await requestSelfEditApproval('src/core/logger.ts', 'deny policy', { cwd: dir, policy: 'deny' });
      const audit = await requestSelfEditApproval('src/core/llm.ts', 'audit policy', { cwd: dir, policy: 'allow-with-audit' });
      const confirm = await requestSelfEditApproval('src/utils/git.ts', 'confirm policy', { cwd: dir, policy: 'confirm', _isTTY: false });

      assert.strictEqual(deny, true);
      assert.strictEqual(audit, true);
      assert.strictEqual(confirm, true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('audit entry approved field matches actual decision outcome', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-policy-outcome-'));
    try {
      // deny → approved=false
      await requestSelfEditApproval('src/core/state.ts', 'deny', { cwd: dir, policy: 'deny' });
      // allow-with-audit → approved=true
      await requestSelfEditApproval('src/core/gates.ts', 'audit', { cwd: dir, policy: 'allow-with-audit' });

      const entries = await loadAuditLog(dir);
      assert.strictEqual(entries.length, 2);
      const denyEntry = entries.find(e => e.policy === 'deny')!;
      const auditEntry = entries.find(e => e.policy === 'allow-with-audit')!;
      assert.strictEqual(denyEntry.approved, false);
      assert.strictEqual(auditEntry.approved, true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
