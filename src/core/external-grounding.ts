// external-grounding.ts — measure how much of the matrix's score rests on EXTERNAL evidence vs
// self-authored evidence (grading-integrity #6 — the accuracy CEILING).
//
// The deepest honesty signal. DanteForge picks its own dimensions, weights, competitor scores, AND
// the evidence (all "real-user-path" outcomes are `node dist/index.js …` on inputs DanteForge chose).
// A self-written rubric scored on self-run commands can only ever be self-CONSISTENT; a score is
// world-CONSISTENT only when something originating OUTSIDE the project corroborates it — a registered,
// independently-reproducible external benchmark (the input_source the contract reserves for 9.5). This
// report surfaces the ratio so a consumer (and the autonomous loop) can SEE how much of any number is
// self-attested — today, ~all of it. Making that visible is the prerequisite for fixing it: full,
// trustworthy autonomy means the loop's scores are anchored to evidence it cannot author.

import type { CompeteMatrix } from './compete-matrix.js';

interface DimLike {
  id: string;
  weight?: number;
  outcomes?: Array<{ input_source?: { type?: string } }>;
}

/** A dim is externally grounded when it declares ≥1 external-benchmark outcome (registered suite). */
export function isExternallyGrounded(dim: DimLike): boolean {
  return (dim.outcomes ?? []).some(o => o.input_source?.type === 'external-benchmark');
}

export interface ExternalGroundingReport {
  totalDims: number;
  externallyGroundedDims: number;
  groundedDimIds: string[];
  /** Fraction of total WEIGHT carried by externally-grounded dims (0..1). */
  weightedGroundingRatio: number;
  /** Fraction of dims (count) that are externally grounded (0..1). */
  dimGroundingRatio: number;
  /** One honest line a display/report can show next to the headline. */
  summary: string;
}

/**
 * Compute the external-grounding report for a matrix. Pure. The weighted ratio answers "how much of
 * the headline number is corroborated by evidence the grader could not author?" — 0 means the score is
 * entirely self-attested.
 */
export function externalGroundingReport(matrix: Pick<CompeteMatrix, 'dimensions'>): ExternalGroundingReport {
  const dims = (matrix.dimensions ?? []) as DimLike[];
  const totalDims = dims.length;
  const grounded = dims.filter(isExternallyGrounded);
  const totalWeight = dims.reduce((s, d) => s + (Number.isFinite(d.weight) ? (d.weight as number) : 1), 0);
  const groundedWeight = grounded.reduce((s, d) => s + (Number.isFinite(d.weight) ? (d.weight as number) : 1), 0);
  const weightedGroundingRatio = totalWeight > 0 ? groundedWeight / totalWeight : 0;
  const dimGroundingRatio = totalDims > 0 ? grounded.length / totalDims : 0;
  const pct = Math.round(weightedGroundingRatio * 100);
  const summary = grounded.length === 0
    ? `0% externally grounded — every dimension's score rests on self-authored evidence (self-run commands against self-chosen inputs). The matrix is self-CONSISTENT, not yet world-CONSISTENT; no score is corroborated by a benchmark the grader could not author.`
    : `${pct}% of the weighted headline is externally grounded (${grounded.length}/${totalDims} dims carry a registered external-benchmark receipt): ${grounded.map(d => d.id).join(', ')}. The remaining ${100 - pct}% is self-attested.`;
  return {
    totalDims,
    externallyGroundedDims: grounded.length,
    groundedDimIds: grounded.map(d => d.id),
    weightedGroundingRatio,
    dimGroundingRatio,
    summary,
  };
}
