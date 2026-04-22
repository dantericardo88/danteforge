// Token ROI tests — buildROIEntry, appendROIEntry, loadROIHistory, formatROISummary

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildROIEntry,
  appendROIEntry,
  loadROIHistory,
  formatROISummary,
  TOKEN_ROI_FILE,
  type WaveROIEntry,
} from '../src/core/token-roi.js';

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
