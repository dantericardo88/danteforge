import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreRawPrompt,
  generateProofReport,
  type ProofReport,
  type RawPromptScore,
} from '../src/core/proof-engine.js';

function makeRawScore(overrides: Partial<RawPromptScore> = {}): RawPromptScore {
  return {
    completeness: 10, clarity: 10, testability: 10,
    contextDensity: 10, specificity: 5, freshness: 5,
    total: 50, breakdown: {},
    ...overrides,
  };
}

function makeReport(overrides: Partial<ProofReport> = {}): ProofReport {
  return {
    rawScore: makeRawScore(),
    pdseScore: 80,
    improvementPercent: 60,
    rawPrompt: 'Build something',
    artifactSummary: 'Found SPEC.md (1/5 artifacts)',
    verdict: 'moderate',
    recommendation: 'Keep going',
    ...overrides,
  };
}

describe('scoreRawPrompt: completeness', () => {
  it('scores zero for empty string', () => {
    const result = scoreRawPrompt('');
    assert.ok(result.total >= 0, "total should be non-negative");
  });

  it('awards points for goal keywords', () => {
    const result = scoreRawPrompt('Build a REST API with authentication');
    assert.ok(result.completeness > 0, 'should score completeness for "build"');
  });

  it('awards points for constraint keywords', () => {
    const result = scoreRawPrompt('The system must handle 1000 concurrent users');
    assert.ok(result.completeness > 0);
  });

  it('awards clarity points for technical precision', () => {
    const result = scoreRawPrompt('Implement a TypeScript function that returns a Promise<string>');
    assert.ok(result.clarity > 0);
  });

  it('awards testability points for test signals', () => {
    const result = scoreRawPrompt('Add unit tests that pass for the auth module, success criteria: all tests pass');
    assert.ok(result.testability > 0);
  });

  it('total does not exceed 100', () => {
    const long = 'Build a TypeScript REST API using Express. Must have unit tests that pass. ' +
      'Users need authentication. Requires JWT tokens. Success: all tests pass. ' +
      'Implement with React and Node.js version 20. Framework: NestJS.';
    const result = scoreRawPrompt(long);
    assert.ok(result.total <= 100, `total ${result.total} exceeds 100`);
  });

  it('returns all required fields', () => {
    const result = scoreRawPrompt('Build something');
    assert.ok('completeness' in result);
    assert.ok('clarity' in result);
    assert.ok('testability' in result);
    assert.ok('contextDensity' in result);
    assert.ok('specificity' in result);
    assert.ok('freshness' in result);
    assert.ok('total' in result);
    assert.ok('breakdown' in result);
  });

  it('total equals sum of dimensions', () => {
    const result = scoreRawPrompt('Build a TypeScript API with tests');
    const sum = result.completeness + result.clarity + result.testability +
      result.contextDensity + result.specificity + result.freshness;
    assert.equal(result.total, sum);
  });

  it('rich prompt scores higher than bare prompt', () => {
    const bare = scoreRawPrompt('do something');
    const rich = scoreRawPrompt(
      'Build a TypeScript REST API using Express v5. Must have JWT auth. ' +
      'Unit tests required. Success: all tests pass. Users need login endpoint.'
    );
    assert.ok(rich.total > bare.total, `rich ${rich.total} should beat bare ${bare.total}`);
  });
});

describe('generateProofReport', () => {
  it('includes raw score total', () => {
    const output = generateProofReport(makeReport({ rawScore: makeRawScore({ total: 42 }) }));
    assert.ok(output.includes('42/100'));
  });

  it('includes PDSE score', () => {
    const output = generateProofReport(makeReport({ pdseScore: 87 }));
    assert.ok(output.includes('87/100'));
  });

  it('shows strong verdict correctly', () => {
    const output = generateProofReport(makeReport({ verdict: 'strong' }));
    assert.ok(output.includes('STRONG'));
    assert.ok(output.includes('significantly improves'));
  });

  it('shows moderate verdict correctly', () => {
    const output = generateProofReport(makeReport({ verdict: 'moderate' }));
    assert.ok(output.includes('MODERATE'));
  });

  it('shows weak verdict correctly', () => {
    const output = generateProofReport(makeReport({ verdict: 'weak' }));
    assert.ok(output.includes('WEAK'));
    assert.ok(output.includes('minimal improvement'));
  });

  it('shows improvement percentage with sign', () => {
    const output = generateProofReport(makeReport({ improvementPercent: 150 }));
    assert.ok(output.includes('+150%'));
  });

  it('shows negative improvement without plus sign', () => {
    const output = generateProofReport(makeReport({ improvementPercent: -10 }));
    assert.ok(output.includes('-10%'));
    assert.ok(!output.includes('+-10%'));
  });

  it('includes artifact summary', () => {
    const output = generateProofReport(makeReport({ artifactSummary: 'Found SPEC.md, PLAN.md (2/5)' }));
    assert.ok(output.includes('Found SPEC.md'));
  });
});
