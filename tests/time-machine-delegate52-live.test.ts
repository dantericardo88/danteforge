// Pass 19 — Live DELEGATE-52 round-trip executor tests.
//
// Exercises the new dry-run mode + live-mode gating. Uses an injected `_llmCaller`
// so no real provider is called. The actual live run with real LLM API spend is
// founder-gated (GATE-1) — the agent does NOT trigger live mode in tests.

import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runTimeMachineValidation } from '../src/core/time-machine-validation.js';

let workspace: string;
const originalDryRun = process.env.DANTEFORGE_DELEGATE52_DRY_RUN;
const originalLive = process.env.DANTEFORGE_DELEGATE52_LIVE;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalClaudeKey = process.env.DANTEFORGE_CLAUDE_API_KEY;
const originalDanteAnthropicKey = process.env.DANTEFORGE_ANTHROPIC_API_KEY;
const originalGenericKey = process.env.DANTEFORGE_LLM_API_KEY;
const originalAnthropicModel = process.env.ANTHROPIC_MODEL;
const originalDelegateModel = process.env.DANTEFORGE_DELEGATE52_MODEL;

before(() => {
  workspace = mkdtempSync(join(tmpdir(), 'dfg-delegate52-live-'));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
  if (originalDryRun === undefined) delete process.env.DANTEFORGE_DELEGATE52_DRY_RUN;
  else process.env.DANTEFORGE_DELEGATE52_DRY_RUN = originalDryRun;
  if (originalLive === undefined) delete process.env.DANTEFORGE_DELEGATE52_LIVE;
  else process.env.DANTEFORGE_DELEGATE52_LIVE = originalLive;
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  if (originalClaudeKey === undefined) delete process.env.DANTEFORGE_CLAUDE_API_KEY;
  else process.env.DANTEFORGE_CLAUDE_API_KEY = originalClaudeKey;
  if (originalDanteAnthropicKey === undefined) delete process.env.DANTEFORGE_ANTHROPIC_API_KEY;
  else process.env.DANTEFORGE_ANTHROPIC_API_KEY = originalDanteAnthropicKey;
  if (originalGenericKey === undefined) delete process.env.DANTEFORGE_LLM_API_KEY;
  else process.env.DANTEFORGE_LLM_API_KEY = originalGenericKey;
  if (originalAnthropicModel === undefined) delete process.env.ANTHROPIC_MODEL;
  else process.env.ANTHROPIC_MODEL = originalAnthropicModel;
  if (originalDelegateModel === undefined) delete process.env.DANTEFORGE_DELEGATE52_MODEL;
  else process.env.DANTEFORGE_DELEGATE52_MODEL = originalDelegateModel;
});

test('Pass 19 — dry-run mode produces structured plan without spending', async () => {
  process.env.DANTEFORGE_DELEGATE52_DRY_RUN = '1';
  delete process.env.DANTEFORGE_DELEGATE52_LIVE;
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['D'],
    scale: 'smoke',
    delegate52Mode: 'live',
    maxDomains: 3,
    roundTripsPerDomain: 2,
    runId: 'pass19_dry_run_test',
    now: () => '2026-04-29T20:00:00.000Z',
  });
  assert.equal(report.classes.D?.status, 'live_dry_run', 'dry-run status should be live_dry_run');
  assert.equal(report.classes.D?.domainRows.length, 3);
  for (const row of report.classes.D?.domainRows ?? []) {
    assert.equal(row.mode, 'live');
    assert.equal(row.status, 'live_dry_run_completed');
    assert.equal(row.byteIdenticalAfterRoundTrips, true, 'dry-run sim should produce byte-identical round-trip');
    assert.equal(row.costUsd, 0, 'dry-run should not spend');
    assert.equal(row.interactionCount, 4, '2 round-trips × forward+backward = 4 interactions');
  }
  assert.equal(report.classes.D?.totalCostUsd, 0);
});

test('Pass 19 — live mode without DANTEFORGE_DELEGATE52_LIVE env-var refuses (returns live_not_enabled)', async () => {
  delete process.env.DANTEFORGE_DELEGATE52_DRY_RUN;
  delete process.env.DANTEFORGE_DELEGATE52_LIVE;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.DANTEFORGE_CLAUDE_API_KEY;
  delete process.env.DANTEFORGE_ANTHROPIC_API_KEY;
  delete process.env.DANTEFORGE_LLM_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  delete process.env.DANTEFORGE_DELEGATE52_MODEL;
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['D'],
    scale: 'smoke',
    delegate52Mode: 'live',
    budgetUsd: 80,  // budget present but env-var missing
    maxDomains: 2,
    runId: 'pass19_live_missing_envvar',
    now: () => '2026-04-29T20:00:01.000Z',
  });
  assert.equal(report.classes.D?.status, 'live_not_enabled');
  assert.ok(report.classes.D?.liveBlockers?.includes('blocked_by_missing_credentials'));
  assert.ok(report.classes.D?.liveBlockers?.includes('blocked_by_missing_model'));
  for (const row of report.classes.D?.domainRows ?? []) {
    assert.equal(row.status, 'live_not_enabled_explicit_budget_required');
  }
});

test('Pass 19 — live mode without --budget-usd refuses (returns live_not_enabled)', async () => {
  delete process.env.DANTEFORGE_DELEGATE52_DRY_RUN;
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['D'],
    scale: 'smoke',
    delegate52Mode: 'live',
    // budgetUsd intentionally omitted
    maxDomains: 2,
    runId: 'pass19_live_missing_budget',
    now: () => '2026-04-29T20:00:02.000Z',
  });
  assert.equal(report.classes.D?.status, 'live_not_enabled');
  assert.ok(report.classes.D?.liveBlockers?.includes('blocked_by_missing_budget'));
});

test('Pass 19 — live mode with all guards + injected llmCaller executes round-trips and tracks cost', async () => {
  delete process.env.DANTEFORGE_DELEGATE52_DRY_RUN;
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  let callCount = 0;
  const fakeCost = 0.001;  // $0.001 per interaction
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['D'],
    scale: 'smoke',
    delegate52Mode: 'live',
    budgetUsd: 1.0,
    maxDomains: 2,
    roundTripsPerDomain: 3,
    runId: 'pass19_live_with_mock',
    _llmCaller: async (prompt: string) => {
      callCount += 1;
      // Identity transform — returns input unchanged so round-trips are clean
      const docMarker = prompt.lastIndexOf('Edited document:\n');
      const fallbackMarker = prompt.lastIndexOf('Document:\n');
      const start = docMarker >= 0 ? docMarker + 'Edited document:\n'.length : fallbackMarker + 'Document:\n'.length;
      const doc = start > 0 ? prompt.slice(start).split('\n\nReference shape:')[0]!.trim() + '\n' : prompt;
      return { output: doc, costUsd: fakeCost };
    },
    now: () => '2026-04-29T20:00:03.000Z',
  });
  assert.equal(report.classes.D?.status, 'live_completed');
  assert.equal(callCount, 12, '2 domains × 3 round-trips × 2 interactions = 12 LLM calls');
  for (const row of report.classes.D?.domainRows ?? []) {
    assert.equal(row.status, 'live_completed');
    assert.equal(row.interactionCount, 6, '3 round-trips × forward+backward = 6 interactions per domain');
    assert.equal(row.byteIdenticalAfterRoundTrips, true, 'identity LLM produces clean round-trip');
    assert.ok(row.costUsd && row.costUsd > 0, 'cost should accumulate');
  }
  assert.ok(report.classes.D?.totalCostUsd && report.classes.D.totalCostUsd > 0);
  assert.ok(report.classes.D!.totalCostUsd! < 1.0, 'should be under $1 budget');
});

test('Pass 19 — live mode stops when budget exhausted mid-loop', async () => {
  delete process.env.DANTEFORGE_DELEGATE52_DRY_RUN;
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['D'],
    scale: 'smoke',
    delegate52Mode: 'live',
    budgetUsd: 0.005,  // Tiny budget; exhausts after a couple calls
    maxDomains: 5,
    roundTripsPerDomain: 3,
    runId: 'pass19_budget_exhaust',
    _llmCaller: async (prompt: string) => {
      const docMarker = prompt.lastIndexOf('Edited document:\n');
      const fallbackMarker = prompt.lastIndexOf('Document:\n');
      const start = docMarker >= 0 ? docMarker + 'Edited document:\n'.length : fallbackMarker + 'Document:\n'.length;
      const doc = start > 0 ? prompt.slice(start).split('\n\nReference shape:')[0]!.trim() + '\n' : prompt;
      return { output: doc, costUsd: 0.002 };  // 3 calls = $0.006 > $0.005 budget
    },
    now: () => '2026-04-29T20:00:04.000Z',
  });
  assert.equal(report.classes.D?.status, 'live_completed');
  // At least one domain should be marked budget_exhausted or have stopped early
  const exhaustedCount = (report.classes.D?.domainRows ?? []).filter(r => r.status === 'budget_exhausted').length;
  const earlyStopCount = (report.classes.D?.domainRows ?? []).filter(r => (r.interactionCount ?? 0) < 6).length;
  assert.ok(exhaustedCount > 0 || earlyStopCount > 0, 'budget exhaustion should manifest as either status=budget_exhausted or early-stopped domains');
});

test('Pass 19 — live-result.json artifact written for live runs', async () => {
  delete process.env.DANTEFORGE_DELEGATE52_DRY_RUN;
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  const report = await runTimeMachineValidation({
    cwd: workspace,
    classes: ['D'],
    scale: 'smoke',
    delegate52Mode: 'live',
    budgetUsd: 1.0,
    maxDomains: 2,
    roundTripsPerDomain: 1,
    runId: 'pass19_artifact_check',
    _llmCaller: async (prompt: string) => ({ output: 'simulated\n', costUsd: 0.001 }),
    now: () => '2026-04-29T20:00:05.000Z',
  });
  assert.ok(report.outDir, 'outDir should be set');
  const artifactPath = join(report.outDir, 'artifacts', 'delegate52-live-result.json');
  assert.equal(existsSync(artifactPath), true, 'live-result.json artifact should exist');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as { microsoftBaselineCorruptionRate: number; corruptionRate: number; totalCostUsd: number };
  assert.equal(artifact.microsoftBaselineCorruptionRate, 0.25);
  assert.ok(artifact.totalCostUsd > 0);
});
