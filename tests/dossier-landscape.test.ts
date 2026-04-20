// tests/dossier-landscape.test.ts — Tests for src/dossier/landscape.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLandscape, isLandscapeStale, loadLandscape } from '../src/dossier/landscape.js';
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
