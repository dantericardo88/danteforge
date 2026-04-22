import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLandscapeStale, diffLandscape } from '../src/dossier/landscape.js';
import type { LandscapeMatrix } from '../src/dossier/types.js';

function makeMatrix(overrides: Partial<LandscapeMatrix> = {}): LandscapeMatrix {
  return {
    generatedAt: new Date().toISOString(),
    rubricVersion: 1,
    competitors: ['alpha', 'beta'],
    rankings: [
      { competitor: 'alpha', displayName: 'Alpha', composite: 8.0, type: 'tool' },
      { competitor: 'beta', displayName: 'Beta', composite: 7.0, type: 'tool' },
    ],
    dimScores: {},
    ...overrides,
  };
}

describe('isLandscapeStale', () => {
  it('returns false for freshly generated landscape', () => {
    const matrix = makeMatrix({ generatedAt: new Date().toISOString() });
    assert.ok(!isLandscapeStale(matrix));
  });

  it('returns true for landscape older than maxAgeDays', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const matrix = makeMatrix({ generatedAt: tenDaysAgo });
    assert.ok(isLandscapeStale(matrix, 7));
  });

  it('uses default 7 days when no maxAgeDays provided', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const matrix = makeMatrix({ generatedAt: eightDaysAgo });
    assert.ok(isLandscapeStale(matrix));
  });

  it('returns false when landscape is within maxAgeDays', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const matrix = makeMatrix({ generatedAt: threeDaysAgo });
    assert.ok(!isLandscapeStale(matrix, 7));
  });
});

describe('diffLandscape', () => {
  it('reports new competitors', () => {
    const previous = makeMatrix({
      rankings: [{ competitor: 'alpha', displayName: 'Alpha', composite: 8.0, type: 'tool' }],
    });
    const current = makeMatrix({
      rankings: [
        { competitor: 'alpha', displayName: 'Alpha', composite: 8.0, type: 'tool' },
        { competitor: 'gamma', displayName: 'Gamma', composite: 7.5, type: 'tool' },
      ],
    });
    const diff = diffLandscape(previous, current);
    assert.ok(diff.newCompetitors.includes('gamma'));
  });

  it('reports removed competitors', () => {
    const previous = makeMatrix();
    const current = makeMatrix({
      competitors: ['alpha'],
      rankings: [{ competitor: 'alpha', displayName: 'Alpha', composite: 8.0, type: 'tool' }],
    });
    const diff = diffLandscape(previous, current);
    assert.ok(diff.removedCompetitors.includes('beta'));
  });

  it('detects rank changes', () => {
    const previous = makeMatrix({
      rankings: [
        { competitor: 'alpha', displayName: 'Alpha', composite: 8.0, type: 'tool' },
        { competitor: 'beta', displayName: 'Beta', composite: 7.0, type: 'tool' },
      ],
    });
    const current = makeMatrix({
      rankings: [
        { competitor: 'alpha', displayName: 'Alpha', composite: 9.0, type: 'tool' },
        { competitor: 'beta', displayName: 'Beta', composite: 7.0, type: 'tool' },
      ],
    });
    const diff = diffLandscape(previous, current);
    const alphaChange = diff.rankingChanges.find(c => c.competitor === 'alpha');
    assert.ok(alphaChange !== undefined);
    assert.ok(alphaChange!.compositeDelta > 0);
  });

  it('has empty newCompetitors and removedCompetitors for identical landscapes', () => {
    const matrix = makeMatrix();
    const diff = diffLandscape(matrix, { ...matrix });
    assert.deepEqual(diff.newCompetitors, []);
    assert.deepEqual(diff.removedCompetitors, []);
  });

  it('preserves generatedAt timestamps', () => {
    const previous = makeMatrix({ generatedAt: '2026-01-01T00:00:00.000Z' });
    const current = makeMatrix({ generatedAt: '2026-02-01T00:00:00.000Z' });
    const diff = diffLandscape(previous, current);
    assert.equal(diff.previousGeneratedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(diff.currentGeneratedAt, '2026-02-01T00:00:00.000Z');
  });
});
