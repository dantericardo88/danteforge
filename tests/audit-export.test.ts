import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exportAuditLog, formatAuditExport, writeAuditExport } from '../src/core/audit-export.js';

describe('audit-export', () => {
  const mockState = {
    auditLog: [
      { timestamp: '2026-04-01T10:00:00Z', action: 'forge', command: 'forge 1', result: 'success' },
      { timestamp: '2026-04-02T12:00:00Z', action: 'verify', command: 'verify', result: 'pass' },
      { timestamp: '2026-04-03T14:00:00Z', action: 'assess', command: 'assess', result: 'score: 7.4' },
    ],
  };

  it('exports all entries', async () => {
    const result = await exportAuditLog({
      _loadState: async () => mockState as any,
    });
    assert.equal(result.totalCount, 3);
    assert.equal(result.filteredCount, 3);
    assert.equal(result.entries.length, 3);
  });

  it('filters by since date', async () => {
    const result = await exportAuditLog({
      since: '2026-04-02T00:00:00Z',
      _loadState: async () => mockState as any,
    });
    assert.equal(result.filteredCount, 2);
  });

  it('handles empty audit log', async () => {
    const result = await exportAuditLog({
      _loadState: async () => ({ auditLog: [] } as any),
    });
    assert.equal(result.totalCount, 0);
    assert.equal(result.filteredCount, 0);
  });

  it('handles missing audit log', async () => {
    const result = await exportAuditLog({
      _loadState: async () => ({} as any),
    });
    assert.equal(result.totalCount, 0);
  });

  it('handles legacy string entries', async () => {
    const result = await exportAuditLog({
      _loadState: async () => ({ auditLog: ['2026-04-01T10:00:00Z — forge: success'] } as any),
    });
    assert.equal(result.entries[0].action, 'forge');
    assert.equal(result.entries[0].result, 'success');
  });

  describe('formatAuditExport', () => {
    const baseResult = {
      entries: [
        { timestamp: '2026-04-01T10:00:00Z', action: 'forge', command: 'forge 1', result: 'success' },
      ],
      totalCount: 1,
      filteredCount: 1,
      exportedAt: '2026-04-05T00:00:00Z',
      format: 'json',
    };

    it('formats as JSON', () => {
      const output = formatAuditExport(baseResult);
      const parsed = JSON.parse(output);
      assert.equal(parsed.entries.length, 1);
    });

    it('formats as CSV', () => {
      const output = formatAuditExport({ ...baseResult, format: 'csv' });
      assert.ok(output.includes('timestamp') && output.includes('action') && output.includes('command'));
      assert.ok(output.includes('forge'));
    });

    it('formats as markdown', () => {
      const output = formatAuditExport({ ...baseResult, format: 'markdown' });
      assert.ok(output.includes('# Audit Trail Export'));
      assert.ok(output.includes('| Timestamp |'));
    });
  });

  describe('writeAuditExport', () => {
    it('writes formatted content to file', async () => {
      let written = { path: '', content: '' };
      const result = {
        entries: [{ timestamp: 'T', action: 'A' }],
        totalCount: 1, filteredCount: 1,
        exportedAt: 'now', format: 'json',
      };
      await writeAuditExport(
        result,
        '/tmp/audit.json',
        async (p, c) => { written = { path: p, content: c }; },
      );
      assert.equal(written.path, '/tmp/audit.json');
      assert.ok(written.content.includes('"action"'));
    });
  });
});
