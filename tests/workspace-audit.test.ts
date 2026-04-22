import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordWorkspaceAudit,
  readWorkspaceAuditLog,
  filterAuditEntries,
  type WorkspaceAuditEntry,
  type WorkspaceAuditOps,
} from '../src/core/workspace-audit.js';

function makeEntry(overrides: Partial<Omit<WorkspaceAuditEntry, 'timestamp'>> = {}): Omit<WorkspaceAuditEntry, 'timestamp'> {
  return {
    workspaceId: 'ws-test',
    userId: 'user-1',
    action: 'access_granted',
    result: 'success',
    ...overrides,
  };
}

describe('workspace-audit: recordWorkspaceAudit', () => {
  it('writes a JSON line to the audit file', async () => {
    let written = '';
    const ops: WorkspaceAuditOps = {
      _mkdir: async () => {},
      _writeFile: async (_p, content) => { written = content; },
      _now: () => '2026-01-01T00:00:00.000Z',
      _homedir: () => '/tmp/fake-home',
    };
    await recordWorkspaceAudit(makeEntry(), ops);
    const parsed = JSON.parse(written.trim());
    assert.equal(parsed.workspaceId, 'ws-test');
    assert.equal(parsed.userId, 'user-1');
    assert.equal(parsed.action, 'access_granted');
    assert.equal(parsed.timestamp, '2026-01-01T00:00:00.000Z');
  });

  it('includes the result field', async () => {
    let written = '';
    const ops: WorkspaceAuditOps = {
      _mkdir: async () => {},
      _writeFile: async (_p, c) => { written = c; },
      _now: () => '2026-01-01T00:00:00.000Z',
      _homedir: () => '/tmp/fake-home',
    };
    await recordWorkspaceAudit(makeEntry({ result: 'denied' }), ops);
    assert.equal(JSON.parse(written).result, 'denied');
  });

  it('includes optional detail field when provided', async () => {
    let written = '';
    const ops: WorkspaceAuditOps = {
      _mkdir: async () => {},
      _writeFile: async (_p, c) => { written = c; },
      _now: () => '2026-01-01T00:00:00.000Z',
      _homedir: () => '/tmp/fake-home',
    };
    await recordWorkspaceAudit(makeEntry({ detail: 'required editor, had viewer' }), ops);
    assert.equal(JSON.parse(written).detail, 'required editor, had viewer');
  });

  it('never throws on I/O failure (best-effort)', async () => {
    const ops: WorkspaceAuditOps = {
      _mkdir: async () => { throw new Error('disk full'); },
      _homedir: () => '/tmp/fake-home',
    };
    await assert.doesNotReject(() => recordWorkspaceAudit(makeEntry(), ops));
  });

  it('calls _mkdir before _writeFile', async () => {
    const calls: string[] = [];
    const ops: WorkspaceAuditOps = {
      _mkdir: async () => { calls.push('mkdir'); },
      _writeFile: async () => { calls.push('write'); },
      _now: () => '2026-01-01T00:00:00.000Z',
      _homedir: () => '/tmp/fake-home',
    };
    await recordWorkspaceAudit(makeEntry(), ops);
    assert.deepEqual(calls, ['mkdir', 'write']);
  });
});

describe('workspace-audit: readWorkspaceAuditLog', () => {
  it('returns empty array when file does not exist', async () => {
    const ops: WorkspaceAuditOps = {
      _readFile: async () => { throw new Error('ENOENT'); },
      _homedir: () => '/tmp/fake-home',
    };
    const result = await readWorkspaceAuditLog('ws-x', ops);
    assert.deepEqual(result, []);
  });

  it('parses valid JSON Lines', async () => {
    const entry: WorkspaceAuditEntry = {
      timestamp: '2026-01-01T00:00:00.000Z',
      workspaceId: 'ws-test',
      userId: 'user-1',
      action: 'token_issued',
      result: 'success',
    };
    const ops: WorkspaceAuditOps = {
      _readFile: async () => JSON.stringify(entry) + '\n',
      _homedir: () => '/tmp/fake-home',
    };
    const result = await readWorkspaceAuditLog('ws-test', ops);
    assert.equal(result.length, 1);
    assert.equal(result[0].action, 'token_issued');
  });

  it('skips malformed lines silently', async () => {
    const good = JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', workspaceId: 'w', userId: 'u', action: 'member_added', result: 'success' });
    const ops: WorkspaceAuditOps = {
      _readFile: async () => good + '\n' + 'not-json\n',
      _homedir: () => '/tmp/fake-home',
    };
    const result = await readWorkspaceAuditLog('w', ops);
    assert.equal(result.length, 1);
  });

  it('parses multiple entries', async () => {
    const e1 = JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', workspaceId: 'w', userId: 'u1', action: 'access_granted', result: 'success' });
    const e2 = JSON.stringify({ timestamp: '2026-01-02T00:00:00.000Z', workspaceId: 'w', userId: 'u2', action: 'access_denied', result: 'denied' });
    const ops: WorkspaceAuditOps = {
      _readFile: async () => e1 + '\n' + e2 + '\n',
      _homedir: () => '/tmp/fake-home',
    };
    const result = await readWorkspaceAuditLog('w', ops);
    assert.equal(result.length, 2);
    assert.equal(result[1].userId, 'u2');
  });
});

describe('workspace-audit: filterAuditEntries', () => {
  const entries: WorkspaceAuditEntry[] = [
    { timestamp: '2026-01-01T00:00:00.000Z', workspaceId: 'w', userId: 'alice', action: 'access_granted', result: 'success' },
    { timestamp: '2026-01-02T00:00:00.000Z', workspaceId: 'w', userId: 'bob', action: 'access_denied', result: 'denied' },
    { timestamp: '2026-01-03T00:00:00.000Z', workspaceId: 'w', userId: 'alice', action: 'token_issued', result: 'success' },
  ];

  it('filters by userId', () => {
    const result = filterAuditEntries(entries, { userId: 'alice' });
    assert.equal(result.length, 2);
    assert.ok(result.every(e => e.userId === 'alice'));
  });

  it('filters by action', () => {
    const result = filterAuditEntries(entries, { action: 'access_denied' });
    assert.equal(result.length, 1);
    assert.equal(result[0].userId, 'bob');
  });

  it('filters by result', () => {
    const result = filterAuditEntries(entries, { result: 'success' });
    assert.equal(result.length, 2);
  });

  it('filters by since (inclusive)', () => {
    const result = filterAuditEntries(entries, { since: '2026-01-02T00:00:00.000Z' });
    assert.equal(result.length, 2);
  });

  it('combines multiple filters', () => {
    const result = filterAuditEntries(entries, { userId: 'alice', result: 'success' });
    assert.equal(result.length, 2);
  });

  it('returns empty when no match', () => {
    const result = filterAuditEntries(entries, { userId: 'nobody' });
    assert.deepEqual(result, []);
  });

  it('returns all entries when filter is empty', () => {
    const result = filterAuditEntries(entries, {});
    assert.equal(result.length, 3);
  });
});
