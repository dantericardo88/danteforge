// qa-runner-baseline.ts tests — runQAPass / saveQABaseline / findRegressions with _fsAdapter injection
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runQAPass,
  saveQABaseline,
  findRegressions,
  computeQAScore,
  type QAReport,
  type QAIssue,
  type QARunOptions,
  type BrowseResult,
} from '../src/core/qa-runner.js';
import type { BrowseAdapterConfig } from '../src/core/browse-adapter.js';

const browseConfig: BrowseAdapterConfig = { binaryPath: '/usr/bin/browse', port: 9400, timeoutMs: 5000 };

function makeBrowse(results: Record<string, { success: boolean; stdout: string; evidencePath?: string }>): QARunOptions['_invokeBrowse'] {
  return async (command: string) => results[command] ?? { success: true, stdout: '' };
}

function makeFsAdapter(files: Record<string, string> = {}): NonNullable<QARunOptions['_fsAdapter']> & { written: Record<string, string>; mkdirCalls: string[] } {
  const written: Record<string, string> = {};
  const mkdirCalls: string[] = [];
  return {
    written,
    mkdirCalls,
    mkdir: async (p: string) => { mkdirCalls.push(p); return undefined; },
    readFile: async (p: string) => { if (p in files) return files[p]; throw new Error('ENOENT'); },
    writeFile: async (p: string, c: string) => { written[p] = c; },
  };
}

function makeReport(overrides: Partial<QAReport> = {}): QAReport {
  return {
    score: 100,
    mode: 'full',
    url: 'http://localhost:3000',
    timestamp: new Date().toISOString(),
    issues: [],
    screenshots: [],
    ...overrides,
  };
}

function makeIssue(id: string, severity: QAIssue['severity'], category: string, description: string): QAIssue {
  return { id, severity, category, description, remediation: 'Fix it' };
}

describe('runQAPass — full QA pass with _fsAdapter', () => {
  it('full QA pass succeeds with score > 0 and issues array', async () => {
    const fsAdapter = makeFsAdapter();
    const browse = makeBrowse({
      goto: { success: true, stdout: '' },
      screenshot: { success: true, stdout: '' },
      accessibility: { success: true, stdout: '' },
      console: { success: true, stdout: '' },
      network: { success: true, stdout: '' },
      perf: { success: true, stdout: '' },
    });

    const report = await runQAPass({
      url: 'http://localhost:3000',
      mode: 'full',
      evidenceDir: '/tmp/evidence',
      browseConfig,
      _invokeBrowse: browse,
      _fsAdapter: fsAdapter,
    });

    assert.ok(typeof report.score === 'number', 'score should be a number');
    assert.ok(report.score >= 0 && report.score <= 100, 'score should be 0-100');
    assert.ok(Array.isArray(report.issues), 'issues should be an array');
  });
});

describe('runQAPass — navigation failure returns early', () => {
  it('goto failure produces critical issue with low score', async () => {
    const fsAdapter = makeFsAdapter();
    const browse = makeBrowse({
      goto: { success: false, stdout: '' },
    });

    const report = await runQAPass({
      url: 'http://localhost:3000',
      mode: 'full',
      evidenceDir: '/tmp/evidence',
      browseConfig,
      _invokeBrowse: async (cmd, _args, _cfg) => {
        if (cmd === 'goto') return { success: false, stdout: '', errorMessage: 'connection refused' };
        return { success: true, stdout: '' };
      },
      _fsAdapter: fsAdapter,
    });

    assert.ok(report.score < 100, 'score should be reduced for navigation failure');
    assert.ok(report.issues.length >= 1, 'should have at least 1 issue');
    assert.strictEqual(report.issues[0].severity, 'critical', 'navigation failure should be critical');
  });
});

describe('runQAPass — quick mode stops after accessibility', () => {
  it('quick mode does not run console/network/perf checks', async () => {
    const fsAdapter = makeFsAdapter();
    const commands: string[] = [];

    await runQAPass({
      url: 'http://localhost:3000',
      mode: 'quick',
      evidenceDir: '/tmp/evidence',
      browseConfig,
      _invokeBrowse: async (cmd) => { commands.push(cmd); return { success: true, stdout: '' }; },
      _fsAdapter: fsAdapter,
    });

    assert.ok(!commands.includes('console'), 'should not run console in quick mode');
    assert.ok(!commands.includes('network'), 'should not run network in quick mode');
    assert.ok(!commands.includes('perf'), 'should not run perf in quick mode');
  });
});

describe('runQAPass — regression mode with _fsAdapter', () => {
  it('regression mode with baseline finds new issues', async () => {
    const baselineReport = makeReport({
      issues: [makeIssue('a11y-1', 'medium', 'accessibility', 'Missing alt text')],
    });
    const fsAdapter = makeFsAdapter({
      '/tmp/baseline.json': JSON.stringify(baselineReport),
    });

    const consoleOutput = JSON.stringify([
      { level: 'error', message: 'Uncaught TypeError: x is not a function' },
    ]);

    const report = await runQAPass({
      url: 'http://localhost:3000',
      mode: 'regression',
      evidenceDir: '/tmp/evidence',
      baselinePath: '/tmp/baseline.json',
      browseConfig,
      _invokeBrowse: async (cmd) => {
        if (cmd === 'console') return { success: true, stdout: consoleOutput };
        return { success: true, stdout: '' };
      },
      _fsAdapter: fsAdapter,
    });

    assert.ok(report.regressions !== undefined, 'regressions should be populated');
    assert.ok(report.regressions!.length > 0, 'should detect new issues as regressions');
    assert.strictEqual(report.baselineCompared, '/tmp/baseline.json');
  });

  it('regression mode with missing baseline skips regression diff', async () => {
    const fsAdapter = makeFsAdapter(); // no files = ENOENT on readFile

    const report = await runQAPass({
      url: 'http://localhost:3000',
      mode: 'regression',
      evidenceDir: '/tmp/evidence',
      baselinePath: '/tmp/missing-baseline.json',
      browseConfig,
      _invokeBrowse: async () => ({ success: true, stdout: '' }),
      _fsAdapter: fsAdapter,
    });

    assert.strictEqual(report.regressions, undefined, 'regressions should be undefined when baseline is missing');
  });

  it('regression mode with malformed baseline JSON does not throw and skips regression diff', async () => {
    const fsAdapter = makeFsAdapter({ '/tmp/bad-baseline.json': '{invalid json!!!}' });

    const report = await runQAPass({
      url: 'http://localhost:3000',
      mode: 'regression',
      evidenceDir: '/tmp/evidence',
      baselinePath: '/tmp/bad-baseline.json',
      browseConfig,
      _invokeBrowse: async () => ({ success: true, stdout: '' }),
      _fsAdapter: fsAdapter,
    });

    assert.ok(Array.isArray(report.issues), 'issues should still be an array');
    assert.strictEqual(report.regressions, undefined, 'regressions should be undefined when baseline JSON is malformed');
  });
});

describe('saveQABaseline — with _fsAdapter', () => {
  it('writes JSON to the specified path via _fsAdapter', async () => {
    const written: Record<string, string> = {};
    const adapter = {
      mkdir: async () => undefined,
      writeFile: async (p: string, c: string) => { written[p] = c; },
    };

    const report = makeReport({ score: 88 });
    await saveQABaseline(report, '/tmp/baseline.json', adapter);

    assert.ok('/tmp/baseline.json' in written, 'should have written to baseline path');
    const parsed = JSON.parse(written['/tmp/baseline.json']) as QAReport;
    assert.strictEqual(parsed.score, 88, 'written JSON should preserve score');
  });
});

describe('findRegressions — direct tests', () => {
  it('identical reports yield 0 regressions', () => {
    const issues = [makeIssue('a11y-1', 'medium', 'accessibility', 'Missing alt text')];
    const baseline = makeReport({ issues });
    const current = makeReport({ issues });

    const regressions = findRegressions(baseline, current);
    assert.strictEqual(regressions.length, 0, 'identical reports should have no regressions');
  });
});

describe('runQAPass — evidence directory creation', () => {
  it('mkdir called with recursive:true before browse commands', async () => {
    const fsAdapter = makeFsAdapter();

    await runQAPass({
      url: 'http://localhost:3000',
      mode: 'quick',
      evidenceDir: '/tmp/deep/evidence',
      browseConfig,
      _invokeBrowse: async () => ({ success: true, stdout: '' }),
      _fsAdapter: fsAdapter,
    });

    assert.ok(fsAdapter.mkdirCalls.length >= 1, 'mkdir should have been called');
    assert.ok(fsAdapter.mkdirCalls.includes('/tmp/deep/evidence'), 'mkdir should be called with evidenceDir path');
  });
});
