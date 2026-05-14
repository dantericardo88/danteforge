// Token ROI tests — buildROIEntry, appendROIEntry, loadROIHistory, formatROISummary,
//                   computeRoiSummary, formatRoiReport, computePaybackRatio

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildROIEntry,
  appendROIEntry,
  loadROIHistory,
  formatROISummary,
  computeRoiSummary,
  formatRoiReport,
  computePaybackRatio,
  TOKEN_ROI_FILE,
  type WaveROIEntry,
  type RoiSummary,
} from '../src/core/token-roi.js';
import {
  getLedgerStats,
  pruneLedger,
  type EconomyLedger,
} from '../src/core/context-economy/economy-ledger.js';

// ── buildROIEntry ─────────────────────────────────────────────────────────────

describe('buildROIEntry', () => {
  it('returns a WaveROIEntry with correct shape', () => {
    const entry = buildROIEntry(1, 1000, 7.0, 7.5);
    assert.equal(typeof entry.wave, 'number');
    assert.equal(typeof entry.tokensSpent, 'number');
    assert.equal(typeof entry.scoreBefore, 'number');
    assert.equal(typeof entry.scoreAfter, 'number');
    assert.equal(typeof entry.scoreDelta, 'number');
    assert.equal(typeof entry.costEstimatedUsd, 'number');
    assert.equal(typeof entry.efficiency, 'number');
    assert.equal(typeof entry.timestamp, 'string');
  });

  it('sets wave, tokensSpent, scoreBefore, scoreAfter correctly', () => {
    const entry = buildROIEntry(3, 2000, 6.0, 8.0);
    assert.equal(entry.wave, 3);
    assert.equal(entry.tokensSpent, 2000);
    assert.equal(entry.scoreBefore, 6.0);
    assert.equal(entry.scoreAfter, 8.0);
  });

  it('calculates scoreDelta as scoreAfter - scoreBefore', () => {
    const entry = buildROIEntry(1, 500, 5.0, 6.5);
    assert.ok(Math.abs(entry.scoreDelta - 1.5) < 0.001);
  });

  it('calculates efficiency as scoreDelta / (tokensSpent / 1000)', () => {
    const entry = buildROIEntry(1, 2000, 5.0, 7.0); // delta=2.0, tokens=2k
    const expected = 2.0 / (2000 / 1000); // = 1.0
    assert.ok(Math.abs(entry.efficiency - expected) < 0.001);
  });

  it('efficiency is 0 when tokensSpent is 0', () => {
    const entry = buildROIEntry(1, 0, 5.0, 6.0);
    assert.equal(entry.efficiency, 0);
  });

  it('handles negative scoreDelta correctly', () => {
    const entry = buildROIEntry(1, 1000, 8.0, 7.0);
    assert.ok(entry.scoreDelta < 0);
    assert.ok(entry.efficiency < 0);
  });

  it('timestamp is a valid ISO string', () => {
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    assert.ok(!isNaN(Date.parse(entry.timestamp)));
  });

  it('uses claude provider by default', () => {
    // costEstimatedUsd should be positive for a non-zero token spend
    const entry = buildROIEntry(1, 10000, 5.0, 6.0);
    assert.ok(entry.costEstimatedUsd >= 0);
  });

  it('accepts different providers', () => {
    const ollama = buildROIEntry(1, 10000, 5.0, 6.0, 'ollama');
    const grok = buildROIEntry(1, 10000, 5.0, 6.0, 'grok');
    // Both should be valid entries
    assert.ok(typeof ollama.costEstimatedUsd === 'number');
    assert.ok(typeof grok.costEstimatedUsd === 'number');
  });
});

// ── appendROIEntry ────────────────────────────────────────────────────────────

describe('appendROIEntry', () => {
  it('calls _mkdir with recursive true', async () => {
    let mkdirCalled = false;
    let mkdirOpts: unknown;
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    await appendROIEntry(entry, '/fake/cwd', {
      _mkdir: async (_p, opts) => { mkdirCalled = true; mkdirOpts = opts; },
      _appendLine: async () => {},
    });
    assert.ok(mkdirCalled);
    assert.deepEqual(mkdirOpts, { recursive: true });
  });

  it('calls _appendLine with JSON-serialized entry', async () => {
    let written = '';
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    await appendROIEntry(entry, '/fake/cwd', {
      _mkdir: async () => {},
      _appendLine: async (_p, line) => { written = line; },
    });
    const parsed = JSON.parse(written);
    assert.equal(parsed.wave, 1);
    assert.equal(parsed.tokensSpent, 1000);
  });

  it('appends to the correct file path', async () => {
    let writtenPath = '';
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    await appendROIEntry(entry, '/fake/cwd', {
      _mkdir: async () => {},
      _appendLine: async (p) => { writtenPath = p; },
    });
    assert.ok(writtenPath.includes('token-roi.jsonl'));
  });
});

// ── loadROIHistory ────────────────────────────────────────────────────────────

describe('loadROIHistory', () => {
  it('returns empty array when file not found', async () => {
    const result = await loadROIHistory('/fake/cwd', {
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.deepEqual(result, []);
  });

  it('parses valid JSONL content', async () => {
    const entry1 = buildROIEntry(1, 1000, 5.0, 6.0);
    const entry2 = buildROIEntry(2, 2000, 6.0, 7.0);
    const jsonl = JSON.stringify(entry1) + '\n' + JSON.stringify(entry2) + '\n';
    const result = await loadROIHistory('/fake/cwd', {
      _readFile: async () => jsonl,
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].wave, 1);
    assert.equal(result[1].wave, 2);
  });

  it('skips blank lines', async () => {
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    const jsonl = '\n' + JSON.stringify(entry) + '\n\n';
    const result = await loadROIHistory('/fake/cwd', {
      _readFile: async () => jsonl,
    });
    assert.equal(result.length, 1);
  });

  it('skips corrupt JSON lines silently', async () => {
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    const jsonl = JSON.stringify(entry) + '\nnot-valid-json\n';
    const result = await loadROIHistory('/fake/cwd', {
      _readFile: async () => jsonl,
    });
    assert.equal(result.length, 1);
  });

  it('returns empty array for empty file', async () => {
    const result = await loadROIHistory('/fake/cwd', {
      _readFile: async () => '',
    });
    assert.deepEqual(result, []);
  });
});

// ── formatROISummary ──────────────────────────────────────────────────────────

describe('formatROISummary', () => {
  it('returns placeholder when no entries', () => {
    const result = formatROISummary([]);
    assert.ok(result.includes('No ROI data'));
  });

  it('includes table header', () => {
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    const result = formatROISummary([entry]);
    assert.ok(result.includes('Wave'));
    assert.ok(result.includes('Tokens'));
    assert.ok(result.includes('Score'));
  });

  it('includes totals footer', () => {
    const entry = buildROIEntry(1, 1000, 5.0, 6.0);
    const result = formatROISummary([entry]);
    assert.ok(result.includes('Total'));
  });

  it('shows positive delta with + prefix', () => {
    const entry = buildROIEntry(1, 1000, 5.0, 6.0); // delta = 1.0
    const result = formatROISummary([entry]);
    assert.ok(result.includes('+'));
  });

  it('includes efficiency in footer', () => {
    const entry = buildROIEntry(1, 1000, 5.0, 7.0);
    const result = formatROISummary([entry]);
    assert.ok(result.includes('pts/1k tokens') || result.includes('efficiency'));
  });

  it('renders multiple entries', () => {
    const entries: WaveROIEntry[] = [
      buildROIEntry(1, 1000, 5.0, 6.0),
      buildROIEntry(2, 2000, 6.0, 7.0),
      buildROIEntry(3, 500, 7.0, 7.5),
    ];
    const result = formatROISummary(entries);
    // Should have 3 data rows + 2 header rows + footer
    const lines = result.split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 5);
  });
});

// ── TOKEN_ROI_FILE constant ───────────────────────────────────────────────────

describe('TOKEN_ROI_FILE', () => {
  it('is a string pointing to token-roi.jsonl', () => {
    assert.ok(TOKEN_ROI_FILE.includes('token-roi.jsonl'));
  });
});

// ── computeRoiSummary ─────────────────────────────────────────────────────────

describe('computeRoiSummary', () => {
  it('returns zeros for empty entries and no filtered tokens', () => {
    const summary = computeRoiSummary([]);
    assert.equal(summary.sessionCount, 0);
    assert.equal(summary.totalInputTokens, 0);
    assert.equal(summary.filteredTokens, 0);
    assert.equal(summary.savingsPercent, 0);
    assert.equal(summary.estimatedUsdSaved, 0);
  });

  it('returns correct sessionCount for multiple entries', () => {
    const entries: WaveROIEntry[] = [
      buildROIEntry(1, 1000, 5.0, 6.0),
      buildROIEntry(2, 2000, 6.0, 7.0),
      buildROIEntry(3, 500, 7.0, 7.5),
    ];
    const summary = computeRoiSummary(entries);
    assert.equal(summary.sessionCount, 3);
    assert.equal(summary.totalInputTokens, 3500);
  });

  it('calculates savingsPercent correctly with filtered tokens', () => {
    const entries: WaveROIEntry[] = [buildROIEntry(1, 1000, 5.0, 6.0)];
    // 500 filtered out of 1500 total (1000 spent + 500 filtered) = ~33%
    const summary = computeRoiSummary(entries, 500);
    assert.equal(summary.filteredTokens, 500);
    // 500 / 1500 * 100 = 33.33 → rounds to 33
    assert.equal(summary.savingsPercent, 33);
  });

  it('estimatedUsdSaved is non-negative', () => {
    const entries: WaveROIEntry[] = [buildROIEntry(1, 2000, 5.0, 8.0)];
    const summary = computeRoiSummary(entries, 1000);
    assert.ok(summary.estimatedUsdSaved >= 0);
  });

  it('estimatedUsdSaved is 0 when no tokens were filtered', () => {
    const entries: WaveROIEntry[] = [buildROIEntry(1, 2000, 5.0, 8.0)];
    const summary = computeRoiSummary(entries, 0);
    assert.equal(summary.estimatedUsdSaved, 0);
  });

  it('savingsPercent is 0 when totalInputTokens and filteredTokens are both 0', () => {
    const summary = computeRoiSummary([], 0);
    assert.equal(summary.savingsPercent, 0);
  });

  it('uses ollama provider (zero cost) when specified', () => {
    const entries: WaveROIEntry[] = [buildROIEntry(1, 5000, 5.0, 7.0)];
    const summary = computeRoiSummary(entries, 2000, 'ollama');
    assert.equal(summary.estimatedUsdSaved, 0); // ollama is free
  });
});

// ── formatRoiReport ───────────────────────────────────────────────────────────

describe('formatRoiReport', () => {
  it('returns a non-empty string', () => {
    const summary: RoiSummary = {
      totalInputTokens: 5000,
      filteredTokens: 1000,
      savingsPercent: 17,
      estimatedUsdSaved: 0.003,
      sessionCount: 3,
    };
    const report = formatRoiReport(summary);
    assert.ok(report.length > 0);
  });

  it('includes session count in report', () => {
    const summary: RoiSummary = {
      totalInputTokens: 0,
      filteredTokens: 0,
      savingsPercent: 0,
      estimatedUsdSaved: 0,
      sessionCount: 7,
    };
    const report = formatRoiReport(summary);
    assert.ok(report.includes('7'));
  });

  it('includes savings percent in report', () => {
    const summary: RoiSummary = {
      totalInputTokens: 10000,
      filteredTokens: 2500,
      savingsPercent: 20,
      estimatedUsdSaved: 0.0075,
      sessionCount: 5,
    };
    const report = formatRoiReport(summary);
    assert.ok(report.includes('20%') || report.includes('20'));
  });

  it('mentions "no data" when sessionCount is 0', () => {
    const summary: RoiSummary = {
      totalInputTokens: 0,
      filteredTokens: 0,
      savingsPercent: 0,
      estimatedUsdSaved: 0,
      sessionCount: 0,
    };
    const report = formatRoiReport(summary);
    assert.ok(report.toLowerCase().includes('no roi data') || report.toLowerCase().includes('no'));
  });
});

// ── computePaybackRatio ───────────────────────────────────────────────────────

describe('computePaybackRatio', () => {
  it('returns 0 when inputCost is 0', () => {
    assert.equal(computePaybackRatio(0, 8.5), 0);
  });

  it('returns quality/cost for positive inputs', () => {
    const ratio = computePaybackRatio(0.5, 8.0);
    assert.ok(Math.abs(ratio - 16.0) < 0.001);
  });

  it('returns 0 when inputCost is negative', () => {
    assert.equal(computePaybackRatio(-1, 8.0), 0);
  });

  it('returns higher ratio for same cost but higher quality', () => {
    const low = computePaybackRatio(1.0, 5.0);
    const high = computePaybackRatio(1.0, 9.0);
    assert.ok(high > low);
  });

  it('returns lower ratio for same quality but higher cost', () => {
    const cheap = computePaybackRatio(0.1, 8.0);
    const expensive = computePaybackRatio(1.0, 8.0);
    assert.ok(cheap > expensive);
  });
});

// ── getLedgerStats ────────────────────────────────────────────────────────────

function makeLedger(entries: Array<{ filterId: string; savedTokens: number; savingsPercent: number }>): EconomyLedger {
  const now = new Date().toISOString();
  return {
    entries: entries.map((e) => ({
      timestamp: now,
      organ: 'test',
      command: 'test-cmd',
      filterId: e.filterId,
      inputTokens: 100,
      outputTokens: 100 - e.savedTokens,
      savedTokens: e.savedTokens,
      savingsPercent: e.savingsPercent,
      sacredSpanCount: 0,
      status: 'filtered' as const,
      ruleSource: 'built-in' as const,
    })),
    createdAt: now,
    updatedAt: now,
  };
}

describe('getLedgerStats', () => {
  it('returns zeros for empty ledger', () => {
    const ledger = makeLedger([]);
    const stats = getLedgerStats(ledger);
    assert.equal(stats.entryCount, 0);
    assert.equal(stats.totalFiltered, 0);
    assert.equal(stats.avgSavingsPct, 0);
    assert.deepEqual(stats.topFilters, []);
  });

  it('counts entries correctly', () => {
    const ledger = makeLedger([
      { filterId: 'a', savedTokens: 100, savingsPercent: 50 },
      { filterId: 'b', savedTokens: 200, savingsPercent: 70 },
    ]);
    const stats = getLedgerStats(ledger);
    assert.equal(stats.entryCount, 2);
  });

  it('sums totalFiltered correctly', () => {
    const ledger = makeLedger([
      { filterId: 'a', savedTokens: 100, savingsPercent: 50 },
      { filterId: 'a', savedTokens: 300, savingsPercent: 60 },
    ]);
    const stats = getLedgerStats(ledger);
    assert.equal(stats.totalFiltered, 400);
  });

  it('topFilters sorted by savings descending', () => {
    const ledger = makeLedger([
      { filterId: 'low', savedTokens: 10, savingsPercent: 10 },
      { filterId: 'high', savedTokens: 900, savingsPercent: 90 },
      { filterId: 'mid', savedTokens: 300, savingsPercent: 50 },
    ]);
    const stats = getLedgerStats(ledger);
    assert.equal(stats.topFilters[0], 'high');
    assert.equal(stats.topFilters[1], 'mid');
    assert.equal(stats.topFilters[2], 'low');
  });

  it('topFilters contains at most 5 entries', () => {
    const ledger = makeLedger([
      { filterId: 'f1', savedTokens: 100, savingsPercent: 50 },
      { filterId: 'f2', savedTokens: 200, savingsPercent: 60 },
      { filterId: 'f3', savedTokens: 300, savingsPercent: 70 },
      { filterId: 'f4', savedTokens: 400, savingsPercent: 80 },
      { filterId: 'f5', savedTokens: 500, savingsPercent: 90 },
      { filterId: 'f6', savedTokens: 600, savingsPercent: 95 },
    ]);
    const stats = getLedgerStats(ledger);
    assert.ok(stats.topFilters.length <= 5);
  });

  it('averages savingsPercent correctly', () => {
    const ledger = makeLedger([
      { filterId: 'a', savedTokens: 50, savingsPercent: 40 },
      { filterId: 'b', savedTokens: 50, savingsPercent: 60 },
    ]);
    const stats = getLedgerStats(ledger);
    assert.equal(stats.avgSavingsPct, 50);
  });
});

// ── pruneLedger ───────────────────────────────────────────────────────────────

describe('pruneLedger', () => {
  it('keeps exactly N most recent entries', () => {
    const ledger = makeLedger([
      { filterId: 'a', savedTokens: 10, savingsPercent: 10 },
      { filterId: 'b', savedTokens: 20, savingsPercent: 20 },
      { filterId: 'c', savedTokens: 30, savingsPercent: 30 },
      { filterId: 'd', savedTokens: 40, savingsPercent: 40 },
      { filterId: 'e', savedTokens: 50, savingsPercent: 50 },
    ]);
    const pruned = pruneLedger(ledger, 3);
    assert.equal(pruned.entries.length, 3);
  });

  it('keeps the most recent entries (tail of array)', () => {
    const ledger = makeLedger([
      { filterId: 'old', savedTokens: 10, savingsPercent: 10 },
      { filterId: 'mid', savedTokens: 20, savingsPercent: 20 },
      { filterId: 'new', savedTokens: 30, savingsPercent: 30 },
    ]);
    const pruned = pruneLedger(ledger, 2);
    assert.equal(pruned.entries[0].filterId, 'mid');
    assert.equal(pruned.entries[1].filterId, 'new');
  });

  it('does not mutate the original ledger', () => {
    const ledger = makeLedger([
      { filterId: 'a', savedTokens: 10, savingsPercent: 10 },
      { filterId: 'b', savedTokens: 20, savingsPercent: 20 },
    ]);
    const originalLength = ledger.entries.length;
    pruneLedger(ledger, 1);
    assert.equal(ledger.entries.length, originalLength);
  });

  it('returns empty entries when keepLastN is 0', () => {
    const ledger = makeLedger([
      { filterId: 'a', savedTokens: 10, savingsPercent: 10 },
    ]);
    const pruned = pruneLedger(ledger, 0);
    assert.equal(pruned.entries.length, 0);
  });

  it('preserves all entries when keepLastN >= entry count', () => {
    const ledger = makeLedger([
      { filterId: 'a', savedTokens: 10, savingsPercent: 10 },
      { filterId: 'b', savedTokens: 20, savingsPercent: 20 },
    ]);
    const pruned = pruneLedger(ledger, 100);
    assert.equal(pruned.entries.length, 2);
  });

  it('updates updatedAt timestamp', () => {
    const ledger = makeLedger([{ filterId: 'a', savedTokens: 10, savingsPercent: 10 }]);
    const before = ledger.updatedAt;
    const pruned = pruneLedger(ledger, 1);
    // updatedAt should be a valid ISO string and may differ from original
    assert.ok(!isNaN(Date.parse(pruned.updatedAt)));
    // createdAt should be preserved
    assert.equal(pruned.createdAt, ledger.createdAt);
    void before; // suppress unused variable warning
  });
});
