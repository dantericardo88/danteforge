// Pass 20 Part B — prd-real scale tests.
//
// These tests run the real-fs path at full PRD scale (1000 commits for A/B,
// 100 decisions for C). They are slower than smoke tests (~10-60s per class)
// so they run in the orchestration-heavy lane. They prove the on-disk substrate
// holds at the scale Microsoft Research's DELEGATE-52 paper specifies.

import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTimeMachineValidation } from '../src/core/time-machine-validation.js';

let workspace: string;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), 'dfg-prd-real-'));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

test('Pass 20 — Class A prd-real 1000-commit detects all 7 mods + 0 false positives in 100 runs', { timeout: 300_000 }, async () => {
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['A'],
    scale: 'prd-real',
    runId: 'pass20_class_a_real',
    now: () => '2026-04-29T21:00:00.000Z',
  });
  const a = report.classes.A!;
  assert.equal(a.status, 'passed');
  assert.equal(a.commitCount, 1000);
  assert.equal(a.cleanChainFalsePositiveRuns, 100);
  assert.equal(a.cleanChainFalsePositives, 0, 'zero false positives on clean 1000-commit chain');
  assert.equal(a.adversarialDetections.length, 7);
  assert.equal(a.adversarialDetections.every(d => d.detected), true, 'all 7 adversarial mods detected');
  assert.ok(a.maxDetectionMs < 5000, `max detection time ${a.maxDetectionMs}ms should be under 5s threshold`);
});

test('Pass 20 — Class B prd-real 1000-commit B1-B6 byte-identical', { timeout: 300_000 }, async () => {
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['B'],
    scale: 'prd-real',
    runId: 'pass20_class_b_real',
    now: () => '2026-04-29T21:00:01.000Z',
  });
  const b = report.classes.B!;
  assert.equal(b.status, 'passed');
  assert.equal(b.commitCount, 1000);
  assert.equal(b.restoreScenarios.length, 6, 'B1-B6 = 6 scenarios');
  assert.equal(b.restoreScenarios.every(s => s.byteIdentical), true, 'all 6 scenarios byte-identical at PRD scale');
});

test('Pass 20 — Class C prd-real 100-decision causal queries + completeness audit', { timeout: 300_000 }, async () => {
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['C'],
    scale: 'prd-real',
    runId: 'pass20_class_c_real',
    now: () => '2026-04-29T21:00:02.000Z',
  });
  const c = report.classes.C!;
  assert.equal(c.status, 'passed');
  assert.equal(c.commitCount, 100);
  assert.equal(c.causalQueries.length, 7, 'C1-C7 = 7 queries');
  assert.equal(c.causalQueries.every(q => q.passed), true, 'all 7 queries pass at PRD scale');
  assert.equal(c.completenessAudit.gaps, 0, 'zero completeness gaps in 100 decisions');
  assert.equal(c.completenessAudit.complete, 100, 'all 100 decisions have complete causal traces');
});
