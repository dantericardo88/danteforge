import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildROIEntry,
  appendROIEntry,
  loadROIHistory,
  formatROISummary,
  TOKEN_ROI_FILE,
} from '../src/core/token-roi.js';

// ── buildROIEntry ─────────────────────────────────────────────────────────────

describe('buildROIEntry', () => {
  it('sets wave, tokensSpent, scoreBefore, scoreAfter', () => {
    const entry = buildROIEntry(1, 5000, 70, 80);
    assert.equal(entry.wave, 1);
    assert.equal(entry.tokensSpent, 5000);
    assert.equal(entry.scoreBefore, 70);
    assert.equal(entry.scoreAfter, 80);
  });

  it('computes scoreDelta', () => {
    const entry = buildROIEntry(1, 5000, 70, 80);
    assert.equal(entry.scoreDelta, 10);
  });

  it('computes negative scoreDelta on regression', () => {
    const entry = buildROIEntry(2, 3000, 80, 75);
    assert.equal(entry.scoreDelta, -5);
  });

  it('computes efficiency = scoreDelta / (tokensSpent / 1000)', () => {
    const entry = buildROIEntry(1, 10000, 60, 70);
    // efficiency = 10 / (10000 / 1000) = 10 / 10 = 1.0
    assert.ok(Math.abs(entry.efficiency - 1.0) < 0.001);
  });

  it('sets efficiency to 0 when no tokens spent', () => {
    const entry = buildROIEntry(1, 0, 70, 80);
    assert.equal(entry.efficiency, 0);
  });

  it('includes a timestamp', () => {
    const entry = buildROIEntry(1, 1000, 50, 60);
    assert.ok(entry.timestamp.includes('T'));
  });

  it('includes costEstimatedUsd >= 0', () => {
    const entry = buildROIEntry(1, 5000, 50, 60, 'claude');
    assert.ok(entry.costEstimatedUsd >= 0);
  });
});

// ── appendROIEntry ────────────────────────────────────────────────────────────

describe('appendROIEntry', () => {
  it('appends a valid JSON line', async () => {
    const lines: string[] = [];
    const dirs: string[] = [];

    await appendROIEntry(buildROIEntry(1, 5000, 70, 80), '/fake', {
      _mkdir: async (p) => { dirs.push(p); },
      _appendLine: async (_, line) => { lines.push(line); },
    });

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.wave, 1);
    assert.equal(parsed.scoreBefore, 70);
  });

  it('creates directory before appending', async () => {
    const dirs: string[] = [];
    await appendROIEntry(buildROIEntry(1, 1000, 50, 60), '/my/cwd', {
      _mkdir: async (p) => { dirs.push(p); },
      _appendLine: async () => {},
    });
    assert.ok(dirs.some(d => d.includes('.danteforge')));
  });

  it('stores the file under TOKEN_ROI_FILE path', async () => {
    const paths: string[] = [];
    await appendROIEntry(buildROIEntry(1, 1000, 50, 60), '/cwd', {
      _mkdir: async () => {},
      _appendLine: async (p) => { paths.push(p); },
    });
    assert.ok(paths[0]!.endsWith(TOKEN_ROI_FILE.replace(/\//g, process.platform === 'win32' ? '\\' : '/')));
  });
});

// ── loadROIHistory ────────────────────────────────────────────────────────────

describe('loadROIHistory', () => {
  it('returns empty array when file does not exist', async () => {
    const history = await loadROIHistory('/fake', {
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.deepEqual(history, []);
  });

  it('parses valid JSONL entries', async () => {
    const entry1 = buildROIEntry(1, 5000, 60, 70);
    const entry2 = buildROIEntry(2, 3000, 70, 75);
    const content = [JSON.stringify(entry1), JSON.stringify(entry2), ''].join('\n');

    const history = await loadROIHistory('/fake', {
      _readFile: async () => content,
    });

    assert.equal(history.length, 2);
    assert.equal(history[0]!.wave, 1);
    assert.equal(history[1]!.wave, 2);
  });

  it('skips corrupt lines silently', async () => {
    const valid = JSON.stringify(buildROIEntry(1, 1000, 50, 60));
    const content = `${valid}\n{corrupt json here\n${valid}\n`;

    const history = await loadROIHistory('/fake', {
      _readFile: async () => content,
    });

    assert.equal(history.length, 2);
  });

  it('handles empty file', async () => {
    const history = await loadROIHistory('/fake', {
      _readFile: async () => '',
    });
    assert.deepEqual(history, []);
  });

  it('handles whitespace-only lines', async () => {
    const content = '   \n\n   \n';
    const history = await loadROIHistory('/fake', {
      _readFile: async () => content,
    });
    assert.deepEqual(history, []);
  });
});

// ── formatROISummary ──────────────────────────────────────────────────────────

describe('formatROISummary', () => {
  it('returns placeholder for empty input', () => {
    const output = formatROISummary([]);
    assert.ok(output.includes('No ROI data'));
  });

  it('includes header row', () => {
    const entries = [buildROIEntry(1, 5000, 70, 80)];
    const output = formatROISummary(entries);
    assert.ok(output.includes('Wave'));
    assert.ok(output.includes('Tokens'));
    assert.ok(output.includes('ΔScore'));
    assert.ok(output.includes('Efficiency'));
    assert.ok(output.includes('Cost USD'));
  });

  it('includes totals footer', () => {
    const entries = [buildROIEntry(1, 5000, 70, 80), buildROIEntry(2, 3000, 80, 85)];
    const output = formatROISummary(entries);
    assert.ok(output.includes('Total'));
  });

  it('shows positive delta with + prefix', () => {
    const entries = [buildROIEntry(1, 5000, 70, 80)];
    const output = formatROISummary(entries);
    assert.ok(output.includes('+10'));
  });

  it('shows negative delta without + prefix', () => {
    const entries = [buildROIEntry(1, 5000, 80, 75)];
    const output = formatROISummary(entries);
    assert.ok(output.includes('-5'));
  });
});
