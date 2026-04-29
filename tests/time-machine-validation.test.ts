import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  TIME_MACHINE_VALIDATION_SCHEMA_VERSION,
  runTimeMachineValidation,
  type TimeMachineValidationReport,
} from '../src/core/time-machine-validation.js';
import { verifyTimeMachine } from '../src/core/time-machine.js';
import { computeCanonicalScore } from '../src/core/harsh-scorer.js';
import { verifyBundle } from '@danteforge/evidence-chain';

describe('time-machine validation harness', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(resolve(tmpdir(), 'df-tm-validation-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('runs PRD-scale A/B/C validation with expected counts and proof-backed reports', async () => {
    const report = await runTimeMachineValidation({
      cwd: workspace,
      classes: ['A', 'B', 'C'],
      scale: 'prd',
      outDir: resolve(workspace, 'validation-out'),
      runId: 'tmval_20260429_001',
      now: () => '2026-04-29T10:00:00.000Z',
    });

    assert.equal(report.schemaVersion, TIME_MACHINE_VALIDATION_SCHEMA_VERSION);
    assert.equal(report.status, 'partial');
    assert.equal(report.classes.A?.commitCount, 1000);
    assert.equal(report.classes.A?.adversarialDetections.length, 7);
    assert.equal(report.classes.A?.cleanChainFalsePositiveRuns, 100);
    assert.ok(report.classes.A?.adversarialDetections.every(item => item.detected));
    assert.equal(report.classes.B?.commitCount, 1000);
    assert.equal(report.classes.B?.restoreScenarios.length, 6);
    assert.ok(report.classes.B?.restoreScenarios.every(item => item.byteIdentical));
    assert.equal(report.classes.C?.commitCount, 100);
    assert.equal(report.classes.C?.causalQueries.length, 7);
    assert.equal(report.classes.C?.completenessAudit.complete, 100);
    assert.equal(report.classes.C?.completenessAudit.gaps, 0);
    assert.equal(verifyBundle(report.proof).valid, true);
    assert.ok(existsSync(resolve(report.outDir, 'report.json')));
    assert.ok(existsSync(resolve(report.outDir, 'report.md')));
    assert.ok(existsSync(resolve(report.outDir, 'results', 'class-A.json')));
  });

  it('runs D/E/F/G validation without fabricating live DELEGATE-52 success', async () => {
    const report = await runTimeMachineValidation({
      cwd: workspace,
      classes: ['D', 'E', 'F', 'G'],
      scale: 'smoke',
      delegate52Mode: 'harness',
      maxDomains: 2,
      outDir: resolve(workspace, 'validation-out'),
      runId: 'tmval_20260429_002',
      now: () => '2026-04-29T10:00:00.000Z',
    });

    assert.equal(report.classes.D?.status, 'harness_ready_not_live_validated');
    assert.equal(report.classes.D?.domainRows.length, 2);
    assert.match(report.classes.D?.limitations.join('\n') ?? '', /not live validated/i);
    assert.equal(report.classes.E?.scenarios.length, 5);
    assert.ok(report.classes.E?.scenarios.every(item => item.detected));
    assert.ok((report.classes.F?.benchmarks.length ?? 0) >= 1);
    assert.ok(report.classes.F?.benchmarks.every(item => item.commitCount > 0 && item.verifyMs >= 0));
    assert.equal(report.classes.G?.scenarios.length, 4);
    assert.ok(report.classes.G?.scenarios.some(item => item.status === 'staged_founder_gated'));
    assert.ok(report.summary.claimsAllowed.some(claim => /harness/i.test(claim)));
    assert.ok(report.summary.claimsNotAllowed.some(claim => /DELEGATE-52/i.test(claim)));
  });

  it('writes a local Time Machine commit for the validation report and keeps canonical scoring pure', async () => {
    const beforeScore = await computeCanonicalScore(workspace);
    const report = await runTimeMachineValidation({
      cwd: workspace,
      classes: ['A'],
      scale: 'smoke',
      outDir: resolve(workspace, 'validation-out'),
      runId: 'tmval_20260429_003',
      now: () => '2026-04-29T10:00:00.000Z',
    });
    const afterScore = await computeCanonicalScore(workspace);
    const verify = await verifyTimeMachine({ cwd: workspace });

    assert.equal(beforeScore.overall, afterScore.overall);
    assert.equal(verify.valid, true);
    assert.ok(verify.commitsChecked >= 1);
    assert.ok(readFileSync(resolve(report.outDir, 'report.md'), 'utf8').includes('Time Machine Validation Report'));
  });
});
