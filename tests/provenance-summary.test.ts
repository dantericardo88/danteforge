import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildProvenanceSummary, formatProvenanceSummary } from '../src/core/provenance-summary.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReadDir(files: Record<string, string[]>): (p: string) => Promise<string[]> {
  return async (p: string) => {
    if (Object.prototype.hasOwnProperty.call(files, p)) return files[p];
    throw new Error(`ENOENT: no such file or directory '${p}'`);
  };
}

function makeReadFile(contents: Record<string, string>): (p: string) => Promise<string> {
  return async (p: string) => {
    const normalised = p.replace(/\\/g, '/');
    for (const [key, val] of Object.entries(contents)) {
      if (normalised.endsWith(key.replace(/\\/g, '/'))) return val;
    }
    throw new Error(`ENOENT: no such file '${p}'`);
  };
}

function auditLine(overrides: Partial<{
  timestamp: string;
  eventType: string;
  sessionId: string;
  status: string;
  filePath: string;
}> = {}): string {
  return JSON.stringify({
    timestamp: overrides.timestamp ?? '2026-05-14T10:00:00.000Z',
    eventType: overrides.eventType ?? 'file_write',
    sessionId: overrides.sessionId ?? 'sess-1',
    status: overrides.status ?? 'success',
    filePath: overrides.filePath ?? '/some/file.ts',
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildProvenanceSummary', () => {
  it('returns correct evidenceFileCount from injected readDir', async () => {
    const cwd = '/fake/project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: ['a.json', 'b.json', 'c.json'],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: my-proj\n',
      '.danteforge/audit/detailed.jsonl': '',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.evidenceFileCount, 3);
  });

  it('returns correct timeMachineCommitCount', async () => {
    const cwd = '/fake/project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: ['tm_abc.json', 'tm_def.json', 'tm_ghi.json', 'tm_jkl.json'],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': '',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.timeMachineCommitCount, 4);
  });

  it('counts unique sessions from audit log', async () => {
    const cwd = '/fake/project';
    const auditContent = [
      auditLine({ sessionId: 'sess-1' }),
      auditLine({ sessionId: 'sess-2' }),
      auditLine({ sessionId: 'sess-1' }),
      auditLine({ sessionId: 'sess-3' }),
    ].join('\n');
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': auditContent,
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.sessionCount, 3);
  });

  it('handles missing evidence directory gracefully (returns 0 count)', async () => {
    const cwd = '/fake/project';
    // readDir throws for evidence dir, simulating ENOENT
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': '',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.evidenceFileCount, 0);
  });

  it('handles empty audit log (sessionCount 0, recentActions empty)', async () => {
    const cwd = '/fake/project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': '',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.sessionCount, 0);
    assert.strictEqual(result.recentActions.length, 0);
  });

  it('integrityStatus is CLEAN when all evidence files are valid JSON', async () => {
    const cwd = '/fake/project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: ['good1.json', 'good2.json'],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': '',
      '.danteforge/evidence/good1.json': '{"key":"value"}',
      '.danteforge/evidence/good2.json': '{"another":"entry"}',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.integrityStatus, 'CLEAN');
    assert.strictEqual(result.verifiedCount, 2);
    assert.strictEqual(result.failedCount, 0);
  });

  it('integrityStatus is TAMPERED when an evidence file is invalid JSON', async () => {
    const cwd = '/fake/project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: ['good.json', 'bad.json'],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': '',
      '.danteforge/evidence/good.json': '{"ok":true}',
      '.danteforge/evidence/bad.json': 'NOT VALID JSON %%%',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.integrityStatus, 'TAMPERED');
    assert.strictEqual(result.verifiedCount, 1);
    assert.strictEqual(result.failedCount, 1);
  });

  it('extracts project name from STATE.yaml', async () => {
    const cwd = '/fake/project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: danteforge\nworkflowStage: forge\n',
      '.danteforge/audit/detailed.jsonl': '',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.project, 'danteforge');
  });

  it('falls back to directory basename when STATE.yaml is missing', async () => {
    const cwd = '/fake/my-cool-project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    // No STATE.yaml entry — readFile will throw
    const readFile = makeReadFile({
      '.danteforge/audit/detailed.jsonl': '',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.project, 'my-cool-project');
  });

  it('recentActions limited to 10 entries even with more audit lines', async () => {
    const cwd = '/fake/project';
    const lines = Array.from({ length: 20 }, (_, i) =>
      auditLine({ timestamp: `2026-05-14T${String(i).padStart(2, '0')}:00:00.000Z`, sessionId: `sess-${i}` })
    );
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': lines.join('\n'),
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.recentActions.length, 10);
  });

  it('resolves outcome "success" from audit status field', async () => {
    const cwd = '/fake/project';
    const auditContent = auditLine({ status: 'success', sessionId: 'sess-x' });
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': auditContent,
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.ok(result.recentActions.length > 0);
    assert.strictEqual(result.recentActions[0].outcome, 'success');
  });

  it('resolves outcome "failure" from audit status field', async () => {
    const cwd = '/fake/project';
    const auditContent = auditLine({ status: 'failure', sessionId: 'sess-y' });
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: [],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': auditContent,
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.ok(result.recentActions.length > 0);
    assert.strictEqual(result.recentActions[0].outcome, 'failure');
  });

  it('skips non-.json files when counting evidence', async () => {
    const cwd = '/fake/project';
    const readDir = makeReadDir({
      [`${cwd}/.danteforge/evidence`]: ['a.json', 'b.txt', 'c.md', 'd.json'],
      [`${cwd}/.danteforge/time-machine/commits`]: [],
    });
    const readFile = makeReadFile({
      '.danteforge/STATE.yaml': 'project: test\n',
      '.danteforge/audit/detailed.jsonl': '',
      '.danteforge/evidence/a.json': '{}',
      '.danteforge/evidence/d.json': '{}',
    });
    const result = await buildProvenanceSummary(cwd, { _readDir: readDir, _readFile: readFile });
    assert.strictEqual(result.evidenceFileCount, 2);
  });
});

describe('formatProvenanceSummary', () => {
  it('includes the header "Agent Activity Provenance Summary"', () => {
    const summary = {
      project: 'test-proj',
      evidenceFileCount: 5,
      timeMachineCommitCount: 10,
      sessionCount: 3,
      recentActions: [],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 5,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('Agent Activity Provenance Summary'), 'Missing header');
  });

  it('includes project name', () => {
    const summary = {
      project: 'my-project',
      evidenceFileCount: 0,
      timeMachineCommitCount: 0,
      sessionCount: 0,
      recentActions: [],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 0,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('my-project'), 'Missing project name');
  });

  it('includes evidence file count', () => {
    const summary = {
      project: 'proj',
      evidenceFileCount: 42,
      timeMachineCommitCount: 0,
      sessionCount: 0,
      recentActions: [],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 42,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('42'), 'Missing evidence file count');
  });

  it('includes integrity status CLEAN', () => {
    const summary = {
      project: 'proj',
      evidenceFileCount: 3,
      timeMachineCommitCount: 5,
      sessionCount: 2,
      recentActions: [],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 3,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('CLEAN'), 'Missing integrity status');
  });

  it('includes TAMPERED status when failedCount > 0', () => {
    const summary = {
      project: 'proj',
      evidenceFileCount: 2,
      timeMachineCommitCount: 0,
      sessionCount: 1,
      recentActions: [],
      integrityStatus: 'TAMPERED' as const,
      verifiedCount: 1,
      failedCount: 1,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('TAMPERED'), 'Missing TAMPERED status');
  });

  it('includes the time-machine hint at the end', () => {
    const summary = {
      project: 'proj',
      evidenceFileCount: 0,
      timeMachineCommitCount: 0,
      sessionCount: 0,
      recentActions: [],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 0,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('time-machine query'), 'Missing time-machine hint');
  });

  it('renders recent actions with date, command, and outcome', () => {
    const summary = {
      project: 'proj',
      evidenceFileCount: 0,
      timeMachineCommitCount: 0,
      sessionCount: 1,
      recentActions: [
        { date: '2026-05-14 10:00:00 UTC', command: 'file_write', filesChanged: 1, outcome: 'success' as const, sessionId: 'sess-1' },
      ],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 0,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('file_write'), 'Missing command in action');
    assert.ok(text.includes('success'), 'Missing outcome in action');
  });

  it('shows "no agent actions recorded yet" when recentActions is empty', () => {
    const summary = {
      project: 'proj',
      evidenceFileCount: 0,
      timeMachineCommitCount: 0,
      sessionCount: 0,
      recentActions: [],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 0,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('no agent actions recorded yet'), 'Missing empty actions message');
  });

  it('includes session count', () => {
    const summary = {
      project: 'proj',
      evidenceFileCount: 0,
      timeMachineCommitCount: 0,
      sessionCount: 7,
      recentActions: [],
      integrityStatus: 'CLEAN' as const,
      verifiedCount: 0,
      failedCount: 0,
    };
    const text = formatProvenanceSummary(summary);
    assert.ok(text.includes('7'), 'Missing session count');
  });
});
