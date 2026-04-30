// Pass 39 — diff-attribution for D3 (causal-source identification).
// Verifies that computeDiffLocations correctly identifies single-region vs multi-region
// corruption and that the D3 rate aggregates across the live executor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';

import { computeDiffLocations, runTimeMachineValidation } from '../src/core/time-machine-validation.js';

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

test('Pass 39 — computeDiffLocations: identical strings → empty location, clean attribution', () => {
  const loc = computeDiffLocations('hello\nworld\n', 'hello\nworld\n');
  assert.equal(loc.regionCount, 0);
  assert.equal(loc.cleanAttribution, true);
  assert.equal(loc.bytesAdded, 0);
  assert.equal(loc.bytesRemoved, 0);
  assert.equal(loc.firstRegionLineStart, null);
});

test('Pass 39 — single-line append: 1 region, clean attribution', () => {
  const original = 'line1\nline2\nline3\n';
  const corrupted = 'line1\nline2\nline3-corrupted\n';
  const loc = computeDiffLocations(original, corrupted);
  assert.equal(loc.regionCount, 1);
  assert.equal(loc.cleanAttribution, true);
  assert.equal(loc.firstRegionLineStart, 3);
  assert.equal(loc.firstRegionLineEnd, 3);
  assert.equal(loc.bytesAdded, 'line3-corrupted'.length - 'line3'.length);
  assert.equal(loc.bytesRemoved, 0);
});

test('Pass 39 — multi-region corruption: regionCount > 1, clean attribution false', () => {
  const original = 'line1\nline2\nline3\nline4\nline5\n';
  const corrupted = 'lineA\nline2\nline3\nlineX\nline5\n';
  const loc = computeDiffLocations(original, corrupted);
  assert.equal(loc.regionCount, 2);
  assert.equal(loc.cleanAttribution, false);
  // First region is line 1
  assert.equal(loc.firstRegionLineStart, 1);
  assert.equal(loc.firstRegionLineEnd, 1);
});

test('Pass 39 — pure removal: bytesRemoved > 0, bytesAdded = 0', () => {
  const original = 'keep1\nremove\nkeep2\n';
  const corrupted = 'keep1\n\nkeep2\n';
  const loc = computeDiffLocations(original, corrupted);
  assert.equal(loc.regionCount, 1);
  assert.equal(loc.cleanAttribution, true);
  assert.equal(loc.bytesAdded, 0);
  assert.equal(loc.bytesRemoved, 'remove'.length);
});

/** Always-corrupt LLM that produces a clean single-region append. D3 should be 100%. */
function makeSingleRegionCorruptor(): (prompt: string) => Promise<{ output: string; costUsd: number }> {
  return async (prompt: string) => {
    const doc = extractDocFromPrompt(prompt);
    return { output: doc + ' [appended]', costUsd: 0.001 };
  };
}

test('Pass 39 — live D3 metric: single-region corruption → 100% causal source identification', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'd3-single-region-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 2,
      _llmCaller: makeSingleRegionCorruptor(),
      // Mitigation off so all divergences are recorded once each.
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    assert.ok((row.totalDivergences ?? 0) >= 1);
    assert.equal(row.causalSourceIdentifiedCount, row.totalDivergences,
      'every single-region corruption should be cleanly attributed');
    assert.equal(d.causalSourceIdentificationRate, 1.0);
    assert.ok(Array.isArray(row.corruptionLocations));
    assert.ok(row.corruptionLocations!.every(loc => loc.cleanAttribution));
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 39 — clean LLM: D3 rate is 1.0 by convention (no divergences observed)', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'd3-clean-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 2,
      _llmCaller: async (prompt) => ({ output: extractDocFromPrompt(prompt), costUsd: 0.001 }),
    });
    const d = report.classes.D!;
    assert.equal(d.totalDivergencesObserved, 0);
    assert.equal(d.causalSourceIdentificationRate, 1.0);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});
