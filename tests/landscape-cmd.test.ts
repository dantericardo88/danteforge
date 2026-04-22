import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { landscapeBuild, landscapeDiff, landscapeRanking, landscapeGap } from '../src/cli/commands/landscape-cmd.js';
import type { LandscapeMatrix } from '../src/dossier/types.js';

function makeMatrix(overrides: Partial<LandscapeMatrix> = {}): LandscapeMatrix {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    rubricVersion: 1,
    competitors: ['alpha', 'beta'],
    rankings: [
      { competitor: 'alpha', displayName: 'Alpha', composite: 9.0, type: 'tool' },
      { competitor: 'beta', displayName: 'Beta', composite: 7.5, type: 'tool' },
    ],
    dimScores: { '1': { alpha: 9.0, beta: 7.5 } },
    gapAnalysis: [],
    ...overrides,
  };
}

describe('landscapeBuild', () => {
  it('does not throw when buildLandscape succeeds', async () => {
    await assert.doesNotReject(() =>
      landscapeBuild({
        cwd: '/tmp/test',
        _buildLandscape: async () => makeMatrix(),
      })
    );
  });

  it('uses default selfId when not provided', async () => {
    let capturedSelfId: string | undefined;
    await landscapeBuild({
      cwd: '/tmp/test',
      _buildLandscape: async (_cwd, _opts, selfId) => { capturedSelfId = selfId; return makeMatrix(); },
    });
    assert.ok(typeof capturedSelfId === 'string');
  });
});

describe('landscapeDiff', () => {
  it('does not throw when no current landscape', async () => {
    await assert.doesNotReject(() =>
      landscapeDiff({
        cwd: '/tmp/test',
        _loadLandscape: async () => null,
        _loadPreviousLandscape: async () => null,
      })
    );
  });

  it('does not throw when no previous landscape', async () => {
    await assert.doesNotReject(() =>
      landscapeDiff({
        cwd: '/tmp/test',
        _loadLandscape: async () => makeMatrix(),
        _loadPreviousLandscape: async () => null,
      })
    );
  });

  it('does not throw when both landscapes exist', async () => {
    const prev = makeMatrix({ generatedAt: '2025-12-01T00:00:00.000Z' });
    const curr = makeMatrix({ generatedAt: '2026-01-01T00:00:00.000Z' });
    await assert.doesNotReject(() =>
      landscapeDiff({
        cwd: '/tmp/test',
        _loadLandscape: async () => curr,
        _loadPreviousLandscape: async () => prev,
      })
    );
  });
});

describe('landscapeRanking', () => {
  it('does not throw when landscape exists', async () => {
    await assert.doesNotReject(() =>
      landscapeRanking({
        cwd: '/tmp/test',
        _loadLandscape: async () => makeMatrix(),
      })
    );
  });

  it('does not throw when no landscape found', async () => {
    await assert.doesNotReject(() =>
      landscapeRanking({
        cwd: '/tmp/test',
        _loadLandscape: async () => null,
      })
    );
  });
});

describe('landscapeGap', () => {
  it('does not throw when landscape exists with gap analysis', async () => {
    const matrix = makeMatrix({
      gapAnalysis: [{ dim: '1', dimName: 'Functionality', dcScore: 7.0, leader: 'alpha', leaderScore: 9.0, gap: 2.0 }],
    });
    await assert.doesNotReject(() =>
      landscapeGap({
        cwd: '/tmp/test',
        _loadLandscape: async () => matrix,
      })
    );
  });

  it('does not throw when no landscape found', async () => {
    await assert.doesNotReject(() =>
      landscapeGap({
        cwd: '/tmp/test',
        _loadLandscape: async () => null,
      })
    );
  });
});
