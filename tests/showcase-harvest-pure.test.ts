import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseStudyMarkdown } from '../src/cli/commands/showcase.js';
import { parseCheckpointInput } from '../src/cli/commands/harvest-forge.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';

function makeDimRecord(val: number): Record<string, number> {
  return {
    functionality: val, testing: val, errorHandling: val, security: val,
    uxPolish: val, documentation: val, performance: val, maintainability: val,
    developerExperience: val, autonomy: val, planningQuality: val, selfImprovement: val,
    specDrivenPipeline: val, convergenceSelfHealing: val, tokenEconomy: val,
    ecosystemMcp: val, enterpriseReadiness: val, communityAdoption: val,
  };
}

function makeAssessment(): MaturityAssessment {
  return {
    currentLevel: 'mvp' as any,
    targetLevel: 'production' as any,
    overallScore: 60,
    dimensions: {
      functionality: 60, testing: 60, errorHandling: 60, security: 60,
      uxPolish: 40, documentation: 60, performance: 50, maintainability: 55,
    },
    gaps: [],
    founderExplanation: '',
    recommendation: 'proceed',
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

function makeScoreResult(overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  return {
    rawScore: 75,
    harshScore: 70,
    displayScore: 7.0,
    dimensions: makeDimRecord(70) as any,
    displayDimensions: makeDimRecord(7.0) as any,
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: makeAssessment(),
    timestamp: '2026-01-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildCaseStudyMarkdown', () => {
  it('includes project name in the header', () => {
    const result = makeScoreResult();
    const output = buildCaseStudyMarkdown('MyProject', '/path/to/project', result);
    assert.ok(output.includes('MyProject'));
  });

  it('shows the display score', () => {
    const result = makeScoreResult({ displayScore: 8.5 });
    const output = buildCaseStudyMarkdown('Test', '/path', result);
    assert.ok(output.includes('8.5'));
  });

  it('shows verdict label for "acceptable"', () => {
    const result = makeScoreResult({ verdict: 'acceptable' });
    const output = buildCaseStudyMarkdown('Test', '/path', result);
    assert.ok(output.includes('Acceptable'));
  });

  it('shows verdict label for "excellent"', () => {
    const result = makeScoreResult({ verdict: 'excellent' });
    const output = buildCaseStudyMarkdown('Test', '/path', result);
    assert.ok(output.includes('Excellent'));
  });

  it('shows verdict label for "needs-work"', () => {
    const result = makeScoreResult({ verdict: 'needs-work' });
    const output = buildCaseStudyMarkdown('Test', '/path', result);
    assert.ok(output.includes('Needs Work'));
  });

  it('shows fake completion risk', () => {
    const result = makeScoreResult({ fakeCompletionRisk: 'high' });
    const output = buildCaseStudyMarkdown('Test', '/path', result);
    assert.ok(output.includes('HIGH'));
  });

  it('includes penalties section when penalties are present', () => {
    const result = makeScoreResult({
      penalties: [{ category: 'stubs', reason: 'Stub found', deduction: 5, evidence: 'file.ts' }],
    });
    const output = buildCaseStudyMarkdown('Test', '/path', result);
    assert.ok(output.includes('Penalties Applied'));
    assert.ok(output.includes('Stub found'));
  });

  it('includes stubs section when stubs detected', () => {
    const result = makeScoreResult({ stubsDetected: ['src/core/foo.ts'] });
    const output = buildCaseStudyMarkdown('Test', '/path', result);
    assert.ok(output.includes('Stubs Detected'));
    assert.ok(output.includes('src/core/foo.ts'));
  });

  it('includes 18-Dimension Scorecard section', () => {
    const output = buildCaseStudyMarkdown('Test', '/path', makeScoreResult());
    assert.ok(output.includes('18-Dimension Scorecard'));
  });
});

describe('parseCheckpointInput', () => {
  it('returns [-1] for STOP', () => {
    assert.deepEqual(parseCheckpointInput('STOP', 5), [-1]);
  });

  it('returns [-1] for lowercase stop', () => {
    assert.deepEqual(parseCheckpointInput('stop', 5), [-1]);
  });

  it('returns [] for empty string (approve all)', () => {
    assert.deepEqual(parseCheckpointInput('', 5), []);
  });

  it('returns [] for APPROVE', () => {
    assert.deepEqual(parseCheckpointInput('APPROVE', 5), []);
  });

  it('parses SKIP with single index', () => {
    // "SKIP 1" means skip 0-based index 0
    const result = parseCheckpointInput('SKIP 1', 5);
    assert.deepEqual(result, [0]);
  });

  it('parses SKIP with multiple indices', () => {
    const result = parseCheckpointInput('SKIP 1 3', 5);
    assert.deepEqual(result, [0, 2]);
  });

  it('filters out-of-range skip indices', () => {
    // With count 3, skip index 10 (1-based 11) is out of range
    const result = parseCheckpointInput('SKIP 1 11', 3);
    assert.deepEqual(result, [0]);
  });

  it('returns [] for unrecognized input (treat as approve)', () => {
    const result = parseCheckpointInput('yes', 5);
    assert.deepEqual(result, []);
  });
});
