import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runTimeMachineValidation } from '../src/core/time-machine-validation.js';
import { timeMachine } from '../src/cli/commands/time-machine.js';

describe('time-machine Class F benchmark controls', () => {
  let workspace: string;
  const oldCap = process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS;

  beforeEach(async () => {
    workspace = await mkdtemp(resolve(tmpdir(), 'df-tm-class-f-'));
  });

  afterEach(() => {
    if (oldCap === undefined) delete process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS;
    else process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS = oldCap;
    rmSync(workspace, { recursive: true, force: true });
  });

  it('lets explicit maxCommits override the env cap and reports build metadata', async () => {
    process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS = '5';

    const report = await runTimeMachineValidation({
      cwd: workspace,
      classes: ['F'],
      scale: 'benchmark',
      outDir: resolve(workspace, 'out'),
      runId: 'tmval_class_f_max_001',
      maxCommits: 25,
      now: () => '2026-04-30T10:00:00.000Z',
    });

    const first = report.classes.F?.benchmarks[0];
    assert.equal(report.status, 'passed');
    assert.equal(first?.commitCount, 25);
    assert.equal(first?.completedCommits, 25);
    assert.equal(first?.targetCommits, 25);
    assert.equal(first?.buildCompleted, true);
    assert.equal(first?.failureReason, undefined);
    assert.ok((first?.buildMs ?? -1) >= 0);
    assert.equal(first?.passedThreshold, true);
  });

  it('returns a partial Class F report instead of timing out silently when budget is exhausted', async () => {
    process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS = '1';

    const report = await runTimeMachineValidation({
      cwd: workspace,
      classes: ['F'],
      scale: 'benchmark',
      outDir: resolve(workspace, 'out-budget'),
      runId: 'tmval_class_f_budget_001',
      maxCommits: 1000,
      benchmarkTimeBudgetMinutes: 0,
      now: () => '2026-04-30T10:00:00.000Z',
    });

    const first = report.classes.F?.benchmarks[0];
    assert.equal(report.classes.F?.status, 'partial');
    assert.equal(first?.buildCompleted, false);
    assert.match(first?.failureReason ?? '', /time budget/i);
    assert.ok((first?.completedCommits ?? 1) < (first?.targetCommits ?? 0));
  });

  it('passes max-commits and benchmark-time-budget-minutes through the CLI command', async () => {
    process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS = '1';

    const lines: string[] = [];
    await timeMachine({
      action: 'validate',
      cwd: workspace,
      classes: 'F',
      scale: 'benchmark',
      maxCommits: 12,
      benchmarkTimeBudgetMinutes: 1,
      json: true,
      out: resolve(workspace, 'out-cli'),
      _stdout: line => lines.push(line),
      _now: () => '2026-04-30T10:00:00.000Z',
    });

    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.classes.F.benchmarks[0].commitCount, 12);
    assert.equal(parsed.classes.F.benchmarks[0].completedCommits, 12);
  });
});
