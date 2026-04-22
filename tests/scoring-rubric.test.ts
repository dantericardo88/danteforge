// tests/scoring-rubric.test.ts — Fixture-based rubric divergence proofs
// PRD AC5: At least five representative dimensions prove rubric differences are intentional.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDimension } from '../src/scoring/score-dimension.js';
import type { EvidenceRecord, DimensionDefinition } from '../src/scoring/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDim(id: string, overrides: Partial<DimensionDefinition> = {}): DimensionDefinition {
  return {
    id,
    name: id,
    category: 'Test',
    maxScore: 10,
    description: 'test dimension',
    requiredEvidenceTypes: ['code', 'test'],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    dimensionId: 'security',
    evidenceType: 'code',
    sourceKind: 'file',
    sourceRef: 'src/core/security.ts',
    summary: 'Input sanitization present',
    strength: 'moderate',
    status: 'present',
    userVisible: true,
    mainPathWired: true,
    tested: true,
    endToEndProven: false,
    benchmarkBacked: false,
    ...overrides,
  };
}

// ── Fixture 1: security — partial implementation ──────────────────────────────
// PRD AC5: internal > public when proof is partial
// PRD AC5: public > hostile when end-to-end proof is absent

describe('security fixture', () => {
  const dim = makeDim('security', {
    requiredEvidenceTypes: ['code', 'test', 'manual_verification'],
    hardCeiling: 9,
  });

  const partialEvidence: EvidenceRecord[] = [
    makeEvidence({
      dimensionId: 'security',
      status: 'partial',
      mainPathWired: true,
      userVisible: true,
      tested: true,
      endToEndProven: false,
      benchmarkBacked: false,
    }),
  ];

  it('internal_optimistic > public_defensible when end-to-end absent', () => {
    const internal = scoreDimension(partialEvidence, dim, 'internal_optimistic');
    const pub = scoreDimension(partialEvidence, dim, 'public_defensible');
    assert.ok(internal.score > pub.score, `internal=${internal.score} should > public=${pub.score}`);
  });

  it('public_defensible > hostile_diligence when end-to-end absent', () => {
    const pub = scoreDimension(partialEvidence, dim, 'public_defensible');
    const hostile = scoreDimension(partialEvidence, dim, 'hostile_diligence');
    assert.ok(pub.score > hostile.score, `public=${pub.score} should > hostile=${hostile.score}`);
  });

  it('hostile caps at 4.5 without end-to-end', () => {
    const hostile = scoreDimension(partialEvidence, dim, 'hostile_diligence');
    assert.ok(hostile.score <= 4.5, `hostile=${hostile.score} should <= 4.5 without e2e`);
  });

  it('all three rubrics produce nextLift explanation', () => {
    for (const rubricId of ['internal_optimistic', 'public_defensible', 'hostile_diligence'] as const) {
      const result = scoreDimension(partialEvidence, dim, rubricId);
      assert.ok(result.nextLift || result.score >= dim.maxScore - 0.5, `${rubricId} missing nextLift`);
    }
  });
});

// ── Fixture 2: autonomy — with end-to-end proof ───────────────────────────────
// Full proof: all flags set. Scores should be higher but still diverge.

describe('autonomy fixture — full proof', () => {
  const dim = makeDim('autonomy', { hardCeiling: 8 });

  const fullEvidence: EvidenceRecord[] = [
    makeEvidence({
      dimensionId: 'autonomy',
      evidenceType: 'test',
      sourceKind: 'test_file',
      sourceRef: 'tests/ascend-engine.test.ts',
      strength: 'strong',
      status: 'present',
      userVisible: true,
      mainPathWired: true,
      tested: true,
      endToEndProven: true,
      benchmarkBacked: false,
    }),
  ];

  it('internal score is higher than hostile when no benchmark', () => {
    const internal = scoreDimension(fullEvidence, dim, 'internal_optimistic');
    const hostile = scoreDimension(fullEvidence, dim, 'hostile_diligence');
    assert.ok(internal.score >= hostile.score, `internal=${internal.score} should >= hostile=${hostile.score}`);
  });

  it('hard ceiling applied — none exceed 8', () => {
    for (const rubricId of ['internal_optimistic', 'public_defensible', 'hostile_diligence'] as const) {
      const result = scoreDimension(fullEvidence, dim, rubricId);
      assert.ok(result.score <= 8, `${rubricId} score=${result.score} exceeds hardCeiling=8`);
    }
  });

  it('hostile confidence is medium (e2e but no benchmark)', () => {
    const hostile = scoreDimension(fullEvidence, dim, 'hostile_diligence');
    assert.equal(hostile.confidence, 'medium');
  });
});

// ── Fixture 3: swe_bench — benchmark-backed ───────────────────────────────────
// Benchmark present should lift hostile score significantly.

describe('swe_bench fixture — benchmark backed', () => {
  const dim = makeDim('swe_bench', {
    requiredEvidenceTypes: ['code', 'test', 'benchmark'],
  });

  const withBenchmark: EvidenceRecord[] = [
    makeEvidence({
      dimensionId: 'swe_bench',
      evidenceType: 'benchmark',
      sourceKind: 'command_output',
      sourceRef: '.danteforge/benchmarks/swe-bench-run.json',
      strength: 'strong',
      status: 'present',
      userVisible: true,
      mainPathWired: true,
      tested: true,
      endToEndProven: true,
      benchmarkBacked: true,
    }),
  ];

  const withoutBenchmark: EvidenceRecord[] = [
    makeEvidence({
      dimensionId: 'swe_bench',
      evidenceType: 'code',
      strength: 'moderate',
      status: 'present',
      userVisible: true,
      mainPathWired: true,
      tested: true,
      endToEndProven: true,
      benchmarkBacked: false,
    }),
  ];

  it('hostile score higher with benchmark than without', () => {
    const withB = scoreDimension(withBenchmark, dim, 'hostile_diligence');
    const withoutB = scoreDimension(withoutBenchmark, dim, 'hostile_diligence');
    assert.ok(withB.score > withoutB.score, `with_benchmark=${withB.score} should > without=${withoutB.score}`);
  });

  it('benchmark brings hostile confidence to high', () => {
    const result = scoreDimension(withBenchmark, dim, 'hostile_diligence');
    assert.equal(result.confidence, 'high');
  });
});

// ── Fixture 4: enterprise — code-only, not user-visible ───────────────────────
// Code exists but not in main path. Public/hostile should be very low.

describe('enterprise fixture — code-only, not user-visible', () => {
  const dim = makeDim('enterprise', {
    requiredEvidenceTypes: ['code', 'doc', 'external_source'],
    hardCeiling: 7,
  });

  const codeOnlyEvidence: EvidenceRecord[] = [
    makeEvidence({
      dimensionId: 'enterprise',
      evidenceType: 'code',
      sourceRef: 'src/core/audit.ts',
      strength: 'weak',
      status: 'partial',
      userVisible: false,
      mainPathWired: false,
      tested: false,
      endToEndProven: false,
      benchmarkBacked: false,
    }),
  ];

  it('internal gives partial credit, public and hostile give 0', () => {
    const internal = scoreDimension(codeOnlyEvidence, dim, 'internal_optimistic');
    const pub = scoreDimension(codeOnlyEvidence, dim, 'public_defensible');
    const hostile = scoreDimension(codeOnlyEvidence, dim, 'hostile_diligence');
    assert.ok(internal.score > 0, 'internal should give some credit for existing code');
    assert.equal(pub.score, 0, 'public should be 0 without main-path wiring');
    assert.equal(hostile.score, 0, 'hostile should be 0 without main-path wiring');
  });

  it('all rubrics include a nextLift hint', () => {
    for (const rubricId of ['internal_optimistic', 'public_defensible', 'hostile_diligence'] as const) {
      const result = scoreDimension(codeOnlyEvidence, dim, rubricId);
      assert.ok(typeof result.nextLift === 'string', `${rubricId} should have nextLift`);
    }
  });
});

// ── Fixture 5: approval_workflow — missing entirely ───────────────────────────
// No evidence at all. All rubrics should score 0 with low confidence.

describe('approval_workflow fixture — no evidence', () => {
  const dim = makeDim('approval_workflow');

  it('all rubrics score 0 with no evidence', () => {
    for (const rubricId of ['internal_optimistic', 'public_defensible', 'hostile_diligence'] as const) {
      const result = scoreDimension([], dim, rubricId);
      assert.equal(result.score, 0, `${rubricId} should be 0 with no evidence`);
    }
  });

  it('confidence is low with no evidence', () => {
    for (const rubricId of ['internal_optimistic', 'public_defensible', 'hostile_diligence'] as const) {
      const result = scoreDimension([], dim, rubricId);
      assert.equal(result.confidence, 'low');
    }
  });

  it('evidence refs are empty', () => {
    const result = scoreDimension([], dim, 'hostile_diligence');
    assert.deepEqual(result.evidenceRefs, []);
  });
});

// ── Fixture 6: cost_optimization — unit tests only ───────────────────────────
// Tests exist but not end-to-end. PRD explicitly calls this out.

describe('cost_optimization fixture — unit tests only', () => {
  const dim = makeDim('cost_optimization');

  const unitTestEvidence: EvidenceRecord[] = [
    makeEvidence({
      dimensionId: 'cost_optimization',
      evidenceType: 'test',
      sourceKind: 'test_file',
      sourceRef: 'tests/cost.test.ts',
      strength: 'moderate',
      status: 'present',
      userVisible: false,
      mainPathWired: true,
      tested: true,
      endToEndProven: false,
      benchmarkBacked: false,
    }),
  ];

  it('hostile caps below 5 without e2e proof', () => {
    const hostile = scoreDimension(unitTestEvidence, dim, 'hostile_diligence');
    assert.ok(hostile.score < 5, `hostile=${hostile.score} should < 5 — unit tests are table stakes`);
  });

  it('internal > hostile (partial credit for tests)', () => {
    const internal = scoreDimension(unitTestEvidence, dim, 'internal_optimistic');
    const hostile = scoreDimension(unitTestEvidence, dim, 'hostile_diligence');
    assert.ok(internal.score > hostile.score);
  });
});

// ── Rubric spread invariant ───────────────────────────────────────────────────

describe('rubric spread invariant', () => {
  it('internal_optimistic >= public_defensible >= hostile_diligence for any evidence', () => {
    const dim = makeDim('invariant_test');
    const evidence = [
      makeEvidence({
        dimensionId: 'invariant_test',
        status: 'present',
        mainPathWired: true,
        userVisible: true,
        tested: true,
        endToEndProven: false,
        benchmarkBacked: false,
        strength: 'moderate',
      }),
    ];

    const internal = scoreDimension(evidence, dim, 'internal_optimistic');
    const pub = scoreDimension(evidence, dim, 'public_defensible');
    const hostile = scoreDimension(evidence, dim, 'hostile_diligence');

    assert.ok(
      internal.score >= pub.score,
      `invariant violated: internal(${internal.score}) < public(${pub.score})`,
    );
    assert.ok(
      pub.score >= hostile.score,
      `invariant violated: public(${pub.score}) < hostile(${hostile.score})`,
    );
  });
});
