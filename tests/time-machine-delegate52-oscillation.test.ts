// Pass 36 — mitigation loop hardening: oscillation detection, realistic noisy simulator,
// and graceful-degradation guarantee (workspace ends in last clean state on retry exhaustion).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';

import { runTimeMachineValidation } from '../src/core/time-machine-validation.js';

function extractDocFromPrompt(prompt: string): string {
  const editedIdx = prompt.lastIndexOf('Edited document:\n');
  if (editedIdx !== -1) {
    const start = editedIdx + 'Edited document:\n'.length;
    const refIdx = prompt.indexOf('\n\nReference shape:', start);
    return refIdx === -1 ? prompt.slice(start) : prompt.slice(start, refIdx);
  }
  const docIdx = prompt.lastIndexOf('Document:\n');
  if (docIdx !== -1) return prompt.slice(docIdx + 'Document:\n'.length);
  return '';
}

/**
 * Oscillating LLM: corrupts forward, "uncorrects" backward in a fixed cycle.
 * The corrupted state is identical across retries — the substrate's oscillation detector
 * should catch this and abort the retry loop early.
 */
function makeOscillatingSimulator(): (prompt: string) => Promise<{ output: string; costUsd: number }> {
  return async (prompt: string) => {
    const doc = extractDocFromPrompt(prompt);
    // Forward and backward both produce the same fixed corrupted output.
    return { output: doc + ' [stuck-corruption]', costUsd: 0.001 };
  };
}

/**
 * Realistic noisy LLM: deterministic preserve probability, but the corrupted output varies
 * with a counter so it's NOT detected as oscillation. Tests that the substrate doesn't
 * mistakenly flag genuine retry-success-paths as oscillation.
 */
function makeNoisyNonOscillatingSimulator(preserveProb: number, seed = 0): (prompt: string) => Promise<{ output: string; costUsd: number }> {
  let counter = seed;
  return async (prompt: string) => {
    const doc = extractDocFromPrompt(prompt);
    counter += 1;
    const preserve = (counter % 10) < Math.round(preserveProb * 10);
    const output = preserve ? doc : doc + ` [noise-${counter}]`;
    return { output, costUsd: 0.001 };
  };
}

test('Pass 36 — oscillation detector aborts retries early when LLM emits the same corrupted output', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'osc-detect-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 1,
      _llmCaller: makeOscillatingSimulator(),
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 10 },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // Oscillation detected → retries abort before all 10 are consumed.
    assert.ok((row.oscillatedDivergences ?? 0) >= 1, 'oscillation should be detected');
    // Retry count should be small (oscillation aborts after 1 repeat detection), much less than 10.
    assert.ok((row.retryCount ?? 0) <= 2, `retries should abort early on oscillation; got ${row.retryCount}`);
    // Graceful degradation: workspace restored to clean state.
    assert.ok((row.gracefullyDegradedDivergences ?? 0) >= 1);
    assert.equal(d.totalOscillatedDivergences, 1);
    assert.equal(d.totalGracefullyDegradedDivergences, 1);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 36 — noisy non-oscillating LLM does NOT trigger oscillation detector falsely', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'osc-noisy-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 10,
      maxDomains: 1,
      roundTripsPerDomain: 3,
      _llmCaller: makeNoisyNonOscillatingSimulator(0.5),
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 5 },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // Noisy non-oscillating: each retry produces a different corrupted hash, so the cycle detector
    // does NOT abort early. Mitigation should succeed via retry budget.
    assert.equal(row.oscillatedDivergences, 0, 'noisy LLM should NOT be flagged as oscillating');
    // Either mitigated all divergences, or some genuinely escaped retry budget.
    assert.equal(row.unmitigatedDivergences, (row.gracefullyDegradedDivergences ?? 0));
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 36 — graceful degradation: on retry exhaustion, workspace ends in last clean state', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'graceful-degradation-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 10,
      maxDomains: 1,
      roundTripsPerDomain: 2,
      _llmCaller: makeOscillatingSimulator(), // always corrupts the same way → oscillation → graceful-degrade
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 3 },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // After mitigation gives up, workspace state is restored. The on-disk document
    // for this domain should equal the original (last clean baseline).
    const outDir = report.outDir;
    const docPath = join(outDir, 'delegate52-round-trips', 'public-domain-1', 'document.txt');
    const restored = readFileSync(docPath, 'utf-8');
    assert.equal(restored.includes('[stuck-corruption]'), false,
      'workspace should NOT contain corrupted state after graceful degradation');
    assert.ok((row.gracefullyDegradedDivergences ?? 0) >= 1);
    // userObservedCorruption tracks final document bytes. The LLM failed, but the substrate
    // restored the document before the user can observe corrupted content.
    assert.equal(d.userObservedCorruptionRate, 0.0);
    assert.equal(d.rawCorruptionRate, 1.0);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 36 — clean LLM with mitigation: no oscillation, no graceful degradation, no retries', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'clean-mit-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 2,
      _llmCaller: makeNoisyNonOscillatingSimulator(1.0),
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 3 },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    assert.equal(row.retryCount, 0);
    assert.equal(row.oscillatedDivergences, 0);
    assert.equal(row.gracefullyDegradedDivergences, 0);
    assert.equal(d.totalOscillatedDivergences, 0);
    assert.equal(d.totalGracefullyDegradedDivergences, 0);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});
