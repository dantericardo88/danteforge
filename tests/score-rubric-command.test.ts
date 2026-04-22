import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { showDimension, rubricScoreDiff } from '../src/cli/commands/score-rubric.js';
import { DIMENSIONS_28, getDimension } from '../src/scoring/dimensions.js';

describe('DIMENSIONS_28', () => {
  it('is a non-empty array', () => {
    assert.ok(Array.isArray(DIMENSIONS_28) && DIMENSIONS_28.length > 0);
  });

  it('each dimension has required fields', () => {
    for (const dim of DIMENSIONS_28) {
      assert.ok(typeof dim.id === 'string' && dim.id.length > 0, `id missing: ${JSON.stringify(dim)}`);
      assert.ok(typeof dim.name === 'string' && dim.name.length > 0, `name missing for ${dim.id}`);
      assert.ok(typeof dim.maxScore === 'number', `maxScore missing for ${dim.id}`);
    }
  });

  it('has unique ids', () => {
    const ids = DIMENSIONS_28.map(d => d.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length);
  });
});

describe('getDimension', () => {
  it('returns a dimension for a valid id', () => {
    const id = DIMENSIONS_28[0].id;
    const dim = getDimension(id);
    assert.ok(dim !== undefined);
    assert.equal(dim!.id, id);
  });

  it('returns undefined for unknown id', () => {
    const dim = getDimension('__nonexistent_id__');
    assert.equal(dim, undefined);
  });
});

describe('showDimension', () => {
  it('emits dimension info for valid id', () => {
    const id = DIMENSIONS_28[0].id;
    const lines: string[] = [];
    showDimension(id, (msg) => lines.push(msg));
    assert.ok(lines.length > 0);
    assert.ok(lines.some(l => l.includes(id) || l.includes('Category')));
  });

  it('emits unknown message for invalid id', () => {
    const lines: string[] = [];
    showDimension('__bad_id__', (msg) => lines.push(msg));
    assert.ok(lines.some(l => l.includes('Unknown')));
  });

  it('includes max score in output', () => {
    const id = DIMENSIONS_28[0].id;
    const lines: string[] = [];
    showDimension(id, (msg) => lines.push(msg));
    assert.ok(lines.some(l => l.includes('Max score')));
  });
});

describe('rubricScoreDiff', () => {
  function makeDimScore(dimensionId: string, rubricId: string, score: number): object {
    return { dimensionId, rubricId, score, maxScore: 10, confidence: 'high', rationale: 'test', evidenceRefs: [] };
  }

  const makeSnapshot = (dims: object[]) => JSON.stringify({
    matrixId: 'test-matrix',
    subject: 'test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    rubricScores: [],
    categories: [],
    dimensions: dims,
  });

  it('emits diff report without writing to file', async () => {
    const lines: string[] = [];
    await rubricScoreDiff({
      before: '/tmp/before.json',
      after: '/tmp/after.json',
      _readFile: async (p) => {
        const score = p.includes('before') ? 5 : 7;
        return makeSnapshot([makeDimScore('test-dim', 'internal_optimistic', score)]);
      },
      _emit: (msg) => lines.push(msg),
    });
    assert.ok(lines.length > 0);
  });

  it('writes diff to file when out specified', async () => {
    let writtenPath = '';
    let writtenContent = '';
    await rubricScoreDiff({
      before: '/tmp/before.json',
      after: '/tmp/after.json',
      out: '/tmp/diff.md',
      _readFile: async (p) => {
        const score = p.includes('before') ? 5 : 8;
        return makeSnapshot([makeDimScore('test-dim', 'internal_optimistic', score)]);
      },
      _writeFile: async (p, d) => { writtenPath = p; writtenContent = d; },
      _emit: () => {},
    });
    assert.equal(writtenPath, '/tmp/diff.md');
    assert.ok(writtenContent.length > 0);
  });
});
