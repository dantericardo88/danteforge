// src/scoring/score-dimension.ts — Per-dimension scoring pipeline

import type { DimensionScore, RubricId, EvidenceRecord } from './types.js';
import type { DimensionDefinition } from './types.js';
import { getRubric } from './rubrics.js';

export function scoreDimension(
  evidence: EvidenceRecord[],
  dim: DimensionDefinition,
  rubricId: RubricId,
): DimensionScore {
  const dimEvidence = evidence.filter((e) => e.dimensionId === dim.id);
  const rubric = getRubric(rubricId);
  const result = rubric.score(dimEvidence, dim);

  return {
    dimensionId: dim.id,
    rubricId,
    score: result.score,
    maxScore: dim.maxScore,
    confidence: result.confidence,
    rationale: result.rationale,
    ceilingReason: dim.hardCeiling !== undefined && result.score >= dim.hardCeiling
      ? `Hard ceiling of ${dim.hardCeiling} applied for this dimension`
      : undefined,
    nextLift: result.nextLift,
    evidenceRefs: dimEvidence.map((e) => e.sourceRef).filter(Boolean),
  };
}

export function scoreAllDimensions(
  evidence: EvidenceRecord[],
  dimensions: DimensionDefinition[],
  rubricIds: RubricId[],
): DimensionScore[] {
  const results: DimensionScore[] = [];
  for (const dim of dimensions) {
    for (const rubricId of rubricIds) {
      results.push(scoreDimension(evidence, dim, rubricId));
    }
  }
  return results;
}
