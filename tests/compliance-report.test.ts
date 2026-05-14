import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runComplianceReport, type ComplianceReportOptions } from '../src/cli/commands/compliance-report.js';
import type { DanteState } from '../src/core/state.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    lastHandoff: '',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'default',
    ...overrides,
  } as DanteState;
}

function makeOpts(overrides: Partial<ComplianceReportOptions> = {}): ComplianceReportOptions {
  return {
    cwd: '/test/project',
    _loadState: async () => makeState(),
    _getRoleForUser: async () => null,
    _listDir: async () => [],
    _countCommits: async () => 0,
    ...overrides,
  };
}

// ── Basic output tests ─────────────────────────────────────────────────────────

describe('runComplianceReport — markdown output', () => {
  it('produces markdown output to stdout by default', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({ _stdout: l => lines.push(l) }));
    const output = lines.join('\n');
    assert.ok(output.includes('# DanteForge Compliance Report'));
    assert.ok(output.includes('## Verdict'));
  });

  it('includes Evidence Files section', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      _listDir: async () => ['enterprise-proof.json', 'verify-2026.json'],
      _stdout: l => lines.push(l),
    }));
    const output = lines.join('\n');
    assert.ok(output.includes('Evidence Files'));
    assert.ok(output.includes('enterprise-proof.json'));
  });

  it('includes Time Machine commit count', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      _countCommits: async () => 42,
      _stdout: l => lines.push(l),
    }));
    const output = lines.join('\n');
    assert.ok(output.includes('42'));
  });

  it('shows workspace role when configured', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      _getRoleForUser: async () => 'editor',
      _stdout: l => lines.push(l),
    }));
    const output = lines.join('\n');
    assert.ok(output.includes('editor'));
  });
});

// ── JSON output tests ─────────────────────────────────────────────────────────

describe('runComplianceReport — JSON format', () => {
  it('produces parseable JSON when format=json', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      format: 'json',
      _stdout: l => lines.push(l),
    }));
    const parsed = JSON.parse(lines.join('\n'));
    assert.ok(typeof parsed === 'object');
    assert.ok('verdict' in parsed);
    assert.ok('auditSummary' in parsed);
    assert.ok('evidenceFiles' in parsed);
    assert.ok('timeMachineCommitCount' in parsed);
  });

  it('JSON report contains correct evidence files list', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      format: 'json',
      _listDir: async () => ['file-a.json', 'file-b.json'],
      _stdout: l => lines.push(l),
    }));
    const parsed = JSON.parse(lines.join('\n'));
    assert.deepEqual(parsed.evidenceFiles, ['file-a.json', 'file-b.json']);
  });
});

// ── Verdict logic tests ───────────────────────────────────────────────────────

describe('runComplianceReport — verdict computation', () => {
  it('returns CLEAN when audit is empty and role is set and evidence exists', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      format: 'json',
      _getRoleForUser: async () => 'owner',
      _listDir: async () => ['proof.json'],
      _countCommits: async () => 10,
      _stdout: l => lines.push(l),
    }));
    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.verdict, 'CLEAN');
  });

  it('returns WARNINGS when no evidence files present', async () => {
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      format: 'json',
      _getRoleForUser: async () => 'owner',
      _listDir: async () => [],
      _countCommits: async () => 5,
      _stdout: l => lines.push(l),
    }));
    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.verdict, 'WARNINGS');
  });

  it('returns VIOLATIONS when there are recent audit failures', async () => {
    const lines: string[] = [];
    const state = makeState({
      auditLog: [
        '2026-05-01T00:00:00Z | alice | forge: failure',
      ],
    });
    await runComplianceReport(makeOpts({
      format: 'json',
      _loadState: async () => state,
      _getRoleForUser: async () => 'owner',
      _listDir: async () => ['proof.json'],
      _countCommits: async () => 5,
      _stdout: l => lines.push(l),
    }));
    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.verdict, 'VIOLATIONS');
  });
});

// ── File output tests ─────────────────────────────────────────────────────────

describe('runComplianceReport — file output', () => {
  it('writes to file when --out is specified', async () => {
    let writtenPath = '';
    let writtenContent = '';
    await runComplianceReport(makeOpts({
      out: '/tmp/compliance.md',
      _writeFile: async (p, c) => { writtenPath = p; writtenContent = c; },
    }));
    assert.equal(writtenPath, '/tmp/compliance.md');
    assert.ok(writtenContent.includes('# DanteForge Compliance Report'));
  });

  it('does not call stdout when writing to file', async () => {
    let stdoutCalled = false;
    await runComplianceReport(makeOpts({
      out: '/tmp/report.md',
      _writeFile: async () => {},
      _stdout: () => { stdoutCalled = true; },
    }));
    assert.equal(stdoutCalled, false);
  });
});

// ── Date filter tests ─────────────────────────────────────────────────────────

describe('runComplianceReport — since filter', () => {
  it('filters audit events by --since date', async () => {
    const state = makeState({
      auditLog: [
        '2026-01-01T00:00:00Z | alice | forge: success',
        '2026-05-10T00:00:00Z | bob | verify: success',
      ],
    });
    const lines: string[] = [];
    await runComplianceReport(makeOpts({
      format: 'json',
      since: '2026-05-01',
      _loadState: async () => state,
      _getRoleForUser: async () => 'owner',
      _listDir: async () => ['proof.json'],
      _countCommits: async () => 10,
      _stdout: l => lines.push(l),
    }));
    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.auditSummary.totalEvents, 1);
    assert.equal(parsed.since, '2026-05-01');
  });
});
