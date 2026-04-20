// src/scoring/rubrics.ts — Three rubric policy implementations

import type { RubricPolicy, RubricId, Confidence, DimensionDefinition } from './types.js';
import { assessEvidence, type EvidenceAssessment } from './evidence.js';
import type { EvidenceRecord } from './types.js';

// ── Shared scoring math ───────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function deriveConfidence(a: EvidenceAssessment, baseScore: number): Confidence {
  if (!a.hasAnyPresent || a.totalCount === 0) return 'low';
  if (baseScore >= 7 && a.hasEndToEnd && a.hasTested) return 'high';
  if (baseScore >= 5 && (a.hasTested || a.hasMainPathWired)) return 'medium';
  return 'low';
}

// ── internal_optimistic ───────────────────────────────────────────────────────
// Credit: code + tests + product direction. Partial credit for incomplete wiring.
// Missing benchmarks don't zero-out. Infrastructure that reduces future work gets credit.

function scoreInternalOptimistic(
  a: EvidenceAssessment,
  dim: DimensionDefinition,
): { score: number; rationale: string; nextLift?: string } {
  if (!a.hasAnyPresent) {
    return {
      score: 0,
      rationale: 'No evidence present — dimension not implemented.',
      nextLift: 'Add any code or documentation record to start earning credit.',
    };
  }

  let score = 1.0; // base: something exists

  // +2.0 for main-path wiring
  if (a.hasMainPathWired) score += 2.0;
  else if (a.presentCount > 0) score += 0.5; // partial credit for presence

  // +2.0 for user visibility
  if (a.hasUserVisible) score += 2.0;
  else score += 0.5;

  // +2.0 for automated tests
  if (a.hasTested) score += 2.0;
  else score += 0.5;

  // +1.5 for end-to-end proof
  if (a.hasEndToEnd) score += 1.5;

  // +1.5 for benchmark — bonus but not required
  if (a.hasBenchmark) score += 1.5;

  // strength multiplier
  if (a.strongestStrength === 'strong') score *= 1.0;
  else if (a.strongestStrength === 'moderate') score *= 0.95;
  else score *= 0.88;

  score = clamp(score, 0, dim.hardCeiling ?? dim.maxScore);

  const rationale = buildRationale(a, 'optimistic');
  const nextLift = buildNextLift(a, score, dim.maxScore);

  return { score: round1(score), rationale, nextLift };
}

// ── public_defensible ─────────────────────────────────────────────────────────
// Requires stronger proof. Discounts non-user-visible features.
// Limits claims to what an outsider could verify. No exact competitor deltas without sources.

function scorePublicDefensible(
  a: EvidenceAssessment,
  dim: DimensionDefinition,
): { score: number; rationale: string; nextLift?: string } {
  if (!a.hasAnyPresent || !a.hasMainPathWired) {
    return {
      score: 0,
      rationale: 'Feature not demonstrably wired into the main path — cannot make public claims.',
      nextLift: 'Wire into main path and confirm user-visible behavior.',
    };
  }

  let score = 1.0;

  // +2.5 only if user-visible
  if (a.hasUserVisible) score += 2.5;
  // no credit for invisible features

  // +2.5 for test coverage
  if (a.hasTested) score += 2.5;
  else score += 0.5; // unit-level only is weak public proof

  // +2.0 for end-to-end — much more weight here
  if (a.hasEndToEnd) score += 2.0;

  // +1.5 for benchmark
  if (a.hasBenchmark) score += 1.5;

  // strength multiplier — public requires stronger evidence
  if (a.strongestStrength === 'strong') score *= 1.0;
  else if (a.strongestStrength === 'moderate') score *= 0.88;
  else score *= 0.72;

  score = clamp(score, 0, dim.hardCeiling ?? dim.maxScore);

  const rationale = buildRationale(a, 'public');
  const nextLift = buildNextLift(a, score, dim.maxScore);

  return { score: round1(score), rationale, nextLift };
}

// ── hostile_diligence ─────────────────────────────────────────────────────────
// Heavily discounts partial wiring. Unit tests are table stakes, not a strength.
// Requires end-to-end proof for high scores. Performance claims need benchmarks.
// Prefers "unknown" over inflated confidence.

function scoreHostileDiligence(
  a: EvidenceAssessment,
  dim: DimensionDefinition,
): { score: number; rationale: string; nextLift?: string } {
  if (!a.hasAnyPresent || !a.hasMainPathWired) {
    return {
      score: 0,
      rationale: 'No main-path wiring confirmed — zero score under hostile review.',
      nextLift: 'Demonstrate main-path integration with end-to-end proof.',
    };
  }

  if (!a.hasUserVisible) {
    return {
      score: 1.0,
      rationale: 'Feature exists but is not user-visible — capability not demonstrated.',
      nextLift: 'Make feature user-visible and add end-to-end proof.',
    };
  }

  let score = 1.5; // base: wired + visible

  // tests are table stakes — minimal credit
  if (a.hasTested) score += 1.0;
  // no bonus for tests alone

  // +3.0 for end-to-end — this is the primary signal
  if (a.hasEndToEnd) score += 3.0;
  else {
    return {
      score: round1(clamp(score, 0, 4.5)),
      rationale: 'No end-to-end proof — capped under hostile diligence review.',
      nextLift: 'Add end-to-end or integration test that proves the capability end-to-end.',
    };
  }

  // +2.0 for benchmark (required for performance-sensitive dimensions)
  if (a.hasBenchmark) score += 2.0;
  else if (dim.requiredEvidenceTypes.includes('benchmark')) score *= 0.75; // penalize missing benchmark

  // strength multiplier — hostile requires strong evidence
  if (a.strongestStrength === 'strong') score *= 1.0;
  else if (a.strongestStrength === 'moderate') score *= 0.82;
  else score *= 0.65;

  score = clamp(score, 0, dim.hardCeiling ?? dim.maxScore);

  const rationale = buildRationale(a, 'hostile');
  const nextLift = buildNextLift(a, score, dim.maxScore);

  return { score: round1(score), rationale, nextLift };
}

// ── Shared rationale builders ─────────────────────────────────────────────────

function buildRationale(a: EvidenceAssessment, mode: 'optimistic' | 'public' | 'hostile'): string {
  const parts: string[] = [];

  if (!a.hasAnyPresent) {
    parts.push('No evidence found.');
    return parts.join(' ');
  }

  if (a.hasMainPathWired) parts.push('Main-path wired.');
  else if (mode !== 'optimistic') parts.push('NOT main-path wired.');

  if (a.hasUserVisible) parts.push('User-visible.');
  else if (mode === 'hostile') parts.push('Not user-visible.');

  if (a.hasTested) {
    parts.push(mode === 'hostile' ? 'Tests present (table stakes).' : 'Automated tests present.');
  } else {
    parts.push('No automated tests.');
  }

  if (a.hasEndToEnd) parts.push('End-to-end proven.');
  else if (mode !== 'optimistic') parts.push('No end-to-end proof.');

  if (a.hasBenchmark) parts.push('Benchmark-backed.');
  else if (mode === 'hostile') parts.push('No benchmark data.');

  if (a.strongestStrength) parts.push(`Strongest evidence: ${a.strongestStrength}.`);

  return parts.join(' ');
}

function buildNextLift(a: EvidenceAssessment, score: number, maxScore: number): string {
  if (score >= maxScore - 0.5) return 'Near ceiling — maintain and add benchmark coverage.';
  if (!a.hasEndToEnd) return 'Add end-to-end or integration proof to unlock next score tier.';
  if (!a.hasBenchmark) return 'Add benchmark or outcome metrics to support stronger claims.';
  if (!a.hasUserVisible) return 'Expose feature in user-visible path to improve defensibility.';
  if (!a.hasTested) return 'Add automated test coverage.';
  return 'Increase evidence strength from moderate to strong.';
}

// ── Rubric registry ───────────────────────────────────────────────────────────

export const RUBRICS: Record<RubricId, RubricPolicy> = {
  internal_optimistic: {
    id: 'internal_optimistic',
    displayName: 'Internal Optimistic',
    description: 'Credits implemented + tested capability. Partial wiring earns partial credit. Useful for internal prioritization.',
    score(evidence: EvidenceRecord[], dim: DimensionDefinition) {
      const a = assessEvidence(evidence);
      const result = scoreInternalOptimistic(a, dim);
      return {
        ...result,
        confidence: deriveConfidence(a, result.score),
      };
    },
  },

  public_defensible: {
    id: 'public_defensible',
    displayName: 'Public Defensible',
    description: 'Requires main-path + user-visible + stronger proof. Only claims what an outsider could verify.',
    score(evidence: EvidenceRecord[], dim: DimensionDefinition) {
      const a = assessEvidence(evidence);
      const result = scorePublicDefensible(a, dim);
      return {
        ...result,
        confidence: deriveConfidence(a, result.score),
      };
    },
  },

  hostile_diligence: {
    id: 'hostile_diligence',
    displayName: 'Hostile Diligence',
    description: 'Table stakes = tests. Requires end-to-end proof for high scores. Benchmarks required for performance dims. No inflated confidence.',
    score(evidence: EvidenceRecord[], dim: DimensionDefinition) {
      const a = assessEvidence(evidence);
      const result = scoreHostileDiligence(a, dim);
      return {
        ...result,
        confidence: a.hasEndToEnd && a.hasBenchmark ? 'high' : a.hasTested ? 'medium' : 'low',
      };
    },
  },
};

export function getRubric(id: RubricId): RubricPolicy {
  const rubric = RUBRICS[id];
  if (!rubric) throw new Error(`Unknown rubric: ${id}`);
  return rubric;
}

export const ALL_RUBRIC_IDS: RubricId[] = [
  'internal_optimistic',
  'public_defensible',
  'hostile_diligence',
];
