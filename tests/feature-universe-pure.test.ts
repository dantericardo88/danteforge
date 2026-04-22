import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeatureLines, formatFeatureUniverseReport } from '../src/core/feature-universe.js';
import type { FeatureUniverseAssessment, FeatureItem, FeatureScore, FeatureUniverse } from '../src/core/feature-universe.js';

function makeItem(id: string, overrides: Partial<FeatureItem> = {}): FeatureItem {
  return {
    id,
    name: `Feature ${id}`,
    description: `Description for ${id}`,
    category: 'execution',
    competitorsThatHaveIt: [],
    ...overrides,
  };
}

function makeUniverse(features: FeatureItem[]): FeatureUniverse {
  return {
    features,
    competitors: ['alpha', 'beta'],
    generatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    sourceDescription: 'Derived from 2 competitor analysis',
  };
}

function makeAssessment(overrides: Partial<FeatureUniverseAssessment> = {}): FeatureUniverseAssessment {
  const features = [makeItem('feat-001', { category: 'planning' })];
  return {
    universe: makeUniverse(features),
    scores: [{ featureId: 'feat-001', featureName: 'Feature feat-001', score: 8, evidence: 'found in src/', verdict: 'implemented' }],
    overallScore: 8.0,
    implementedCount: 1,
    partialCount: 0,
    missingCount: 0,
    coveragePercent: 100,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parseFeatureLines', () => {
  it('returns empty array for empty string', () => {
    const result = parseFeatureLines('');
    assert.deepEqual(result, []);
  });

  it('parses valid FEATURE| lines', () => {
    const response = [
      'FEATURE|planning|Spec validation|Validates spec completeness',
      'FEATURE|execution|Wave runner|Executes waves in parallel',
    ].join('\n');
    const result = parseFeatureLines(response);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'Spec validation');
    assert.equal(result[0].category, 'planning');
    assert.equal(result[1].name, 'Wave runner');
    assert.equal(result[1].category, 'execution');
  });

  it('skips lines not starting with FEATURE|', () => {
    const response = 'Some text\nFEATURE|quality|Test coverage|Tracks code coverage\nMore text';
    const result = parseFeatureLines(response);
    assert.equal(result.length, 1);
  });

  it('skips lines with fewer than 4 pipe segments', () => {
    const response = 'FEATURE|planning|Short';
    const result = parseFeatureLines(response);
    assert.equal(result.length, 0);
  });

  it('defaults unknown categories to "other"', () => {
    const response = 'FEATURE|unknowncategory|My Feature|My description';
    const result = parseFeatureLines(response);
    assert.equal(result.length, 1);
    assert.equal(result[0].category, 'other');
  });

  it('assigns sequential ids starting from feat-001', () => {
    const response = [
      'FEATURE|dx|Feature A|Desc A',
      'FEATURE|dx|Feature B|Desc B',
    ].join('\n');
    const result = parseFeatureLines(response);
    assert.equal(result[0].id, 'feat-001');
    assert.equal(result[1].id, 'feat-002');
  });

  it('passes defaultCompetitors to each feature', () => {
    const response = 'FEATURE|autonomy|Auto feature|Auto description';
    const result = parseFeatureLines(response, ['gpt-engineer', 'devin']);
    assert.deepEqual(result[0].competitorsThatHaveIt, ['gpt-engineer', 'devin']);
  });

  it('extracts bestImplementationHint from extra pipe segments', () => {
    const response = 'FEATURE|quality|Some feature|Good description|Achieved via X pattern';
    const result = parseFeatureLines(response);
    assert.equal(result[0].bestImplementationHint, 'Achieved via X pattern');
  });
});

describe('formatFeatureUniverseReport', () => {
  it('includes "Feature Universe Report" header', () => {
    const assessment = makeAssessment();
    const output = formatFeatureUniverseReport(assessment, { minScore: 7, featureCoverage: 80 });
    assert.ok(output.includes('Feature Universe Report'));
  });

  it('shows overall score and target', () => {
    const assessment = makeAssessment({ overallScore: 7.5 });
    const output = formatFeatureUniverseReport(assessment, { minScore: 8, featureCoverage: 85 });
    assert.ok(output.includes('7.5/10'));
    assert.ok(output.includes('8.0'));
  });

  it('shows coverage percent', () => {
    const assessment = makeAssessment({ coveragePercent: 75 });
    const output = formatFeatureUniverseReport(assessment, { minScore: 7, featureCoverage: 80 });
    assert.ok(output.includes('75%'));
  });

  it('shows implemented/partial/missing counts', () => {
    const assessment = makeAssessment({ implementedCount: 5, partialCount: 2, missingCount: 3 });
    const output = formatFeatureUniverseReport(assessment, { minScore: 7, featureCoverage: 70 });
    assert.ok(output.includes('5 implemented'));
    assert.ok(output.includes('2 partial'));
    assert.ok(output.includes('3 missing'));
  });

  it('uses ✓ for high-scoring features (>= 7)', () => {
    const assessment = makeAssessment({
      scores: [{ featureId: 'feat-001', featureName: 'Feature feat-001', score: 9, evidence: '', verdict: 'implemented' }],
    });
    const output = formatFeatureUniverseReport(assessment, { minScore: 7, featureCoverage: 80 });
    assert.ok(output.includes('✓'));
  });

  it('uses ✗ for low-scoring features (< 4)', () => {
    const feature = makeItem('feat-001', { category: 'quality' });
    const assessment = makeAssessment({
      universe: makeUniverse([feature]),
      scores: [{ featureId: 'feat-001', featureName: 'Feature feat-001', score: 2, evidence: '', verdict: 'missing' }],
    });
    const output = formatFeatureUniverseReport(assessment, { minScore: 7, featureCoverage: 80 });
    assert.ok(output.includes('✗'));
  });
});
