/**
 * Pass 38 - Canonical scoring source-of-truth.
 *
 * Two scoring systems coexist in DanteForge: the maturity engine (8 absolute dimensions,
 * 0-100, mapped to a Sketch-to-Enterprise-Grade level) and the harsh scorer (19 weighted
 * dimensions, 0-10). They share 8 underlying signals but produce different headlines because
 * they answer different questions. See docs/SCORING-DIVERGENCE.md for the full story.
 *
 * This file is the single source of truth for the 8 shared dimensions: their canonical
 * definitions, the question each one answers, the input signal, and a per-dimension
 * cross-checker that asserts both scorers see the same number for the same data.
 *
 * Both scorers should import CANONICAL_SHARED_DIMENSIONS from this module and verify their
 * inputs against it. A regression that drifts maturity vs harsh on one of the shared
 * dimensions will fail the cross-check and show up in CI.
 */

export type CanonicalSharedDimension =
  | 'functionality'
  | 'testing'
  | 'errorHandling'
  | 'security'
  | 'uxPolish'
  | 'documentation'
  | 'performance'
  | 'maintainability';

export interface CanonicalDimensionSpec {
  name: CanonicalSharedDimension;
  description: string;
  question: string;
  signal: string;
  range: [number, number];
}

export const CANONICAL_SHARED_DIMENSIONS: ReadonlyArray<CanonicalDimensionSpec> = [
  {
    name: 'functionality',
    description: 'PDSE artifact completeness + integration fitness.',
    question: 'Does the code do what its spec says?',
    signal: 'PDSE phase completion + largest fn without test',
    range: [0, 100],
  },
  {
    name: 'testing',
    description: 'Test coverage + test file count + c8rc config presence.',
    question: 'Is the code adequately tested?',
    signal: 'tests/**/*.test.ts count + coverage report',
    range: [0, 100],
  },
  {
    name: 'errorHandling',
    description: 'try/catch density + custom error classes + ratio to function count.',
    question: 'Does the code fail gracefully?',
    signal: 'AST scan + custom Error subclasses',
    range: [0, 100],
  },
  {
    name: 'security',
    description: 'Env-var usage + npm audit + dangerous-pattern detection.',
    question: 'Is the code secure to run?',
    signal: 'static-analysis rules + npm audit output',
    range: [0, 100],
  },
  {
    name: 'uxPolish',
    description: 'Loading states + accessibility markers + responsive design.',
    question: 'Is the UI polished?',
    signal: 'frontend code-walk',
    range: [0, 100],
  },
  {
    name: 'documentation',
    description: 'PDSE clarity + README freshness + per-script descriptions.',
    question: 'Can a new contributor onboard quickly?',
    signal: 'PDSE artifact presence + README + CONTRIBUTING + MAGIC-LEVELS',
    range: [0, 100],
  },
  {
    name: 'performance',
    description: 'Nested-loop detection + O(n^2) patterns + profiling presence.',
    question: 'Is the code fast enough?',
    signal: 'static-analysis + profiling artifacts',
    range: [0, 100],
  },
  {
    name: 'maintainability',
    description: 'PDSE testability + constitution presence + function-size discipline.',
    question: 'Can future contributors safely modify this code?',
    signal: 'AST function-size scan + CONSTITUTION.md',
    range: [0, 100],
  },
];

export interface DimensionAgreementCheck {
  dimension: CanonicalSharedDimension;
  maturityValue: number;
  harshValue: number;
  delta: number;
  withinTolerance: boolean;
}

export function checkDimensionAgreement(
  maturity: Record<CanonicalSharedDimension, number>,
  harsh: Record<CanonicalSharedDimension, number>,
  tolerance = 1,
): DimensionAgreementCheck[] {
  return CANONICAL_SHARED_DIMENSIONS.map(spec => {
    const maturityValue = maturity[spec.name];
    const harshValue = harsh[spec.name];
    const delta = Math.abs(maturityValue - harshValue);
    return {
      dimension: spec.name,
      maturityValue,
      harshValue,
      delta,
      withinTolerance: delta <= tolerance,
    };
  });
}

export function assertDimensionAgreement(
  maturity: Record<CanonicalSharedDimension, number>,
  harsh: Record<CanonicalSharedDimension, number>,
  tolerance = 1,
): void {
  const checks = checkDimensionAgreement(maturity, harsh, tolerance);
  const violations = checks.filter(c => !c.withinTolerance);
  if (violations.length > 0) {
    const lines = violations.map(v => `  ${v.dimension}: maturity=${v.maturityValue}, harsh=${v.harshValue}, delta=${v.delta} (tolerance ${tolerance})`);
    throw new Error(`Scoring divergence on ${violations.length} shared dimension(s):\n${lines.join('\n')}`);
  }
}
