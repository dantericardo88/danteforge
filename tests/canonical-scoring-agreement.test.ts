// Pass 38 — assert that maturity engine and harsh scorer agree on the 8 shared dimensions.
// This test catches scoring drift that would otherwise produce a confusing 95/100 vs 9.3/10
// split where the underlying signals disagree silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_SHARED_DIMENSIONS,
  checkDimensionAgreement,
  assertDimensionAgreement,
  type CanonicalSharedDimension,
} from '../src/core/scoring/canonical-dimensions.js';

test('Pass 38 — canonical dimensions list has 8 entries (the shared core)', () => {
  assert.equal(CANONICAL_SHARED_DIMENSIONS.length, 8);
  const names = CANONICAL_SHARED_DIMENSIONS.map(d => d.name);
  assert.deepEqual(
    [...names].sort(),
    ['documentation', 'errorHandling', 'functionality', 'maintainability', 'performance', 'security', 'testing', 'uxPolish'],
  );
});

test('Pass 38 — checkDimensionAgreement: identical inputs all-clear', () => {
  const m: Record<CanonicalSharedDimension, number> = {
    functionality: 91, testing: 100, errorHandling: 100, security: 95,
    uxPolish: 100, documentation: 100, performance: 90, maintainability: 88,
  };
  const checks = checkDimensionAgreement(m, m);
  assert.equal(checks.every(c => c.withinTolerance), true);
  assert.equal(checks.every(c => c.delta === 0), true);
});

test('Pass 38 — checkDimensionAgreement: small delta within tolerance', () => {
  const maturity: Record<CanonicalSharedDimension, number> = {
    functionality: 91, testing: 100, errorHandling: 100, security: 95,
    uxPolish: 100, documentation: 100, performance: 90, maintainability: 88,
  };
  const harsh: Record<CanonicalSharedDimension, number> = {
    functionality: 91.5, testing: 99.5, errorHandling: 100, security: 95,
    uxPolish: 100, documentation: 100, performance: 90, maintainability: 88.5,
  };
  const checks = checkDimensionAgreement(maturity, harsh, 1);
  assert.equal(checks.every(c => c.withinTolerance), true);
});

test('Pass 38 — checkDimensionAgreement: large delta flagged', () => {
  const maturity: Record<CanonicalSharedDimension, number> = {
    functionality: 91, testing: 100, errorHandling: 100, security: 95,
    uxPolish: 100, documentation: 100, performance: 90, maintainability: 88,
  };
  const harsh: Record<CanonicalSharedDimension, number> = {
    functionality: 75, // <-- 16-point divergence
    testing: 100, errorHandling: 100, security: 95,
    uxPolish: 100, documentation: 100, performance: 90, maintainability: 88,
  };
  const checks = checkDimensionAgreement(maturity, harsh, 1);
  const violators = checks.filter(c => !c.withinTolerance);
  assert.equal(violators.length, 1);
  assert.equal(violators[0]!.dimension, 'functionality');
  assert.equal(violators[0]!.delta, 16);
});

test('Pass 38 — assertDimensionAgreement throws on divergence with helpful message', () => {
  const maturity: Record<CanonicalSharedDimension, number> = {
    functionality: 91, testing: 100, errorHandling: 100, security: 95,
    uxPolish: 100, documentation: 100, performance: 90, maintainability: 88,
  };
  const harsh: Record<CanonicalSharedDimension, number> = {
    ...maturity, performance: 70,
  };
  assert.throws(() => assertDimensionAgreement(maturity, harsh, 1), /performance.+maturity=90.+harsh=70/);
});

test('Pass 38 — every canonical dimension has the four required spec fields', () => {
  for (const dim of CANONICAL_SHARED_DIMENSIONS) {
    assert.ok(dim.name, `${JSON.stringify(dim)} missing name`);
    assert.ok(dim.description.length > 0, `${dim.name} missing description`);
    assert.ok(dim.question.length > 0, `${dim.name} missing question`);
    assert.ok(dim.signal.length > 0, `${dim.name} missing signal`);
    assert.equal(dim.range[0], 0);
    assert.equal(dim.range[1], 100);
  }
});

test('Pass 38 — live agreement: harsh-scorer dims match maturity dims for current repo state', async () => {
  // computeHarshScore wraps the maturity assessment + the strategic scorer in one call.
  // The shared 8 dimensions live in `harshResult.maturityAssessment.dimensions` (the maturity
  // view) and `harshResult.displayDimensions.<name>` (the harsh view, scaled to 0-10).
  const { computeHarshScore } = await import('../src/core/harsh-scorer.js');
  const cwd = process.cwd();
  const harshResult = await computeHarshScore({
    cwd,
    _readHistory: async () => [],
    _writeHistory: async () => {},
    _fetchCommunity: async () => ({}),
  });
  const maturity = harshResult.maturityAssessment.dimensions;
  const harshDisplay = harshResult.displayDimensions;
  const harsh: Record<CanonicalSharedDimension, number> = {
    functionality: (harshDisplay.functionality ?? 0) * 10,
    testing: (harshDisplay.testing ?? 0) * 10,
    errorHandling: (harshDisplay.errorHandling ?? 0) * 10,
    security: (harshDisplay.security ?? 0) * 10,
    uxPolish: (harshDisplay.uxPolish ?? 0) * 10,
    documentation: (harshDisplay.documentation ?? 0) * 10,
    performance: (harshDisplay.performance ?? 0) * 10,
    maintainability: (harshDisplay.maintainability ?? 0) * 10,
  };
  // Tolerance 10: harsh-scorer applies bonuses + penalties + ceilings on top of the raw maturity
  // signal (e.g., functionality gets a -10 if no integration tests). We allow up to 10 points
  // of divergence to account for those scorer-specific adjustments. Beyond that = real drift.
  const checks = checkDimensionAgreement(maturity, harsh, 10);
  const violations = checks.filter(c => !c.withinTolerance);
  if (violations.length > 0) {
    console.log('Scoring divergence detected (tolerance=10):');
    for (const v of violations) {
      console.log(`  ${v.dimension}: maturity=${v.maturityValue}, harsh=${v.harshValue}, delta=${v.delta}`);
    }
  }
  assert.equal(violations.length, 0,
    `Scoring drift on ${violations.length} dimension(s); see console output above`);
});
