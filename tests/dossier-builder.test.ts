// tests/dossier-builder.test.ts — Tests for src/dossier/builder.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildDossier,
  computeComposite,
  dossierPath,
  dossierSnapshotPath,
  isDossierFresh,
  loadPreviousDossier,
  parseSince,
} from '../src/dossier/builder.js';
import type { Dossier, DossierDimension, EvidenceItem, Rubric, RubricDimension } from '../src/dossier/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRubric(): Rubric {
  return {
    version: 1,
    frozenAt: '2026-04-20',
    dimensions: {
      '1': {
        name: 'Ghost text',
        scoreCriteria: { '9': ['a'], '7': ['b'], '5': ['c'], '3': ['d'], '1': ['e'] },
      },
    },
  };
}

function makeRegistry() {
  return {
    competitors: [
      {
        id: 'cursor',
        displayName: 'Cursor',
        type: 'closed-source' as const,
        primarySources: ['https://cursor.com'],
        githubRepo: null,
      },
    ],
  };
}

function makeEvidence(dim = 1): EvidenceItem {
  return { claim: 'test claim', quote: 'test quote', source: 'https://cursor.com', dim };
}

const writtenFiles: Record<string, string> = {};

function makeWriteFile() {
  return async (p: string, d: string) => { writtenFiles[p] = d; };
}

// ── Tests: parseSince() ───────────────────────────────────────────────────────

describe('parseSince()', () => {
  it('parses days', () => {
    const ms = parseSince('7d');
    assert.equal(ms, 7 * 24 * 60 * 60 * 1000);
  });

  it('parses hours', () => {
    const ms = parseSince('24h');
    assert.equal(ms, 24 * 60 * 60 * 1000);
  });

  it('parses minutes', () => {
    const ms = parseSince('30m');
    assert.equal(ms, 30 * 60 * 1000);
  });

  it('returns 0 for invalid duration', () => {
    assert.equal(parseSince('invalid'), 0);
  });
});

// ── Tests: isDossierFresh() ───────────────────────────────────────────────────

describe('isDossierFresh()', () => {
  it('returns true when dossier built within sinceMs', () => {
    const dossier = { lastBuilt: new Date(Date.now() - 1000).toISOString() } as Dossier;
    assert.equal(isDossierFresh(dossier, 7 * 24 * 60 * 60 * 1000), true);
  });

  it('returns false when dossier built outside sinceMs', () => {
    const dossier = { lastBuilt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() } as Dossier;
    assert.equal(isDossierFresh(dossier, 7 * 24 * 60 * 60 * 1000), false);
  });

  it('returns false when sinceMs is 0', () => {
    const dossier = { lastBuilt: new Date().toISOString() } as Dossier;
    assert.equal(isDossierFresh(dossier, 0), false);
  });
});

// ── Tests: computeComposite() ─────────────────────────────────────────────────

describe('computeComposite()', () => {
  function makeDim(score: number, humanOverride: number | null = null): DossierDimension {
    return { score, scoreJustification: '', evidence: [], humanOverride, humanOverrideReason: null };
  }

  it('computes mean of scores', () => {
    const dims = { '1': makeDim(8), '2': makeDim(6) };
    assert.equal(computeComposite(dims), 7);
  });

  it('uses humanOverride when set', () => {
    const dims = { '1': makeDim(8, 10) }; // override to 10
    assert.equal(computeComposite(dims), 10);
  });

  it('returns 0 for empty dimensions', () => {
    assert.equal(computeComposite({}), 0);
  });
});

// ── Tests: buildDossier() ─────────────────────────────────────────────────────

describe('buildDossier()', () => {
  it('builds a dossier with correct shape', async () => {
    const files: Record<string, string> = {};
    const dossier = await buildDossier({
      cwd: '/fake/cwd',
      competitor: 'cursor',
      _loadRubric: async () => makeRubric(),
      _loadRegistry: async () => makeRegistry(),
      _fetchSource: async () => ({ content: 'fetched content', fromCache: false, hash: 'sha256:abc' }),
      _extractEvidence: async () => [makeEvidence()],
      _scoreDimension: async () => ({ score: 8, justification: 'good evidence' }),
      _writeFile: async (p, d) => { files[p] = d; },
      _mkdir: async () => {},
    });

    assert.equal(dossier.competitor, 'cursor');
    assert.equal(dossier.displayName, 'Cursor');
    assert.equal(dossier.type, 'closed-source');
    assert.ok(dossier.dimensions['1']);
    assert.equal(dossier.dimensions['1']!.score, 8);
    assert.equal(dossier.composite, 8);
    assert.equal(dossier.rubricVersion, 1);
    // File should have been written
    assert.ok(Object.keys(files).length > 0);
  });

  it('marks dimension as unverified when no non-empty quotes', async () => {
    const dossier = await buildDossier({
      cwd: '/fake/cwd',
      competitor: 'cursor',
      _loadRubric: async () => makeRubric(),
      _loadRegistry: async () => makeRegistry(),
      _fetchSource: async () => ({ content: 'content', fromCache: false, hash: 'sha256:x' }),
      _extractEvidence: async () => [{ claim: 'x', quote: '', source: 'https://x.com', dim: 1 }],
      _scoreDimension: async () => ({ score: 1, justification: 'no evidence' }),
      _writeFile: async () => {},
      _mkdir: async () => {},
    });

    assert.equal(dossier.dimensions['1']!.unverified, true);
  });

  it('skips when since filter shows dossier is fresh', async () => {
    const freshDossier: Dossier = {
      competitor: 'cursor', displayName: 'Cursor', type: 'closed-source',
      lastBuilt: new Date().toISOString(), sources: [],
      dimensions: { '1': { score: 9, scoreJustification: 'fresh', evidence: [], humanOverride: null, humanOverrideReason: null } },
      composite: 9, compositeMethod: 'mean_28_dims', rubricVersion: 1,
    };

    let fetchCalled = false;
    const result = await buildDossier({
      cwd: '/fake/cwd',
      competitor: 'cursor',
      since: '7d',
      _loadRubric: async () => makeRubric(),
      _loadRegistry: async () => makeRegistry(),
      _readExisting: async () => freshDossier,
      _fetchSource: async () => { fetchCalled = true; return { content: '', fromCache: false, hash: '' }; },
      _extractEvidence: async () => [],
      _scoreDimension: async () => ({ score: 1, justification: '' }),
      _writeFile: async () => {},
      _mkdir: async () => {},
    });

    assert.equal(fetchCalled, false, 'should not fetch when dossier is fresh');
    assert.equal(result.composite, 9); // returned the fresh dossier
  });

  it('handles failed source fetch gracefully', async () => {
    const dossier = await buildDossier({
      cwd: '/fake/cwd',
      competitor: 'cursor',
      _loadRubric: async () => makeRubric(),
      _loadRegistry: async () => makeRegistry(),
      _fetchSource: async () => { throw new Error('network down'); },
      _extractEvidence: async () => [],
      _scoreDimension: async () => ({ score: 1, justification: 'no evidence' }),
      _writeFile: async () => {},
      _mkdir: async () => {},
    });
    // Should still produce a dossier with score 1
    assert.equal(dossier.competitor, 'cursor');
    assert.equal(dossier.dimensions['1']!.score, 1);
  });

  it('archives the previous dossier before overwriting the latest build', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dossier-builder-'));
    const previous: Dossier = {
      competitor: 'cursor',
      displayName: 'Cursor',
      type: 'closed-source',
      lastBuilt: '2026-04-10T12:00:00.000Z',
      sources: [],
      dimensions: {
        '1': { score: 6, scoreJustification: 'old', evidence: [], humanOverride: null, humanOverrideReason: null },
      },
      composite: 6,
      compositeMethod: 'mean_28_dims',
      rubricVersion: 1,
    };

    await fs.mkdir(path.dirname(dossierPath(cwd, 'cursor')), { recursive: true });
    await fs.writeFile(dossierPath(cwd, 'cursor'), JSON.stringify(previous, null, 2));

    const next = await buildDossier({
      cwd,
      competitor: 'cursor',
      _loadRubric: async () => makeRubric(),
      _loadRegistry: async () => makeRegistry(),
      _fetchSource: async () => ({ content: 'fresh content', fromCache: false, hash: 'sha256:new' }),
      _extractEvidence: async () => [makeEvidence()],
      _scoreDimension: async () => ({ score: 9, justification: 'fresh evidence' }),
    });

    const archivedRaw = await fs.readFile(
      dossierSnapshotPath(cwd, 'cursor', previous.lastBuilt),
      'utf8',
    );
    const archived = JSON.parse(archivedRaw) as Dossier;

    assert.equal(next.composite, 9);
    assert.equal(archived.lastBuilt, previous.lastBuilt);
    assert.equal(archived.composite, previous.composite);
  });
});

describe('loadPreviousDossier()', () => {
  it('loads the most recent archived dossier snapshot', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dossier-history-'));
    const historyDir = path.dirname(dossierSnapshotPath(cwd, 'cursor', '2026-04-10T12:00:00.000Z'));
    const older: Dossier = {
      competitor: 'cursor',
      displayName: 'Cursor',
      type: 'closed-source',
      lastBuilt: '2026-04-01T12:00:00.000Z',
      sources: [],
      dimensions: {
        '1': { score: 5, scoreJustification: 'older', evidence: [], humanOverride: null, humanOverrideReason: null },
      },
      composite: 5,
      compositeMethod: 'mean_28_dims',
      rubricVersion: 1,
    };
    const newer: Dossier = {
      ...older,
      lastBuilt: '2026-04-10T12:00:00.000Z',
      composite: 8,
      dimensions: {
        '1': { score: 8, scoreJustification: 'newer', evidence: [], humanOverride: null, humanOverrideReason: null },
      },
    };

    await fs.mkdir(historyDir, { recursive: true });
    await fs.writeFile(dossierSnapshotPath(cwd, 'cursor', older.lastBuilt), JSON.stringify(older, null, 2));
    await fs.writeFile(dossierSnapshotPath(cwd, 'cursor', newer.lastBuilt), JSON.stringify(newer, null, 2));

    const previous = await loadPreviousDossier(cwd, 'cursor');
    assert.ok(previous);
    assert.equal(previous.lastBuilt, newer.lastBuilt);
    assert.equal(previous.composite, newer.composite);
  });
});
