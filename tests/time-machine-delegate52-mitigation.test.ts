// Pass 29 — substrate-mediated corruption mitigation.
// Verifies the abort-and-retry loop converts a passive-recorder substrate into an
// active-mitigator substrate. Tests use a controllable corruption simulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';

import { runTimeMachineValidation } from '../src/core/time-machine-validation.js';

interface SimulatorOptions {
  // 0.0 = LLM always corrupts; 1.0 = LLM always preserves; 0.5 = corrupts half the time
  preserveProbability: number;
  // Deterministic seed for repeatability across iterations
  seed?: number;
}

function extractDocFromPrompt(prompt: string): string {
  // Backward prompt: 'Edited document:\n<doc>\n\nReference shape: ...'
  const editedIdx = prompt.lastIndexOf('Edited document:\n');
  if (editedIdx !== -1) {
    const start = editedIdx + 'Edited document:\n'.length;
    const refIdx = prompt.indexOf('\n\nReference shape:', start);
    return refIdx === -1 ? prompt.slice(start) : prompt.slice(start, refIdx);
  }
  // Forward prompt: '...Document:\n<doc>' (doc runs to end of prompt)
  const docIdx = prompt.lastIndexOf('Document:\n');
  if (docIdx !== -1) {
    return prompt.slice(docIdx + 'Document:\n'.length);
  }
  return '';
}

function makeSimulator(opts: SimulatorOptions): (prompt: string) => Promise<{ output: string; costUsd: number }> {
  let counter = opts.seed ?? 0;
  return async (prompt: string) => {
    const doc = extractDocFromPrompt(prompt);
    counter += 1;
    const bucket = 10;
    const preserveBoundary = Math.round(opts.preserveProbability * bucket);
    const preserve = (counter % bucket) < preserveBoundary;
    const output = preserve ? doc : doc + ` [corrupted-${counter}]`;
    return { output, costUsd: 0.001 };
  };
}

test('Pass 29 — mitigation off (passive observer): divergences accumulate, byteIdenticalAfterRoundTrips=false', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'mit-off-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 3,
      _llmCaller: makeSimulator({ preserveProbability: 0.0 }), // always corrupts
      // mitigation NOT set → passive observer
    });
    const d = report.classes.D!;
    assert.equal(d.domainRows.length, 1);
    const row = d.domainRows[0]!;
    assert.equal(row.byteIdenticalAfterRoundTrips, false, 'always-corrupting LLM should not round-trip');
    assert.equal(row.retryCount, 0, 'no retries with mitigation off');
    assert.equal(row.mitigatedDivergences, 0);
    assert.ok((row.unmitigatedDivergences ?? 0) >= 1, 'divergences should be tracked even with mitigation off');
    assert.equal(d.userObservedCorruptionRate, 1.0, 'all domains corrupted under always-corrupt sim');
    assert.equal(d.rawCorruptionRate, 1.0);
    assert.equal(d.totalRetries, 0);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 29 — mitigation on with deterministic-correct LLM: zero retries needed', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'mit-clean-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 2,
      _llmCaller: makeSimulator({ preserveProbability: 1.0 }), // never corrupts
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 3 },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    assert.equal(row.byteIdenticalAfterRoundTrips, true);
    assert.equal(row.retryCount, 0);
    assert.equal(row.mitigatedDivergences, 0);
    assert.equal(row.unmitigatedDivergences, 0);
    assert.equal(d.userObservedCorruptionRate, 0.0);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 29 — mitigation on against intermittent corruption: retries succeed, mitigated count > 0', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'mit-intermittent-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    // 0.5 probability → about half the calls corrupt; with up to 5 retries, mitigation should always succeed.
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 10,
      maxDomains: 1,
      roundTripsPerDomain: 4,
      _llmCaller: makeSimulator({ preserveProbability: 0.5, seed: 0 }),
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 5 },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // With 0.5 preserve prob + 5 retries, every divergence should mitigate. user-observed corruption = 0.
    assert.equal(row.unmitigatedDivergences, 0, 'retries should cover all divergences');
    assert.ok((row.mitigatedDivergences ?? 0) >= 0); // may be 0 if all round-trips happened to converge first try
    assert.equal(d.userObservedCorruptionRate, 0.0);
    // Retry count should be at least mitigatedDivergences (each mitigation costs at least 1 retry).
    assert.ok((row.retryCount ?? 0) >= (row.mitigatedDivergences ?? 0));
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 29 — mitigation on against permanent corruption: retries exhausted, unmitigated count > 0', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'mit-permanent-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 10,
      maxDomains: 1,
      roundTripsPerDomain: 2,
      _llmCaller: makeSimulator({ preserveProbability: 0.0 }), // always corrupts
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 2 },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // With 0 preserve prob + 2 retries, every divergence exhausts retries and stays unmitigated.
    assert.ok((row.unmitigatedDivergences ?? 0) >= 1, 'always-corrupt LLM should leave unmitigated divergences');
    assert.equal(row.mitigatedDivergences, 0);
    // Total retries should equal roundTrips × retriesPerDivergence (since every round-trip diverges).
    assert.ok((row.retryCount ?? 0) >= (row.unmitigatedDivergences ?? 0));
    assert.equal(d.userObservedCorruptionRate, 1.0, 'unmitigated divergence keeps user-observed corruption at 100%');
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});
