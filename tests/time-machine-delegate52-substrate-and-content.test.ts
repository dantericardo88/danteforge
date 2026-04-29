// Pass 23 remediation — F-001 + F-002.
// Verifies that DELEGATE-52 round-trips engage the Time Machine substrate per-edit
// AND consume real document content from imported rows when available.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';

import { runTimeMachineValidation } from '../src/core/time-machine-validation.js';

function fixedDryRunCaller(): (prompt: string) => Promise<{ output: string; costUsd: number }> {
  return async (prompt: string) => {
    const idx = prompt.lastIndexOf('Document:');
    const idx2 = prompt.lastIndexOf('Edited document:');
    const start = Math.max(idx, idx2);
    const doc = start === -1 ? '' : prompt.slice(start + (idx2 > idx ? 'Edited document:'.length : 'Document:'.length)).split('\n\n')[0]!.trim();
    return { output: doc, costUsd: 0 };
  };
}

test('F-001 — DELEGATE-52 round-trips engage Time Machine substrate per-edit', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'd52-substrate-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 2,
      roundTripsPerDomain: 2,
      _llmCaller: fixedDryRunCaller(),
    });
    const d = report.classes.D!;
    assert.equal(d.status, 'live_completed');
    assert.equal(d.domainRows.length, 2);

    for (const row of d.domainRows) {
      // Every domain has 1 baseline commit + 2 round-trips × 2 edits = 5 commits minimum.
      assert.ok(row.timeMachineCommitIds, `domain ${row.domain} missing commit ids`);
      assert.ok(row.timeMachineCommitIds!.length >= 5, `domain ${row.domain}: ${row.timeMachineCommitIds!.length} commits, expected >= 5`);
      // Every commit id matches the Time Machine commit ID format.
      for (const id of row.timeMachineCommitIds!) {
        assert.match(id, /^tm_[0-9a-f]{24}$/, `bad commit id format: ${id}`);
      }
    }

    // Per-domain workspace exists with .danteforge/time-machine populated.
    const roundTripDir = join(report.outDir, 'delegate52-round-trips');
    const subdirs = readdirSync(roundTripDir, { withFileTypes: true }).filter(e => e.isDirectory());
    assert.equal(subdirs.length, 2);
    for (const dir of subdirs) {
      const tmRoot = join(roundTripDir, dir.name, '.danteforge', 'time-machine', 'commits');
      const commitFiles = readdirSync(tmRoot);
      assert.ok(commitFiles.length >= 5, `domain ${dir.name}: ${commitFiles.length} commit files on disk`);
    }
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('F-002 — imported dataset rows feed real document content (not synthetic stub)', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'd52-content-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    // Build a synthetic JSONL that mimics the public release schema.
    const datasetPath = join(ws, 'mini-dataset.jsonl');
    mkdirSync(ws, { recursive: true });
    const realDoc = '## Real document for accounting domain\n\nLine A.\nLine B.\nLine C.\nLine D.\nLine E.\nLine F.\nLine G.\nLine H.\n';
    const rows = [
      {
        sample_id: 'row-1',
        sample_type: 'accounting',
        sample_name: 'r1',
        states: [{ state_id: 's1', context: '', solution_folder: '', prompts: [] }],
        metadata: {},
        files: { 'basic_state/ledger.txt': realDoc, 'distractor_context/note.md': '# distractor\n' },
      },
      {
        sample_id: 'row-2',
        sample_type: 'circuit',
        sample_name: 'r2',
        states: [{ state_id: 's2', context: '', solution_folder: '', prompts: [] }],
        metadata: {},
        files: { 'basic_state/sch.txt': '## Circuit schematic\n\nResistor R1.\nCapacitor C1.\n' },
      },
    ];
    writeFileSync(datasetPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');

    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 2,
      roundTripsPerDomain: 1,
      delegate52Dataset: datasetPath,
      _llmCaller: fixedDryRunCaller(),
    });
    const d = report.classes.D!;
    assert.equal(d.domainRows.length, 2);
    for (const row of d.domainRows) {
      assert.equal(row.documentSource, 'imported',
        `domain ${row.domain} fell through to synthetic stub even though dataset was provided`);
    }
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('F-002 — synthetic fallback when no dataset provided', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'd52-synthetic-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 1,
      _llmCaller: fixedDryRunCaller(),
    });
    const d = report.classes.D!;
    assert.equal(d.domainRows[0]!.documentSource, 'synthetic');
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});
