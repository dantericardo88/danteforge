// autoresearch-engine.test.ts — direct unit tests for exported engine functions
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitCommand,
  extractNumber,
  runMeasurement,
  runBaseline,
  runExperiment,
  shouldKeep,
  formatResultsTsv,
  formatReport,
} from '../src/core/autoresearch-engine.js';
import type { AutoResearchConfig, ExperimentResult, AutoResearchReport, ExecFileFn } from '../src/core/autoresearch-engine.js';

function makeConfig(overrides: Partial<AutoResearchConfig> = {}): AutoResearchConfig {
  return {
    goal: 'improve coverage',
    metric: 'coverage percent',
    timeBudgetMinutes: 30,
    measurementCommand: 'echo 87',
    cwd: '/tmp',
    ...overrides,
  };
}

// ── splitCommand ──────────────────────────────────────────────────────────────

describe('splitCommand', () => {
  it('splits simple two-token command', () => {
    assert.deepStrictEqual(splitCommand('echo hello'), ['echo', 'hello']);
  });

  it('preserves single-quoted argument as one token', () => {
    assert.deepStrictEqual(splitCommand("echo 'hello world'"), ['echo', 'hello world']);
  });

  it('preserves double-quoted argument as one token', () => {
    assert.deepStrictEqual(splitCommand('npm run "my script"'), ['npm', 'run', 'my script']);
  });

  it('collapses multiple consecutive spaces', () => {
    assert.deepStrictEqual(splitCommand('  echo  hello  '), ['echo', 'hello']);
  });

  it('returns single-element array for single token', () => {
    assert.deepStrictEqual(splitCommand('echo'), ['echo']);
  });

  it('returns empty array for empty string', () => {
    assert.deepStrictEqual(splitCommand(''), []);
  });
});

// ── extractNumber ─────────────────────────────────────────────────────────────

describe('extractNumber', () => {
  it('extracts float from mixed text', () => {
    assert.strictEqual(extractNumber('coverage 87.42%'), 87.42);
  });

  it('extracts negative number', () => {
    assert.strictEqual(extractNumber('-5.0 delta'), -5);
  });

  it('returns null when no number present', () => {
    assert.strictEqual(extractNumber('no number here'), null);
  });

  it('returns first number from text with multiple numbers', () => {
    assert.strictEqual(extractNumber('3 items 10 errors'), 3);
  });

  it('extracts bare decimal', () => {
    assert.strictEqual(extractNumber('0.99'), 0.99);
  });
});

// ── runMeasurement ────────────────────────────────────────────────────────────

describe('runMeasurement', () => {
  it('returns parsed number from execFn stdout', async () => {
    const execFn = async () => ({ stdout: '87.42\n' });
    const result = await runMeasurement(makeConfig({ measurementCommand: 'echo 87' }), execFn);
    assert.strictEqual(result, 87.42);
  });

  it('throws on empty measurement command', async () => {
    const execFn = async () => ({ stdout: '0' });
    await assert.rejects(
      () => runMeasurement(makeConfig({ measurementCommand: '' }), execFn),
      /Empty measurement command/,
    );
  });

  it('throws when stdout contains no parseable number', async () => {
    const execFn = async () => ({ stdout: 'no number here' });
    await assert.rejects(
      () => runMeasurement(makeConfig({ measurementCommand: 'echo x' }), execFn),
      /no parseable number/i,
    );
  });

  it('passes split args to execFn', async () => {
    const calls: Array<[string, string[]]> = [];
    const execFn = async (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return { stdout: '42' };
    };
    await runMeasurement(makeConfig({ measurementCommand: 'echo 42' }), execFn);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]![0], 'echo');
    assert.deepStrictEqual(calls[0]![1], ['42']);
  });

  it('passes cwd from config to execFn', async () => {
    const cwdValues: string[] = [];
    const execFn = async (_cmd: string, _args: string[], opts: { cwd: string }) => {
      cwdValues.push(opts.cwd);
      return { stdout: '99' };
    };
    await runMeasurement(makeConfig({ cwd: '/project/root', measurementCommand: 'echo 99' }), execFn);
    assert.strictEqual(cwdValues[0], '/project/root');
  });
});

// ── shouldKeep ────────────────────────────────────────────────────────────────

describe('shouldKeep', () => {
  it('returns true when improvement exceeds noise margin (lower=better)', () => {
    // 50 vs baseline 100: relative change = (100-50)/100 = 0.5 > 0.01
    assert.strictEqual(shouldKeep(50, 100, 0.01), true);
  });

  it('returns false when improvement is within noise margin', () => {
    // 99 vs baseline 100: relative change = (100-99)/100 = 0.01; not > 0.01
    assert.strictEqual(shouldKeep(99, 100, 0.01), false);
  });

  it('returns false when value is unchanged', () => {
    assert.strictEqual(shouldKeep(100, 100, 0.01), false);
  });
});

// ── formatResultsTsv ──────────────────────────────────────────────────────────

describe('formatResultsTsv', () => {
  it('includes header row and data rows for kept experiments', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'add cache', metricValue: 80, status: 'keep' },
      { id: 2, description: 'tree shake', metricValue: 75, status: 'keep' },
    ];
    const tsv = formatResultsTsv(experiments);
    const rows = tsv.split('\n');
    assert.ok(rows[0]!.includes('experiment'), 'first row is header');
    assert.ok(rows[1]!.includes('1'), 'second row is first experiment');
    assert.ok(rows[2]!.includes('2'), 'third row is second experiment');
  });

  it('shows "crash" in metric column for crashed experiments', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'bad idea', metricValue: null, status: 'crash' },
    ];
    const tsv = formatResultsTsv(experiments);
    assert.ok(tsv.includes('crash'), 'crash status appears in TSV');
  });
});

// ── formatReport ──────────────────────────────────────────────────────────────

describe('formatReport', () => {
  it('produces markdown with goal and no-experiments message when empty', () => {
    const report: AutoResearchReport = {
      goal: 'improve latency',
      metric: 'p99 ms',
      duration: '5m 0s',
      baseline: 100,
      final: 100,
      improvement: 0,
      improvementPercent: 0,
      experiments: [],
      kept: 0,
      discarded: 0,
      crashed: 0,
      insights: [],
    };
    const md = formatReport(report);
    assert.ok(md.includes('improve latency'), 'goal appears in report');
    assert.ok(md.includes('No experiments'), 'no-experiments message appears');
  });

  it('includes improvement percent when experiments were kept', () => {
    const experiments: ExperimentResult[] = [
      { id: 1, description: 'add cache', metricValue: 80, status: 'keep', commitHash: 'abc1234' },
      { id: 2, description: 'slow path', metricValue: 110, status: 'discard' },
    ];
    const report: AutoResearchReport = {
      goal: 'reduce latency',
      metric: 'p99 ms',
      duration: '10m 0s',
      baseline: 100,
      final: 80,
      improvement: 20,
      improvementPercent: 20,
      experiments,
      kept: 1,
      discarded: 1,
      crashed: 0,
      insights: ['Caching helps'],
    };
    const md = formatReport(report);
    assert.ok(md.includes('20.00%'), 'improvement percent appears in report');
    assert.ok(md.includes('abc1234'), 'commit hash appears in report');
    assert.ok(md.includes('Caching helps'), 'insight appears in report');
  });
});

// ── runBaseline ───────────────────────────────────────────────────────────────

describe('runBaseline', () => {
  it('returns parsed number from injected execFn stdout', async () => {
    const execFn: ExecFileFn = async () => ({ stdout: '75.33\n' });
    const result = await runBaseline(makeConfig({ measurementCommand: 'npm test' }), execFn);
    assert.strictEqual(result, 75.33);
  });

  it('propagates execFn error (command timeout)', async () => {
    const execFn: ExecFileFn = async () => { throw new Error('Command timed out'); };
    await assert.rejects(
      () => runBaseline(makeConfig({ measurementCommand: 'slow-cmd' }), execFn),
      /timed out/,
    );
  });

  it('extracts first number from noisy stdout', async () => {
    const execFn: ExecFileFn = async () => ({ stdout: 'Coverage summary:\n88.50%\nBranch: 91.2%\n' });
    const result = await runBaseline(makeConfig({ measurementCommand: 'npm run coverage' }), execFn);
    assert.strictEqual(result, 88.5);
  });
});

// ── runExperiment ─────────────────────────────────────────────────────────────

describe('runExperiment', () => {
  it('returns metricValue and status=keep on successful measurement', async () => {
    const execFn: ExecFileFn = async () => ({ stdout: '90\n' });
    const result = await runExperiment(makeConfig({ measurementCommand: 'echo 90' }), 3, 'add cache', execFn);
    assert.strictEqual(result.metricValue, 90);
    assert.strictEqual(result.status, 'keep');
    assert.strictEqual(result.id, 3);
    assert.strictEqual(result.description, 'add cache');
  });

  it('returns metricValue=null and status=crash when execFn throws', async () => {
    const execFn: ExecFileFn = async () => { throw new Error('process crashed'); };
    const result = await runExperiment(makeConfig({ measurementCommand: 'bad-cmd' }), 7, 'broken idea', execFn);
    assert.strictEqual(result.metricValue, null);
    assert.strictEqual(result.status, 'crash');
    assert.strictEqual(result.id, 7);
    assert.strictEqual(result.description, 'broken idea');
  });

  it('passes id and description through correctly in both paths', async () => {
    const successFn: ExecFileFn = async () => ({ stdout: '42' });
    const successResult = await runExperiment(makeConfig(), 99, 'my experiment', successFn);
    assert.strictEqual(successResult.id, 99);
    assert.strictEqual(successResult.description, 'my experiment');
  });
});
