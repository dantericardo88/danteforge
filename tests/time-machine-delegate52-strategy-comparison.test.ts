// Pass 40 — counter-mitigation comparison harness.
// Verifies the substrate-restore-retry strategy produces materially different outcomes
// than prompt-only-retry and no-mitigation against the same LLM behavior. This is the
// load-bearing argument that "the substrate is doing real work, not just retries."

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Pass 45 — smart-retry: diff-guided feedback hint causes LLM to restore correctly on retry.
 * The mock simulates an LLM that "learns" from the feedback hint: on the first backward attempt
 * it corrupts; on retry it sees "Feedback from previous attempt(s)" and restores cleanly.
 * This proves the hint is actually reaching the LLM call and influencing the output.
 */
function makeFeedbackResponsiveCorruptor(): { caller: (prompt: string) => Promise<{ output: string; costUsd: number }>; hintsSeen: string[] } {
  const hintsSeen: string[] = [];
  const caller = async (prompt: string): Promise<{ output: string; costUsd: number }> => {
    const editedIdx = prompt.lastIndexOf('Edited document:\n');
    const docIdx = prompt.lastIndexOf('Document:\n');
    let doc: string;
    if (editedIdx !== -1) {
      const start = editedIdx + 'Edited document:\n'.length;
      const refIdx = prompt.indexOf('\n\nReference shape:', start);
      doc = refIdx === -1 ? prompt.slice(start) : prompt.slice(start, refIdx);
    } else {
      doc = prompt.slice(docIdx + 'Document:\n'.length);
    }
    if (prompt.includes('Feedback from previous attempt(s)')) {
      // Record the hint block so the test can assert it was non-empty.
      const hintStart = prompt.indexOf('Feedback from previous attempt(s)');
      const hintEnd = prompt.indexOf('\n\nEdited document:', hintStart);
      hintsSeen.push(hintEnd === -1 ? prompt.slice(hintStart) : prompt.slice(hintStart, hintEnd));
      // LLM "understands" the feedback and strips the corruption it introduced.
      return { output: doc.replace(/ \[corrupted\]/g, ''), costUsd: 0.001 };
    }
    if (editedIdx === -1) {
      // Forward prompt: introduce corruption tag.
      return { output: doc + ' [corrupted]', costUsd: 0.001 };
    }
    // First backward attempt (no hint yet): fail to restore.
    return { output: doc + ' [missed-restore]', costUsd: 0.001 };
  };
  return { caller, hintsSeen };
}

test('Pass 45 — smart-retry: feedback hint reaches LLM and enables successful recovery', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-smart-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const { caller, hintsSeen } = makeFeedbackResponsiveCorruptor();
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 1,
      _llmCaller: caller,
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 2, strategy: 'smart-retry' },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // Smart-retry should have succeeded where naive retry would fail.
    assert.ok((row.mitigatedDivergences ?? 0) >= 1, 'smart-retry must report at least one mitigated divergence');
    assert.equal(row.unmitigatedDivergences, 0, 'smart-retry should fully recover — no unmitigated divergences');
    assert.ok((row.retryCount ?? 0) >= 1, 'smart-retry must have consumed at least one retry attempt');
    // The feedback hint must have been sent to the LLM on the retry.
    assert.ok(hintsSeen.length >= 1, 'feedback hint must have been passed to the LLM caller');
    assert.ok(hintsSeen[0]!.includes('Lines that drifted') || hintsSeen[0]!.includes('Length differs'),
      'hint must contain structural diff info (line ranges or length delta)');
    // Pass 45 upgrade: hint must include exact original line content, not just line numbers.
    assert.ok(hintsSeen[0]!.includes('line ') && hintsSeen[0]!.includes(':'),
      'hint must include original content of drifted lines (e.g. "  line 1: <content>") — substrate has the committed clean state');
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 45 — smart-retry vs substrate-restore-retry: same recovery rate when LLM is hint-unresponsive (identical behavior)', async () => {
  // When the LLM ignores the hint (sticky corruptor), smart-retry falls back to the same
  // graceful-degradation path as substrate-restore-retry — the hint adds no harm.
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-smart-fallback-'));
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
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 2, strategy: 'smart-retry' },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    // LLM ignores hint → same graceful-degradation outcome as substrate-restore-retry.
    assert.ok((row.gracefullyDegradedDivergences ?? 0) >= 1, 'smart-retry must gracefully degrade when LLM ignores hint');
    const docPath = join(report.outDir, 'delegate52-round-trips', 'public-domain-1', 'document.txt');
    const onDisk = readFileSync(docPath, 'utf-8');
    assert.equal(onDisk.includes('[more-corruption]'), false,
      'smart-retry must protect workspace from cascaded corruption even when hint is ignored');
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 47 — dataset inverse prompt is threaded into the backward edit prompt', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-inverse-prompt-'));
  process.env.DANTEFORGE_DELEGATE52_LIVE = '1';
  try {
    const datasetPath = join(ws, 'delegate52.jsonl');
    const original = '2024/01/01 Test Payee\n  Assets:Cash  $202.00\n  Income:Test\n';
    const row = {
      sample_type: 'accounting',
      sample_id: 'mini-accounting',
      sample_name: 'Mini Accounting',
      files: { 'basic_state/accounting.ledger': original },
      states: [
        {
          state_id: 'basic_state',
          context: ['accounting.ledger'],
          solution_folder: 'basic_state',
          prompts: [
            {
              prompt_id: 'basic_to_eur',
              target_state: 'eur_state',
              prompt: 'convert all dollar amounts to euros using a rate of 0.89 and add a conversion note',
            },
          ],
        },
        {
          state_id: 'eur_state',
          context: ['accounting.ledger'],
          prompts: [
            {
              prompt_id: 'eur_to_basic',
              target_state: 'basic_state',
              prompt: 'convert all euro amounts back to USD using the exact original cents and remove the conversion note',
            },
          ],
        },
      ],
    };
    writeFileSync(datasetPath, `${JSON.stringify(row)}\n`, 'utf8');

    let backwardPrompt = '';
    const report = await runTimeMachineValidation({
      cwd: ws,
      classes: ['D'],
      delegate52Mode: 'live',
      delegate52Dataset: datasetPath,
      budgetUsd: 5,
      maxDomains: 1,
      roundTripsPerDomain: 1,
      _llmCaller: async (prompt: string) => {
        if (prompt.includes('Document:\n')) {
          return {
            output: '; Converted at 0.89\n2024/01/01 Test Payee\n  Assets:Cash  €179.78\n  Income:Test\n',
            costUsd: 0.001,
          };
        }
        backwardPrompt = prompt;
        if (prompt.includes('convert all euro amounts back to USD using the exact original cents')) {
          return { output: original, costUsd: 0.001 };
        }
        return { output: original.replace('$202.00', '$201.99'), costUsd: 0.001 };
      },
    });

    const rowResult = report.classes.D!.domainRows[0]!;
    assert.equal(rowResult.byteIdenticalAfterRoundTrips, true);
    assert.match(backwardPrompt, /convert all euro amounts back to USD using the exact original cents/);
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 47 — graceful degradation is clean to the user even when LLM retries exhaust', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-graceful-metric-'));
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
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 1, strategy: 'substrate-restore-retry' },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    assert.equal(row.byteIdenticalAfterRoundTrips, true, 'substrate should restore the final workspace to clean state');
    assert.ok((row.unmitigatedDivergences ?? 0) >= 1, 'LLM self-recovery failure should still be counted');
    assert.equal(d.userObservedCorruptionRate, 0.0, 'clean restored final documents are not user-visible corruption');
    assert.equal(d.rawCorruptionRate, 1.0, 'raw LLM divergence is still visible in the raw metric');
  } finally {
    delete process.env.DANTEFORGE_DELEGATE52_LIVE;
    await rm(ws, { recursive: true, force: true });
  }
});

test('Pass 47 — surgical-patch restores exact clean state without extra LLM retries', async () => {
  const ws = mkdtempSync(resolve(tmpdir(), 'strat-surgical-patch-'));
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
      mitigation: { restoreOnDivergence: true, retriesOnDivergence: 3, strategy: 'surgical-patch' },
    });
    const d = report.classes.D!;
    const row = d.domainRows[0]!;
    assert.equal(row.byteIdenticalAfterRoundTrips, true);
    assert.equal(row.retryCount, 0, 'surgical patch should use the substrate instead of spending retry calls');
    assert.equal(row.mitigatedDivergences, 1, 'deterministic substrate repair is a mitigated divergence');
    assert.equal(row.unmitigatedDivergences, 0);
    assert.equal(d.userObservedCorruptionRate, 0.0);
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
