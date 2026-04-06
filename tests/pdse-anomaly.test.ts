// Tests for PDSE anomaly detection
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePdseHistoryMarkdown,
  formatPdseHistoryEntry,
  appendPdseHistory,
  loadPdseHistory,
  detectAnomalies,
} from '../src/core/pdse-anomaly.js';
import type { PdseHistoryEntry } from '../src/core/wiki-schema.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<PdseHistoryEntry> = {}): PdseHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    artifact: 'SPEC',
    score: 75,
    dimensions: { completeness: 15, clarity: 14, testability: 16, constitutionAlignment: 18, integrationFitness: 7, freshness: 5 },
    decision: 'warn',
    ...overrides,
  };
}

/** Build in-memory store for injection */
function makeStore(initial = ''): { get content(): string; readFile: () => Promise<string>; writeFile: (_: string, c: string) => Promise<void> } {
  const store = { content: initial };
  return {
    get content() { return store.content; },
    readFile: async () => store.content,
    writeFile: async (_path: string, c: string) => { store.content = c; },
  };
}

// ── parsePdseHistoryMarkdown ──────────────────────────────────────────────────

describe('parsePdseHistoryMarkdown', () => {
  it('returns empty array for empty content', () => {
    assert.deepEqual(parsePdseHistoryMarkdown(''), []);
  });

  it('returns empty array for header-only content', () => {
    assert.deepEqual(parsePdseHistoryMarkdown('# PDSE Score History\n\nSome intro.\n'), []);
  });

  it('parses a single entry block', () => {
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z',
      '- **Score**: 80',
      '- **Decision**: advance',
      '- **Dimensions**:',
      '    - completeness: 18',
      '    - clarity: 16',
      '',
    ].join('\n');

    const entries = parsePdseHistoryMarkdown(md);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].artifact, 'SPEC');
    assert.equal(entries[0].score, 80);
    assert.equal(entries[0].decision, 'advance');
    assert.equal(entries[0].dimensions['completeness'], 18);
    assert.equal(entries[0].dimensions['clarity'], 16);
  });

  it('parses multiple entries for different artifacts', () => {
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z',
      '- **Score**: 80',
      '- **Decision**: advance',
      '',
      '## PLAN | 2026-04-02T00:00:00.000Z',
      '- **Score**: 65',
      '- **Decision**: warn',
      '',
    ].join('\n');

    const entries = parsePdseHistoryMarkdown(md);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].artifact, 'SPEC');
    assert.equal(entries[1].artifact, 'PLAN');
  });

  it('parses multiple entries for the same artifact', () => {
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z',
      '- **Score**: 70',
      '- **Decision**: warn',
      '',
      '## SPEC | 2026-04-02T00:00:00.000Z',
      '- **Score**: 72',
      '- **Decision**: warn',
      '',
    ].join('\n');

    const entries = parsePdseHistoryMarkdown(md);
    assert.equal(entries.length, 2);
    assert.ok(entries.every(e => e.artifact === 'SPEC'));
  });
});

// ── formatPdseHistoryEntry ────────────────────────────────────────────────────

describe('formatPdseHistoryEntry', () => {
  it('includes artifact name and timestamp in heading', () => {
    const entry = makeEntry({ artifact: 'PLAN', timestamp: '2026-04-06T00:00:00.000Z', score: 82, decision: 'advance' });
    const md = formatPdseHistoryEntry(entry);
    assert.ok(md.includes('## PLAN | 2026-04-06T00:00:00.000Z'));
  });

  it('includes score', () => {
    const entry = makeEntry({ score: 77 });
    assert.ok(formatPdseHistoryEntry(entry).includes('**Score**: 77'));
  });

  it('includes decision', () => {
    const entry = makeEntry({ decision: 'blocked' });
    assert.ok(formatPdseHistoryEntry(entry).includes('**Decision**: blocked'));
  });

  it('includes dimension values', () => {
    const entry = makeEntry({ dimensions: { completeness: 19, clarity: 18 } });
    const md = formatPdseHistoryEntry(entry);
    assert.ok(md.includes('completeness: 19'));
    assert.ok(md.includes('clarity: 18'));
  });

  it('round-trips through parser', () => {
    const entry = makeEntry({ artifact: 'TASKS', score: 60, decision: 'pause' });
    const md = formatPdseHistoryEntry(entry);
    const parsed = parsePdseHistoryMarkdown(md);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].artifact, 'TASKS');
    assert.equal(parsed[0].score, 60);
    assert.equal(parsed[0].decision, 'pause');
  });
});

// ── appendPdseHistory ─────────────────────────────────────────────────────────

describe('appendPdseHistory', () => {
  it('creates header when file does not exist', async () => {
    const written: Record<string, string> = {};
    const entry = makeEntry({ artifact: 'SPEC', score: 70 });

    await appendPdseHistory(entry, {
      _readFile: async () => { throw new Error('ENOENT'); },
      _writeFile: async (p, c) => { written[p] = c; },
      _mkdir: async () => {},
    });

    const content = Object.values(written)[0];
    assert.ok(content !== undefined);
    assert.ok(content.includes('# PDSE Score History'));
    assert.ok(content.includes('## SPEC |'));
  });

  it('appends to existing content', async () => {
    const store = makeStore('# PDSE Score History\n\n## SPEC | 2026-01-01T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n\n');
    const entry = makeEntry({ artifact: 'SPEC', score: 75 });

    await appendPdseHistory(entry, {
      _readFile: store.readFile,
      _writeFile: store.writeFile,
      _mkdir: async () => {},
    });

    assert.ok(store.content.includes('Score**: 70'));
    assert.ok(store.content.includes('Score**: 75'));
  });
});

// ── loadPdseHistory ───────────────────────────────────────────────────────────

describe('loadPdseHistory', () => {
  it('returns empty array when file does not exist', async () => {
    const result = await loadPdseHistory('SPEC', {
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.deepEqual(result, []);
  });

  it('returns only entries for the specified artifact', async () => {
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z',
      '- **Score**: 70',
      '- **Decision**: warn',
      '',
      '## PLAN | 2026-04-01T00:00:00.000Z',
      '- **Score**: 80',
      '- **Decision**: advance',
      '',
    ].join('\n');

    const result = await loadPdseHistory('SPEC', { _readFile: async () => md });
    assert.equal(result.length, 1);
    assert.equal(result[0].artifact, 'SPEC');
  });

  it('returns at most `limit` entries', async () => {
    const md = Array.from({ length: 10 }, (_, i) =>
      `## SPEC | 2026-04-0${(i % 9) + 1}T00:00:00.000Z\n- **Score**: ${60 + i}\n- **Decision**: warn\n`,
    ).join('\n');

    const result = await loadPdseHistory('SPEC', { _readFile: async () => md, limit: 3 });
    assert.equal(result.length, 3);
  });
});

// ── detectAnomalies ───────────────────────────────────────────────────────────

describe('detectAnomalies', () => {
  it('returns null when history is empty', async () => {
    const flag = await detectAnomalies('SPEC', 90, {
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(flag, null);
  });

  it('returns null when only one historical entry exists', async () => {
    const md = '## SPEC | 2026-04-01T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n';
    const flag = await detectAnomalies('SPEC', 90, { _readFile: async () => md });
    assert.equal(flag, null);
  });

  it('returns null when delta is below threshold', async () => {
    // avg = 70, current = 80, delta = 10 < 15 threshold
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
      '## SPEC | 2026-04-02T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
    ].join('\n');
    const flag = await detectAnomalies('SPEC', 80, { _readFile: async () => md });
    assert.equal(flag, null);
  });

  it('returns flag when delta meets or exceeds threshold', async () => {
    // avg = 70, current = 90, delta = 20 >= 15 threshold
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
      '## SPEC | 2026-04-02T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
    ].join('\n');
    const flag = await detectAnomalies('SPEC', 90, { _readFile: async () => md });
    assert.ok(flag !== null);
    assert.equal(flag!.artifact, 'SPEC');
    assert.equal(flag!.currentScore, 90);
    assert.equal(flag!.previousAvg, 70);
    assert.equal(flag!.delta, 20);
  });

  it('returns flag for negative delta (score drop) exceeding threshold', async () => {
    // avg = 85, current = 60, delta = -25
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z\n- **Score**: 85\n- **Decision**: advance\n',
      '## SPEC | 2026-04-02T00:00:00.000Z\n- **Score**: 85\n- **Decision**: advance\n',
    ].join('\n');
    const flag = await detectAnomalies('SPEC', 60, { _readFile: async () => md });
    assert.ok(flag !== null);
    assert.equal(flag!.delta, -25);
  });

  it('uses custom threshold', async () => {
    // avg = 70, current = 78, delta = 8 — under default threshold but over custom threshold of 5
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
      '## SPEC | 2026-04-02T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
    ].join('\n');
    const flag = await detectAnomalies('SPEC', 78, { _readFile: async () => md, threshold: 5 });
    assert.ok(flag !== null);
    assert.equal(flag!.delta, 8);
  });

  it('uses trailing-window average (last 5 entries)', async () => {
    // 7 entries: avg of last 5 should be used
    const scores = [50, 50, 60, 70, 80, 80, 80]; // last 5: avg = (60+70+80+80+80)/5 = 74
    const md = scores.map((s, i) =>
      `## SPEC | 2026-04-0${i + 1}T00:00:00.000Z\n- **Score**: ${s}\n- **Decision**: warn\n`,
    ).join('\n');

    // current = 94, delta from trailing 5 avg (74) = 20 >= 15
    const flag = await detectAnomalies('SPEC', 94, { _readFile: async () => md });
    assert.ok(flag !== null);
    assert.equal(flag!.previousAvg, 74);
  });

  it('boundary: delta of exactly threshold triggers flag', async () => {
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
      '## SPEC | 2026-04-02T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
    ].join('\n');
    const flag = await detectAnomalies('SPEC', 85, { _readFile: async () => md }); // delta = 15 exactly
    assert.ok(flag !== null);
  });

  it('boundary: delta of threshold minus 1 does NOT trigger flag', async () => {
    const md = [
      '## SPEC | 2026-04-01T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
      '## SPEC | 2026-04-02T00:00:00.000Z\n- **Score**: 70\n- **Decision**: warn\n',
    ].join('\n');
    const flag = await detectAnomalies('SPEC', 84, { _readFile: async () => md }); // delta = 14 < 15
    assert.equal(flag, null);
  });
});
