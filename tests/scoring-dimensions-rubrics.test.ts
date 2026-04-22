import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DIMENSIONS_28, getDimension, getDimensionsByCategory, getCategories } from '../src/scoring/dimensions.js';
import { RUBRICS, ALL_RUBRIC_IDS, getRubric } from '../src/scoring/rubrics.js';
import { scoreDimension, scoreAllDimensions } from '../src/scoring/score-dimension.js';
import type { EvidenceRecord } from '../src/scoring/types.js';

function makeEvidence(dimensionId: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    dimensionId,
    sourceRef: 'test-ref',
    evidenceType: 'claim',
    content: 'Test evidence content',
    confidence: 'high',
    ...overrides,
  };
}

describe('DIMENSIONS_28', () => {
  it('has at least 10 dimensions', () => {
    assert.ok(DIMENSIONS_28.length >= 10);
  });

  it('all dimensions have valid maxScore > 0', () => {
    for (const dim of DIMENSIONS_28) {
      assert.ok(dim.maxScore > 0, `${dim.id} has maxScore ${dim.maxScore}`);
    }
  });

  it('all dimensions have a category', () => {
    for (const dim of DIMENSIONS_28) {
      assert.ok(typeof dim.category === 'string' && dim.category.length > 0, `${dim.id} missing category`);
    }
  });

  it('all dimensions have requiredEvidenceTypes array', () => {
    for (const dim of DIMENSIONS_28) {
      assert.ok(Array.isArray(dim.requiredEvidenceTypes), `${dim.id} missing requiredEvidenceTypes`);
    }
  });
});

describe('getDimension', () => {
  it('finds a known dimension by id', () => {
    const id = DIMENSIONS_28[0].id;
    const dim = getDimension(id);
    assert.ok(dim !== undefined);
    assert.equal(dim!.id, id);
  });

  it('returns undefined for unknown id', () => {
    assert.equal(getDimension('__nonexistent__'), undefined);
  });
});

describe('getDimensionsByCategory', () => {
  it('returns a Map', () => {
    const map = getDimensionsByCategory();
    assert.ok(map instanceof Map);
  });

  it('all DIMENSIONS_28 appear in exactly one category', () => {
    const map = getDimensionsByCategory();
    const allDims = [...map.values()].flat();
    assert.equal(allDims.length, DIMENSIONS_28.length);
  });
});

describe('getCategories', () => {
  it('returns an array of unique category strings', () => {
    const cats = getCategories();
    assert.ok(Array.isArray(cats) && cats.length > 0);
    const unique = new Set(cats);
    assert.equal(unique.size, cats.length);
  });
});

describe('RUBRICS and ALL_RUBRIC_IDS', () => {
  it('ALL_RUBRIC_IDS is a non-empty array', () => {
    assert.ok(Array.isArray(ALL_RUBRIC_IDS) && ALL_RUBRIC_IDS.length > 0);
  });

  it('each rubric ID exists in RUBRICS', () => {
    for (const id of ALL_RUBRIC_IDS) {
      assert.ok(id in RUBRICS, `rubric ${id} not in RUBRICS`);
    }
  });

  it('getRubric returns a rubric policy with score function', () => {
    const rubric = getRubric(ALL_RUBRIC_IDS[0]);
    assert.ok(typeof rubric.score === 'function');
  });
});

describe('scoreDimension', () => {
  it('returns a DimensionScore with expected fields', () => {
    const dim = DIMENSIONS_28[0];
    const result = scoreDimension([], dim, ALL_RUBRIC_IDS[0]);
    assert.equal(result.dimensionId, dim.id);
    assert.equal(result.rubricId, ALL_RUBRIC_IDS[0]);
    assert.ok(typeof result.score === 'number');
    assert.ok(typeof result.maxScore === 'number');
    assert.ok(typeof result.confidence === 'string');
    assert.ok(typeof result.rationale === 'string');
    assert.ok(Array.isArray(result.evidenceRefs));
  });

  it('score is between 0 and maxScore', () => {
    const dim = DIMENSIONS_28[0];
    const result = scoreDimension([], dim, ALL_RUBRIC_IDS[0]);
    assert.ok(result.score >= 0);
    assert.ok(result.score <= result.maxScore);
  });

  it('includes evidence refs from matching evidence', () => {
    const dim = DIMENSIONS_28[0];
    const evidence = [makeEvidence(dim.id, { sourceRef: 'ref-001' })];
    const result = scoreDimension(evidence, dim, ALL_RUBRIC_IDS[0]);
    assert.ok(result.evidenceRefs.includes('ref-001'));
  });

  it('excludes evidence refs from other dimensions', () => {
    const dim = DIMENSIONS_28[0];
    const evidence = [makeEvidence('__other_dim__', { sourceRef: 'other-ref' })];
    const result = scoreDimension(evidence, dim, ALL_RUBRIC_IDS[0]);
    assert.ok(!result.evidenceRefs.includes('other-ref'));
  });
});

describe('scoreAllDimensions', () => {
  it('returns one score per dimension per rubric', () => {
    const dims = DIMENSIONS_28.slice(0, 3);
    const rubrics = ALL_RUBRIC_IDS.slice(0, 2);
    const results = scoreAllDimensions([], dims, rubrics);
    assert.equal(results.length, dims.length * rubrics.length);
  });

  it('returns empty array for empty inputs', () => {
    const results = scoreAllDimensions([], [], []);
    assert.deepEqual(results, []);
  });

  it('each score has valid dimensionId and rubricId', () => {
    const dims = DIMENSIONS_28.slice(0, 2);
    const rubrics = ALL_RUBRIC_IDS.slice(0, 1);
    const results = scoreAllDimensions([], dims, rubrics);
    for (const r of results) {
      assert.ok(dims.some(d => d.id === r.dimensionId));
      assert.ok(rubrics.includes(r.rubricId));
    }
  });
});
