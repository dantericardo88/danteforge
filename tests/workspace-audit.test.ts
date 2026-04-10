import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordWorkspaceAudit,
  readWorkspaceAuditLog,
  filterAuditEntries,
  type WorkspaceAuditEntry,
  type WorkspaceAuditOps,
} from '../src/core/workspace-audit.js';
import {
  createWorkspace,
  issueWorkspaceToken,
  verifyWorkspaceToken,
  revokeWorkspaceToken,
  loadWorkspace,
  type WorkspaceOps,
} from '../src/core/workspace.js';
import { requireWorkspaceRole, WorkspacePermissionError } from '../src/core/workspace-gate.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

function makeMockOps() {
  const files = new Map<string, string>();
  return {
    _readFile: async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`File not found: ${p}`);
      return v;
    },
    _writeFile: async (p: string, content: string) => { files.set(p, content); },
    _mkdir: async () => {},
    _homedir: () => '/tmp/test-audit',
    files,
  };
}

function makeAuditOps(ops: ReturnType<typeof makeMockOps>): WorkspaceAuditOps {
  return {
    _readFile: ops._readFile,
    // Append semantics for audit: concat to existing content
    _writeFile: async (p: string, content: string) => {
      const existing = ops.files.get(p) ?? '';
      ops.files.set(p, existing + content);
    },
    _mkdir: ops._mkdir,
    _now: () => '2026-04-08T12:00:00.000Z',
    _homedir: ops._homedir,
  };
}

// ── Audit logging tests ─────────────────────────────────────────────────────

describe('workspace audit logging', () => {
  it('recordWorkspaceAudit writes a JSON line with timestamp', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    await recordWorkspaceAudit(
      { workspaceId: 'team1', userId: 'alice', action: 'access_granted', result: 'success' },
      auditOps,
    );
    const auditPath = Array.from(ops.files.keys()).find((k) => k.includes('workspace-audit.jsonl'));
    assert.ok(auditPath, 'Audit file should be created');
    const content = ops.files.get(auditPath!)!;
    const entry = JSON.parse(content.trim()) as WorkspaceAuditEntry;
    assert.equal(entry.timestamp, '2026-04-08T12:00:00.000Z');
    assert.equal(entry.userId, 'alice');
    assert.equal(entry.action, 'access_granted');
    assert.equal(entry.result, 'success');
  });

  it('recordWorkspaceAudit appends multiple entries', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    await recordWorkspaceAudit(
      { workspaceId: 'team1', userId: 'alice', action: 'access_granted', result: 'success' },
      auditOps,
    );
    await recordWorkspaceAudit(
      { workspaceId: 'team1', userId: 'bob', action: 'access_denied', result: 'denied', detail: 'required editor' },
      auditOps,
    );
    const entries = await readWorkspaceAuditLog('team1', auditOps);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].userId, 'alice');
    assert.equal(entries[1].userId, 'bob');
    assert.equal(entries[1].detail, 'required editor');
  });

  it('recordWorkspaceAudit never throws on I/O failure', async () => {
    const badOps: WorkspaceAuditOps = {
      _mkdir: async () => { throw new Error('disk full'); },
      _writeFile: async () => { throw new Error('disk full'); },
      _homedir: () => '/tmp/test-audit',
    };
    // Should not throw
    await recordWorkspaceAudit(
      { workspaceId: 'team1', userId: 'alice', action: 'access_granted', result: 'success' },
      badOps,
    );
  });

  it('readWorkspaceAuditLog returns empty array when no audit file exists', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    const entries = await readWorkspaceAuditLog('nonexistent', auditOps);
    assert.deepEqual(entries, []);
  });

  it('readWorkspaceAuditLog skips malformed lines', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    await recordWorkspaceAudit(
      { workspaceId: 'team1', userId: 'alice', action: 'access_granted', result: 'success' },
      auditOps,
    );
    // Inject a malformed line
    const auditPath = Array.from(ops.files.keys()).find((k) => k.includes('workspace-audit.jsonl'))!;
    ops.files.set(auditPath, ops.files.get(auditPath)! + 'NOT-JSON\n');
    await recordWorkspaceAudit(
      { workspaceId: 'team1', userId: 'bob', action: 'token_issued', result: 'success' },
      auditOps,
    );
    const entries = await readWorkspaceAuditLog('team1', auditOps);
    assert.equal(entries.length, 2);
  });

  it('recordWorkspaceAudit includes optional role and detail fields', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    await recordWorkspaceAudit(
      { workspaceId: 'team1', userId: 'eve', role: 'reviewer', action: 'access_denied', result: 'denied', detail: 'required editor, had reviewer' },
      auditOps,
    );
    const entries = await readWorkspaceAuditLog('team1', auditOps);
    assert.equal(entries[0].role, 'reviewer');
    assert.equal(entries[0].detail, 'required editor, had reviewer');
  });
});

// ── Filter tests ────────────────────────────────────────────────────────────

describe('filterAuditEntries', () => {
  const entries: WorkspaceAuditEntry[] = [
    { timestamp: '2026-04-08T10:00:00Z', workspaceId: 'w1', userId: 'alice', action: 'access_granted', result: 'success' },
    { timestamp: '2026-04-08T11:00:00Z', workspaceId: 'w1', userId: 'bob', action: 'access_denied', result: 'denied' },
    { timestamp: '2026-04-08T12:00:00Z', workspaceId: 'w1', userId: 'alice', action: 'token_issued', result: 'success' },
    { timestamp: '2026-04-08T13:00:00Z', workspaceId: 'w1', userId: 'eve', action: 'access_denied', result: 'denied' },
  ];

  it('filters by userId', () => {
    const result = filterAuditEntries(entries, { userId: 'alice' });
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.userId === 'alice'));
  });

  it('filters by action', () => {
    const result = filterAuditEntries(entries, { action: 'access_denied' });
    assert.equal(result.length, 2);
  });

  it('filters by result', () => {
    const result = filterAuditEntries(entries, { result: 'success' });
    assert.equal(result.length, 2);
  });

  it('filters by since timestamp', () => {
    const result = filterAuditEntries(entries, { since: '2026-04-08T12:00:00Z' });
    assert.equal(result.length, 2);
  });

  it('combines multiple filter criteria', () => {
    const result = filterAuditEntries(entries, { userId: 'alice', action: 'access_granted' });
    assert.equal(result.length, 1);
    assert.equal(result[0].timestamp, '2026-04-08T10:00:00Z');
  });

  it('returns all entries with empty filter', () => {
    assert.equal(filterAuditEntries(entries, {}).length, 4);
  });
});

// ── Token revocation tests ──────────────────────────────────────────────────

describe('workspace token revocation', () => {
  it('revokeWorkspaceToken adds nonce to revocation list', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('revoke-test', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    // Extract nonce from token
    const payload = verifyWorkspaceToken(token, ws, 'alice', ops);
    assert.ok(payload);
    await revokeWorkspaceToken(ws.id, payload!.nonce, ops);
    const updated = await loadWorkspace(ws.id, ops);
    assert.ok(updated!.revokedTokens);
    assert.ok(updated!.revokedTokens!.includes(payload!.nonce));
  });

  it('verifyWorkspaceToken rejects revoked tokens', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('revoke-test2', ops);
    const token = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    const payload = verifyWorkspaceToken(token, ws, 'alice', ops);
    assert.ok(payload);
    await revokeWorkspaceToken(ws.id, payload!.nonce, ops);
    // Reload workspace to get updated revocation list
    const updated = await loadWorkspace(ws.id, ops);
    assert.ok(updated);
    const result = verifyWorkspaceToken(token, updated!, 'alice', ops);
    assert.equal(result, null, 'Revoked token should be rejected');
  });

  it('revoking same nonce twice is idempotent', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('idempotent-test', ops);
    await revokeWorkspaceToken(ws.id, 'nonce-abc', ops);
    await revokeWorkspaceToken(ws.id, 'nonce-abc', ops);
    const updated = await loadWorkspace(ws.id, ops);
    const count = updated!.revokedTokens!.filter((n) => n === 'nonce-abc').length;
    assert.equal(count, 1, 'Nonce should appear only once');
  });

  it('revokeWorkspaceToken throws for missing workspace', async () => {
    const ops = makeMockOps();
    await assert.rejects(
      revokeWorkspaceToken('nonexistent', 'nonce', ops),
      /not found/,
    );
  });

  it('non-revoked tokens still verify normally', async () => {
    const ops = makeMockOps();
    const ws = await createWorkspace('multi-token', ops);
    const token1 = issueWorkspaceToken(ws, 'alice', 'editor', ops);
    const token2 = issueWorkspaceToken(ws, 'bob', 'reviewer', ops);
    const p1 = verifyWorkspaceToken(token1, ws, 'alice', ops);
    assert.ok(p1);
    // Revoke only token1
    await revokeWorkspaceToken(ws.id, p1!.nonce, ops);
    const updated = await loadWorkspace(ws.id, ops);
    // token2 should still work
    const result = verifyWorkspaceToken(token2, updated!, 'bob', ops);
    assert.ok(result, 'Non-revoked token should still verify');
  });
});

// ── Gate audit integration tests ────────────────────────────────────────────

describe('requireWorkspaceRole audit integration', () => {
  it('records access_denied audit entry when role check fails', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    const ws = await createWorkspace('gate-audit', ops);
    // Add a reviewer member
    ws.members.push({ id: 'reviewer-user', role: 'reviewer', addedAt: new Date().toISOString() });
    // Override env for getCurrentUserId
    const origUser = process.env['DANTEFORGE_USER'];
    process.env['DANTEFORGE_USER'] = 'reviewer-user';
    try {
      await assert.rejects(
        requireWorkspaceRole('editor', {
          _getWorkspaceId: async () => ws.id,
          _loadWorkspace: async () => ws,
          _auditOps: auditOps,
        }),
        WorkspacePermissionError,
      );
    } finally {
      if (origUser !== undefined) process.env['DANTEFORGE_USER'] = origUser;
      else delete process.env['DANTEFORGE_USER'];
    }
    const entries = await readWorkspaceAuditLog(ws.id, auditOps);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'access_denied');
    assert.equal(entries[0].result, 'denied');
    assert.equal(entries[0].userId, 'reviewer-user');
    assert.ok(entries[0].detail?.includes('required editor'));
  });

  it('records access_granted audit entry when role check passes', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    const ws = await createWorkspace('gate-ok', ops);
    const origUser = process.env['DANTEFORGE_USER'];
    // createWorkspace sets owner as current user
    process.env['DANTEFORGE_USER'] = ws.members[0].id;
    try {
      await requireWorkspaceRole('editor', {
        _getWorkspaceId: async () => ws.id,
        _loadWorkspace: async () => ws,
        _auditOps: auditOps,
      });
    } finally {
      if (origUser !== undefined) process.env['DANTEFORGE_USER'] = origUser;
      else delete process.env['DANTEFORGE_USER'];
    }
    const entries = await readWorkspaceAuditLog(ws.id, auditOps);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'access_granted');
    assert.equal(entries[0].result, 'success');
  });

  it('does not record audit when no workspace is active', async () => {
    const ops = makeMockOps();
    const auditOps = makeAuditOps(ops);
    let auditCalled = false;
    await requireWorkspaceRole('editor', {
      _getWorkspaceId: async () => null,
      _recordAudit: async () => { auditCalled = true; },
      _auditOps: auditOps,
    });
    assert.equal(auditCalled, false, 'Audit should not be called in single-user mode');
  });
});
