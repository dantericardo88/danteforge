// tests/dossier-landscape.test.ts — Tests for src/dossier/landscape.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildLandscape,
  diffLandscape,
  isLandscapeStale,
  landscapeSnapshotPath,
  loadLandscape,
  loadPreviousLandscape,
} from '../src/dossier/landscape.js';
import type { Dossier, LandscapeMatrix } from '../src/dossier/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDossier(id: string, score: number, selfId = false): Dossier {
  return {
    competitor: id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    type: selfId ? 'open-source' : 'closed-source',
    lastBuilt: new Date().toISOString(),
    sources: [],
    dimensions: {
      '1': { score, scoreJustification: 'test', evidence: [], humanOverride: null, humanOverrideReason: null },
      '2': { score: score - 1, scoreJustification: 'test2', evidence: [], humanOverride: null, humanOverrideReason: null },
    },
    composite: score,
    compositeMethod: 'mean_28_dims',
    rubricVersion: 1,
  };
}

function makeLoadDossiers(dossiers: Dossier[]) {
  return async (_cwd: string) => dossiers;
}

const writtenFiles: Record<string, string> = {};
function makeWriteFile() {
  return async (p: string, d: string) => { writtenFiles[p] = d; };
}

// ── Tests: buildLandscape() ───────────────────────────────────────────────────

describe('buildLandscape()', () => {
  it('builds landscape with correct rankings order', async () => {
    const matrix = await buildLandscape('/fake/cwd', {
      _loadDossiers: makeLoadDossiers([
        makeDossier('cursor', 9.0),
        makeDossier('aider', 7.0),
        makeDossier('dantescode', 8.0, true),
      ]),
      _writeFile: makeWriteFile(),
      _mkdir: async () => {},
    });

    assert.equal(matrix.rankings[0]!.competitor, 'cursor');
    assert.equal(matrix.rankings[1]!.competitor, 'dantescode');
    assert.equal(matrix.rankings[2]!.competitor, 'aider');
  });

  it('sets generatedAt and rubricVersion', async () => {
    const matrix = await buildLandscape('/fake/cwd', {
      _loadDossiers: makeLoadDossiers([makeDossier('cursor', 9.0)]),
      _writeFile: makeWriteFile(),
      _mkdir: async () => {},
    });

    assert.ok(matrix.generatedAt);
    assert.equal(matrix.rubricVersion, 1);
  });

  it('builds dimScores with all competitors', async () => {
    const matrix = await buildLandscape('/fake/cwd', {
      _loadDossiers: makeLoadDossiers([
        makeDossier('cursor', 9.0),
        makeDossier('aider', 7.0),
      ]),
      _writeFile: makeWriteFile(),
      _mkdir: async () => {},
    });

    assert.ok(matrix.dimScores['1']);
    assert.equal(matrix.dimScores['1']!['cursor'], 9.0);
    assert.equal(matrix.dimScores['1']!['aider'], 7.0);
  });

  it('builds gap analysis for self competitor', async () => {
    const matrix = await buildLandscape('/fake/cwd', {
      _loadDossiers: makeLoadDossiers([
        makeDossier('cursor', 9.0),
        makeDossier('dantescode', 5.0, true), // big gap
      ]),
      _writeFile: makeWriteFile(),
      _mkdir: async () => {},
    }, 'dantescode');

    assert.ok(matrix.gapAnalysis);
    assert.ok(matrix.gapAnalysis.length > 0);
    const firstGap = matrix.gapAnalysis[0]!;
    assert.equal(firstGap.leader, 'cursor');
    assert.ok(firstGap.gap > 1.0);
  });

  it('throws when no dossiers exist', async () => {
    await assert.rejects(
      () => buildLandscape('/fake/cwd', {
        _loadDossiers: async () => [],
        _writeFile: makeWriteFile(),
        _mkdir: async () => {},
      }),
      (err: Error) => {
        assert.ok(err.message.includes('No dossiers'));
        return true;
      },
    );
  });

  it('writes landscape.json and COMPETITIVE_LANDSCAPE.md', async () => {
    const files: Record<string, string> = {};
    await buildLandscape('/fake/cwd', {
      _loadDossiers: makeLoadDossiers([makeDossier('cursor', 9.0)]),
      _writeFile: async (p, d) => { files[p] = d; },
      _mkdir: async () => {},
    });

    const paths = Object.keys(files);
    assert.ok(paths.some((p) => p.endsWith('landscape.json')));
    assert.ok(paths.some((p) => p.endsWith('COMPETITIVE_LANDSCAPE.md')));
  });

  it('archives the previous landscape before overwriting the latest build', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'landscape-builder-'));
    const previous: LandscapeMatrix = {
      generatedAt: '2026-04-10T12:00:00.000Z',
      rubricVersion: 1,
      competitors: ['cursor'],
      rankings: [{ competitor: 'cursor', displayName: 'Cursor', composite: 7, type: 'closed-source' }],
      dimScores: { '1': { cursor: 7 } },
    };

    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'landscape.json'), JSON.stringify(previous, null, 2));

    const current = await buildLandscape(cwd, {
      _loadDossiers: makeLoadDossiers([makeDossier('cursor', 9.0)]),
    });

    const archivedRaw = await fs.readFile(
      landscapeSnapshotPath(cwd, previous.generatedAt),
      'utf8',
    );
    const archived = JSON.parse(archivedRaw) as LandscapeMatrix;

    assert.equal(current.rankings[0]!.composite, 9);
    assert.equal(archived.generatedAt, previous.generatedAt);
    assert.equal(archived.rankings[0]!.composite, previous.rankings[0]!.composite);
  });
});

// ── Tests: isLandscapeStale() ─────────────────────────────────────────────────

describe('isLandscapeStale()', () => {
  it('returns false for freshly generated landscape', () => {
    const landscape: LandscapeMatrix = {
      generatedAt: new Date().toISOString(),
      rubricVersion: 1, competitors: [], rankings: [], dimScores: {},
    };
    assert.equal(isLandscapeStale(landscape, 7), false);
  });

  it('returns true for landscape older than maxAgeDays', () => {
    const landscape: LandscapeMatrix = {
      generatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      rubricVersion: 1, competitors: [], rankings: [], dimScores: {},
    };
    assert.equal(isLandscapeStale(landscape, 7), true);
  });

  it('uses default 7 days when maxAgeDays not provided', () => {
    const old: LandscapeMatrix = {
      generatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      rubricVersion: 1, competitors: [], rankings: [], dimScores: {},
    };
    assert.equal(isLandscapeStale(old), true);
  });
});

describe('loadPreviousLandscape()', () => {
  it('loads the latest archived landscape snapshot', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'landscape-history-'));
    const older: LandscapeMatrix = {
      generatedAt: '2026-04-01T12:00:00.000Z',
      rubricVersion: 1,
      competitors: ['cursor'],
      rankings: [{ competitor: 'cursor', displayName: 'Cursor', composite: 7, type: 'closed-source' }],
      dimScores: { '1': { cursor: 7 } },
    };
    const newer: LandscapeMatrix = {
      ...older,
      generatedAt: '2026-04-10T12:00:00.000Z',
      rankings: [{ competitor: 'cursor', displayName: 'Cursor', composite: 8, type: 'closed-source' }],
      dimScores: { '1': { cursor: 8 } },
    };

    await fs.mkdir(path.dirname(landscapeSnapshotPath(cwd, older.generatedAt)), { recursive: true });
    await fs.writeFile(landscapeSnapshotPath(cwd, older.generatedAt), JSON.stringify(older, null, 2));
    await fs.writeFile(landscapeSnapshotPath(cwd, newer.generatedAt), JSON.stringify(newer, null, 2));

    const previous = await loadPreviousLandscape(cwd);
    assert.ok(previous);
    assert.equal(previous.generatedAt, newer.generatedAt);
    assert.equal(previous.rankings[0]!.composite, 8);
  });
});

describe('diffLandscape()', () => {
  it('reports ranking movement, composite changes, and new competitors', () => {
    const previous: LandscapeMatrix = {
      generatedAt: '2026-04-01T12:00:00.000Z',
      rubricVersion: 1,
      competitors: ['cursor', 'dantescode'],
      rankings: [
        { competitor: 'cursor', displayName: 'Cursor', composite: 9, type: 'closed-source' },
        { competitor: 'dantescode', displayName: 'DanteCode', composite: 7, type: 'open-source' },
      ],
      dimScores: { '1': { cursor: 9, dantescode: 7 } },
    };
    const current: LandscapeMatrix = {
      generatedAt: '2026-04-10T12:00:00.000Z',
      rubricVersion: 1,
      competitors: ['dantescode', 'cursor', 'aider'],
      rankings: [
        { competitor: 'dantescode', displayName: 'DanteCode', composite: 8.5, type: 'open-source' },
        { competitor: 'cursor', displayName: 'Cursor', composite: 9.1, type: 'closed-source' },
        { competitor: 'aider', displayName: 'Aider', composite: 6.5, type: 'open-source' },
      ],
      dimScores: { '1': { dantescode: 8.5, cursor: 9.1, aider: 6.5 } },
    };

    const delta = diffLandscape(previous, current);

    assert.deepEqual(delta.newCompetitors, ['aider']);
    const selfChange = delta.rankingChanges.find((change) => change.competitor === 'dantescode');
    assert.ok(selfChange);
    assert.equal(selfChange.beforeRank, 2);
    assert.equal(selfChange.afterRank, 1);
    assert.equal(selfChange.rankDelta, 1);
  });
});
