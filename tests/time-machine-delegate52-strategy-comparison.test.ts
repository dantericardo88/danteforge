// Pass 40 — counter-mitigation comparison harness.
// Verifies the substrate-restore-retry strategy produces materially different outcomes
// than prompt-only-retry and no-mitigation against the same LLM behavior. This is the
// load-bearing argument that "the substrate is doing real work, not just retries."

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
 * Sticky-corruption simulator: once the LLM has emitted a corrupted state, every subsequent
 * forward edit also corrupts (because the input it sees is already corrupted).
 * This is the realistic adversary that distinguishes substrate-restore-retry (which sends
 * a CLEAN input on retry) from prompt-only-retry (which sends the corrupted input back).
 */
function makeStickyCorruptor(): (prompt: string) => Promise<{ output: string; costUsd: number }> {
  return async (prompt: string) => {
    const doc = extractDocFromPrompt(prompt);
    if (doc.includes('[corrupted]')) {
      // Once corrupted, stays corrupted — corruption "spreads" with retries on dirty state.
      return { output: doc + ' [more-corruption]', costUsd: 0.001 };
    }
    return { output: doc + ' [corrupted]', costUsd: 0.001 };
  };
}

test('Pass 40 — substrate-restore-retry: clean state on retry → mitigation can succeed', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-substrate-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 1,
      _llmCaller: makeStickyCorruptor(),
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 3, strategy: 'substrate-restore-retry' },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // Substrate restores between retries → each retry sees clean input → corruption is at most one [corrupted] tag deep.
    // Mitigation will fail (LLM still corrupts the clean input each time) but graceful degradation kicks in.
    assert.ok((row.gracefullyDegradedDivergences ?? 0) >= 1, 'substrate strategy gracefully degrades on retry exhaustion');
    // On-disk state should be the clean baseline, NOT the cascaded corruption.
    const docPath = join(report.outDir, 'delegate52-round-trips', 'public-domain-1', 'document.txt');
    const onDisk = readFileSync(docPath, 'utf-8');
    assert.equal(onDisk.includes('[more-corruption]'), false,
      'substrate strategy should never let cascaded corruption reach the workspace');
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 40 — prompt-only-retry: corrupted input fed back → corruption cascades', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-prompt-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 1,
      _llmCaller: makeStickyCorruptor(),
      mitigation: { restoreOnDivergence: false, retriesOnDivergence: 3, strategy: 'prompt-only-retry' },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // No graceful degradation — the substrate's restore behavior is suppressed.
    assert.equal(row.gracefullyDegradedDivergences, 0,
      'prompt-only-retry strategy must NOT trigger substrate-only graceful degradation');
    // The on-disk document should contain cascaded corruption (the substrate didn't intervene).
    const docPath = join(report.outDir, 'delegate52-round-trips', 'public-domain-1', 'document.txt');
    const onDisk = readFileSync(docPath, 'utf-8');
    assert.equal(onDisk.includes('[more-corruption]'), true,
      'prompt-only-retry should leave cascaded corruption visible — that is the contrast we want to publish');
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 40 — no-mitigation: divergence recorded, no retries, no restore', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-none-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 2,
      _llmCaller: makeStickyCorruptor(),
      mitigation: { strategy: 'no-mitigation' },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    assert.equal(row.retryCount, 0, 'no-mitigation must perform 0 retries');
    assert.equal(row.gracefullyDegradedDivergences, 0);
    assert.ok((row.unmitigatedDivergences ?? 0) >= 1);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});
