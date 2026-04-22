import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRawPrompt, generateProofReport } from '../src/core/proof-engine.js';
import type { ProofReport, RawPromptScore } from '../src/core/proof-engine.js';

function makeRawScore(overrides: Partial<RawPromptScore> = {}): RawPromptScore {
  return {
    completeness: 10,
    clarity: 10,
    testability: 10,
    contextDensity: 10,
    specificity: 5,
    freshness: 5,
    total: 50,
    breakdown: {},
    ...overrides,
  };
}

function makeProofReport(overrides: Partial<ProofReport> = {}): ProofReport {
  return {
    rawScore: makeRawScore(),
    pdseScore: 80,
    improvementPercent: 60,
    rawPrompt: 'Build a login page',
    artifactSummary: 'Found CONSTITUTION.md, SPEC.md (2/5 artifacts)',
    verdict: 'moderate',
    recommendation: 'Consider adding more artifacts.',
    ...overrides,
  };
}

describe('scoreRawPrompt', () => {
  it('returns a score object with all 6 dimension fields', () => {
    const result = scoreRawPrompt('Add a user login form with email and password validation');
    assert.ok(typeof result.completeness === 'number');
    assert.ok(typeof result.clarity === 'number');
    assert.ok(typeof result.testability === 'number');
    assert.ok(typeof result.contextDensity === 'number');
    assert.ok(typeof result.specificity === 'number');
    assert.ok(typeof result.freshness === 'number');
  });

  it('total equals sum of all dimension scores', () => {
    const result = scoreRawPrompt('Some prompt text');
    const expected = result.completeness + result.clarity + result.testability + result.contextDensity + result.specificity + result.freshness;
    assert.equal(result.total, expected);
  });

  it('scores empty prompt lower than rich prompt', () => {
    const emptyScore = scoreRawPrompt('');
    const richScore = scoreRawPrompt(
      'Implement JWT authentication with refresh tokens, unit tests, and TypeScript types. ' +
      'Include error handling for expired tokens, invalid signatures, and database connection failures. ' +
      'Use React for the frontend login form with form validation.'
    );
    assert.ok(richScore.total > emptyScore.total, `rich (${richScore.total}) should beat empty (${emptyScore.total})`);
  });

  it('has breakdown as an object', () => {
    const result = scoreRawPrompt('Build a database migration');
    assert.ok(typeof result.breakdown === 'object');
  });

  it('all dimension scores are non-negative', () => {
    const result = scoreRawPrompt('Some random text');
    assert.ok(result.completeness >= 0);
    assert.ok(result.clarity >= 0);
    assert.ok(result.testability >= 0);
    assert.ok(result.contextDensity >= 0);
    assert.ok(result.specificity >= 0);
    assert.ok(result.freshness >= 0);
  });
});

describe('generateProofReport', () => {
  it('includes "DanteForge Proof of Value" header', () => {
    const report = makeProofReport();
    const output = generateProofReport(report);
    assert.ok(output.includes('DanteForge Proof of Value'));
  });

  it('shows raw score total', () => {
    const report = makeProofReport({ rawScore: makeRawScore({ total: 42 }) });
    const output = generateProofReport(report);
    assert.ok(output.includes('42/100'));
  });

  it('shows pdse score', () => {
    const report = makeProofReport({ pdseScore: 88 });
    const output = generateProofReport(report);
    assert.ok(output.includes('88/100'));
  });

  it('shows verdict for strong improvement', () => {
    const report = makeProofReport({ verdict: 'strong', improvementPercent: 250 });
    const output = generateProofReport(report);
    assert.ok(output.includes('✓ DanteForge significantly improves'));
  });

  it('shows verdict for moderate improvement', () => {
    const report = makeProofReport({ verdict: 'moderate', improvementPercent: 80 });
    const output = generateProofReport(report);
    assert.ok(output.includes('~ DanteForge moderately improves'));
  });

  it('shows verdict for weak improvement', () => {
    const report = makeProofReport({ verdict: 'weak', improvementPercent: 10 });
    const output = generateProofReport(report);
    assert.ok(output.includes('✗ DanteForge provides minimal improvement'));
  });

  it('shows improvement percent with sign', () => {
    const report = makeProofReport({ improvementPercent: 75 });
    const output = generateProofReport(report);
    assert.ok(output.includes('+75%'));
  });

  it('shows recommendation text', () => {
    const report = makeProofReport({ recommendation: 'Add more artifacts now.' });
    const output = generateProofReport(report);
    assert.ok(output.includes('Add more artifacts now.'));
  });
});
