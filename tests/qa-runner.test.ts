// QA Runner tests — report structure, scoring, regression diff, baseline
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  computeQAScore,
  saveQABaseline,
  runQAPass,
  type QAReport,
  type QAIssue,
  type QARunMode,
  type QARunOptions,
  type BrowseResult,
} from '../src/core/qa-runner.js';
import type { BrowseAdapterConfig } from '../src/core/browse-adapter.js';

function makeIssue(severity: QAIssue['severity'], category = 'test'): QAIssue {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    category,
    description: `Test ${severity} issue`,
    remediation: 'Fix it',
  };
}

function makeReport(overrides: Partial<QAReport> = {}): QAReport {
  return {
    score: 100,
    mode: 'full' as QARunMode,
    url: 'https://example.com',
    timestamp: new Date().toISOString(),
    issues: [],
    screenshots: [],
    ...overrides,
  };
}

describe('computeQAScore', () => {
  it('returns 100 for no issues', () => {
    assert.strictEqual(computeQAScore([]), 100);
  });

  it('deducts 25 points per critical issue', () => {
    const issues = [makeIssue('critical')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 75);
  });

  it('deducts 10 points per high issue', () => {
    const issues = [makeIssue('high')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 90);
  });

  it('deducts 3 points per medium issue', () => {
    const issues = [makeIssue('medium')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 97);
  });

  it('does not deduct for informational issues', () => {
    const issues = [makeIssue('informational')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 100);
  });

  it('never goes below 0', () => {
    const issues = Array.from({ length: 10 }, () => makeIssue('critical'));
    const score = computeQAScore(issues);
    assert.strictEqual(score, 0);
  });

  it('accumulates deductions from mixed severities', () => {
    const issues = [
      makeIssue('critical'),
      makeIssue('high'),
      makeIssue('medium'),
      makeIssue('informational'),
    ];
    // 25 + 10 + 3 + 0 = 38 deductions
    const score = computeQAScore(issues);
    assert.strictEqual(score, 62);
  });
});

describe('QAReport structure', () => {
  it('has all required fields', () => {
    const report = makeReport();
    assert.ok(typeof report.score === 'number');
    assert.ok(typeof report.mode === 'string');
    assert.ok(typeof report.url === 'string');
    assert.ok(typeof report.timestamp === 'string');
    assert.ok(Array.isArray(report.issues));
    assert.ok(Array.isArray(report.screenshots));
  });

  it('supports regression mode with regressions array', () => {
    const report = makeReport({
      mode: 'regression',
      regressions: [makeIssue('high')],
      baselineCompared: '.danteforge/qa-baseline.json',
    });
    assert.strictEqual(report.mode, 'regression');
    assert.ok(Array.isArray(report.regressions));
    assert.strictEqual(report.regressions!.length, 1);
  });
});

describe('saveQABaseline', () => {
  it('writes a JSON file to the specified path', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-test-'));
    const baselinePath = path.join(tmpDir, 'baseline.json');

    const report = makeReport({ score: 95 });
    await saveQABaseline(report, baselinePath);

    const content = await fs.readFile(baselinePath, 'utf8');
    const parsed = JSON.parse(content) as QAReport;
    assert.strictEqual(parsed.score, 95);

    await fs.rm(tmpDir, { recursive: true });
  });

  it('creates nested directories as needed', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-test-'));
    const baselinePath = path.join(tmpDir, 'nested', 'deep', 'baseline.json');

    await saveQABaseline(makeReport(), baselinePath);

    const stat = await fs.stat(baselinePath);
    assert.ok(stat.isFile());
    await fs.rm(tmpDir, { recursive: true });
  });
});

// ── runQAPass with _invokeBrowse injection ────────────────────────────────────

const tempRunDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempRunDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTmpEvidenceDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-evidence-'));
  tempRunDirs.push(dir);
  return dir;
}

const fakeBrowseConfig: BrowseAdapterConfig = { binaryPath: '/fake/browse' };

function okBrowse(overrides?: Partial<BrowseResult>) {
  return async (_cmd: string, _args: string[], _cfg: BrowseAdapterConfig): Promise<BrowseResult> =>
    ({ success: true, stdout: '', ...overrides });
}

function failBrowse(errorMessage = 'connection refused') {
  return async (_cmd: string, _args: string[], _cfg: BrowseAdapterConfig): Promise<BrowseResult> =>
    ({ success: false, stdout: '', errorMessage });
}

function baseRunOptions(evidenceDir: string, overrides?: Partial<QARunOptions>): QARunOptions {
  return {
    url: 'http://localhost:3000',
    mode: 'full',
    evidenceDir,
    browseConfig: fakeBrowseConfig,
    _invokeBrowse: okBrowse(),
    ...overrides,
  };
}

describe('runQAPass — navigation failure', () => {
  it('returns critical issue when goto fails', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const report = await runQAPass({
      ...baseRunOptions(evidenceDir),
      _invokeBrowse: failBrowse('connection refused'),
    });

    assert.ok(report.score < 100);
    assert.strictEqual(report.issues.length, 1);
    assert.strictEqual(report.issues[0].severity, 'critical');
    assert.strictEqual(report.issues[0].category, 'navigation');
    assert.ok(report.issues[0].description.includes('connection refused'));
  });

  it('returns early — only goto is called when nav fails', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];

    await runQAPass({
      ...baseRunOptions(evidenceDir),
      _invokeBrowse: async (cmd) => {
        commands.push(cmd);
        if (cmd === 'goto') return { success: false, stdout: '', errorMessage: 'timeout' };
        return { success: true, stdout: '' };
      },
    });

    assert.deepStrictEqual(commands, ['goto']);
  });
});

describe('runQAPass — quick mode', () => {
  it('runs exactly goto + screenshot + accessibility', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];

    await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'quick' }),
      _invokeBrowse: async (cmd) => { commands.push(cmd); return { success: true, stdout: '' }; },
    });

    assert.deepStrictEqual(commands, ['goto', 'screenshot', 'accessibility']);
  });

  it('does not invoke console/network/perf in quick mode', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];

    await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'quick' }),
      _invokeBrowse: async (cmd) => { commands.push(cmd); return { success: true, stdout: '' }; },
    });

    assert.ok(!commands.includes('console'));
    assert.ok(!commands.includes('network'));
    assert.ok(!commands.includes('perf'));
  });

  it('collects evidencePath from screenshot result', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const screenshotPath = path.join(evidenceDir, 'shot.png');

    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'quick' }),
      _invokeBrowse: async (cmd) => {
        if (cmd === 'screenshot') return { success: true, stdout: '', evidencePath: screenshotPath };
        return { success: true, stdout: '' };
      },
    });

    assert.deepStrictEqual(report.screenshots, [screenshotPath]);
  });
});

describe('runQAPass — full mode', () => {
  it('runs all 6 steps: goto screenshot accessibility console network perf', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];

    await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'full' }),
      _invokeBrowse: async (cmd) => { commands.push(cmd); return { success: true, stdout: '' }; },
    });

    assert.deepStrictEqual(commands, ['goto', 'screenshot', 'accessibility', 'console', 'network', 'perf']);
  });

  it('returns score 100 and empty issues when all checks pass', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const report = await runQAPass(baseRunOptions(evidenceDir, { mode: 'full' }));

    assert.strictEqual(report.score, 100);
    assert.strictEqual(report.issues.length, 0);
    assert.strictEqual(report.mode, 'full');
  });

  it('includes url and valid ISO timestamp in report', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const url = 'http://localhost:9000';
    const report = await runQAPass(baseRunOptions(evidenceDir, { url, mode: 'full' }));

    assert.strictEqual(report.url, url);
    assert.ok(!isNaN(Date.parse(report.timestamp)));
  });

  it('continues all steps even when screenshot fails', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];

    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'full' }),
      _invokeBrowse: async (cmd) => {
        commands.push(cmd);
        if (cmd === 'screenshot') return { success: false, stdout: '' };
        return { success: true, stdout: '' };
      },
    });

    assert.deepStrictEqual(commands, ['goto', 'screenshot', 'accessibility', 'console', 'network', 'perf']);
    assert.strictEqual(report.screenshots.length, 0);
  });

  it('creates evidence directory recursively when it does not exist', async () => {
    const parent = await makeTmpEvidenceDir();
    const evidenceDir = path.join(parent, 'nested', 'evidence');

    await runQAPass(baseRunOptions(evidenceDir, { mode: 'full' }));

    const stat = await fs.stat(evidenceDir);
    assert.ok(stat.isDirectory());
  });
});

describe('runQAPass — regression mode', () => {
  it('populates regressions=[] when current has no new issues', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const baselinePath = path.join(evidenceDir, 'baseline.json');

    await saveQABaseline(makeReport({ issues: [] }), baselinePath);

    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'regression', baselinePath }),
    });

    assert.deepStrictEqual(report.regressions, []);
    assert.strictEqual(report.baselineCompared, baselinePath);
  });

  it('identifies new issues as regressions', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const baselinePath = path.join(evidenceDir, 'baseline.json');

    // Baseline has no console issues
    await saveQABaseline(makeReport({ issues: [] }), baselinePath);

    const consoleOutput = JSON.stringify([
      { level: 'error', message: 'Uncaught TypeError: x is not a function' },
    ]);

    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'regression', baselinePath }),
      _invokeBrowse: async (cmd) => {
        if (cmd === 'console') return { success: true, stdout: consoleOutput };
        return { success: true, stdout: '' };
      },
    });

    assert.ok(report.regressions !== undefined);
    assert.ok(report.regressions!.length > 0);
  });

  it('skips regression diff when baseline file is missing', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'regression', baselinePath: path.join(evidenceDir, 'missing.json') }),
    });

    assert.strictEqual(report.regressions, undefined);
  });

  it('skips regression diff when baselinePath is not provided', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const report = await runQAPass(baseRunOptions(evidenceDir, { mode: 'regression' }));

    assert.strictEqual(report.regressions, undefined);
  });
});

// ── Wave I3: Additional coverage tests ─────────────────────────────────────

describe('runQAPass — full mode with specific step failures', () => {
  it('continues when accessibility check fails', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];
    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'full' }),
      _invokeBrowse: async (cmd) => {
        commands.push(cmd);
        if (cmd === 'accessibility') return { success: false, stdout: '', errorMessage: 'a11y check failed' };
        return { success: true, stdout: '' };
      },
    });

    // Should complete all steps despite a11y failure
    assert.ok(commands.includes('goto'), 'should have run goto');
    assert.ok(commands.includes('accessibility'), 'should have run accessibility');
    assert.ok(commands.includes('perf'), 'should continue to perf after a11y failure');
    // Score should still be computed (may or may not have issues depending on impl)
    assert.ok(typeof report.score === 'number', 'should still compute a score');
  });

  it('continues when console check fails', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];
    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'full' }),
      _invokeBrowse: async (cmd) => {
        commands.push(cmd);
        if (cmd === 'console') return { success: false, stdout: '', errorMessage: 'console check error' };
        return { success: true, stdout: '' };
      },
    });

    assert.ok(commands.includes('console'), 'should have run console');
    assert.ok(commands.length >= 5, 'should continue running remaining steps');
  });

  it('continues when network check fails', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];
    await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'full' }),
      _invokeBrowse: async (cmd) => {
        commands.push(cmd);
        if (cmd === 'network') return { success: false, stdout: '', errorMessage: 'network error' };
        return { success: true, stdout: '' };
      },
    });

    assert.ok(commands.includes('network'), 'should have run network');
    assert.ok(commands.includes('perf'), 'should continue to perf after network failure');
  });

  it('continues when perf check fails', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const commands: string[] = [];
    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'full' }),
      _invokeBrowse: async (cmd) => {
        commands.push(cmd);
        if (cmd === 'perf') return { success: false, stdout: '', errorMessage: 'perf timeout' };
        return { success: true, stdout: '' };
      },
    });

    assert.ok(commands.includes('perf'), 'should have attempted perf');
    assert.strictEqual(typeof report.score, 'number');
    assert.ok(report.score >= 0 && report.score <= 100, `score should be 0-100, got ${report.score}`);
  });
});

describe('runQAPass — evidence collection', () => {
  it('collects evidence paths from successful browse results', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const screenshotPath = path.join(evidenceDir, 'test-screenshot.png');
    await fs.writeFile(screenshotPath, 'fake-png');

    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'full' }),
      _invokeBrowse: async (cmd) => {
        if (cmd === 'screenshot') {
          return { success: true, stdout: '', evidencePath: screenshotPath };
        }
        return { success: true, stdout: '' };
      },
    });

    assert.ok(report.screenshots.length > 0, 'should collect screenshot evidence');
    assert.ok(report.screenshots[0].includes('test-screenshot'), 'screenshot path should match');
  });
});

describe('computeQAScore — boundary cases', () => {
  it('returns 0 when 4+ critical issues', () => {
    const issues = Array.from({ length: 4 }, () => makeIssue('critical'));
    const score = computeQAScore(issues);
    assert.strictEqual(score, 0, '4 critical issues = 0 score');
  });

  it('returns 0 when score would be negative', () => {
    const issues = Array.from({ length: 10 }, () => makeIssue('critical'));
    const score = computeQAScore(issues);
    assert.strictEqual(score, 0, 'score should never be negative');
  });

  it('mixed severity computes weighted deductions', () => {
    const issues = [
      makeIssue('critical'),
      makeIssue('high'),
      makeIssue('medium'),
      makeIssue('informational'),
    ];
    const score = computeQAScore(issues);
    assert.ok(score > 0, 'mixed issues should still have positive score');
    assert.ok(score < 100, 'mixed issues should reduce score');
  });
});

describe('saveQABaseline — edge cases', () => {
  it('overwrites existing baseline file', async () => {
    const dir = await makeTmpEvidenceDir();
    const baselinePath = path.join(dir, 'baseline.json');

    const report1 = makeReport({ score: 80 });
    await saveQABaseline(report1, baselinePath);

    const report2 = makeReport({ score: 95 });
    await saveQABaseline(report2, baselinePath);

    const content = await fs.readFile(baselinePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.score, 95, 'should have overwritten with second report');
  });
});

describe('QAReport structure', () => {
  it('preserves url and mode fields', () => {
    const report = makeReport({ url: 'https://test.local', mode: 'quick' });
    assert.strictEqual(report.url, 'https://test.local');
    assert.strictEqual(report.mode, 'quick');
  });

  it('regression mode has optional regressions field', () => {
    const report = makeReport({ mode: 'regression', regressions: [makeIssue('high', 'perf')] });
    assert.ok(Array.isArray(report.regressions));
    assert.strictEqual(report.regressions!.length, 1);
    assert.strictEqual(report.regressions![0].category, 'perf');
  });
});

describe('runQAPass — regression with matching baseline', () => {
  it('reports no regressions when current matches baseline', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const baselinePath = path.join(evidenceDir, 'baseline.json');

    // Both baseline and current have no issues
    await saveQABaseline(makeReport({ issues: [] }), baselinePath);

    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'regression', baselinePath }),
      _invokeBrowse: async () => ({ success: true, stdout: '' }),
    });

    // No new issues = no regressions
    if (report.regressions) {
      assert.strictEqual(report.regressions.length, 0, 'matching baseline should have no regressions');
    }
  });
});

describe('runQAPass — quick mode', () => {
  it('quick mode with perfect score returns 100', async () => {
    const evidenceDir = await makeTmpEvidenceDir();
    const report = await runQAPass({
      ...baseRunOptions(evidenceDir, { mode: 'quick' }),
      _invokeBrowse: async () => ({ success: true, stdout: '' }),
    });

    assert.strictEqual(report.score, 100, 'no issues should give perfect score');
    assert.strictEqual(report.mode, 'quick');
    assert.strictEqual(report.issues.length, 0);
  });
});
