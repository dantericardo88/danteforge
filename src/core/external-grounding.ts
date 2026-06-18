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
import { isOutcomePassing, makeEvidenceKey, type Outcome, type OutcomeEvidence } from '../matrix/types/outcome.js';
import { isContaminationResistantSuite } from '../matrix/engines/external-suite-registry.js';

interface DimLike {
  id: string;
  weight?: number;
  outcomes?: Outcome[];
}

/**
 * A dim is externally grounded only when it has ≥1 external-benchmark outcome with a PASSING receipt
 * at HEAD (CH-032). Declaration alone is NOT grounding — the project's deepest honesty metric must
 * reflect a real, verified receipt, not a promise. `evidence` is the loaded receipt snapshot; without
 * a passing receipt for the external-benchmark outcome, the dim does not count.
 */
export function isExternallyGrounded(dim: DimLike, evidence: OutcomeEvidence): boolean {
  return (dim.outcomes ?? []).some(o =>
    o.input_source?.type === 'external-benchmark'
    && isOutcomePassing(o, evidence.get(makeEvidenceKey(dim.id, o.id))));
}

/**
 * The HONEST subset of grounding (CH-044): a dim is contamination-resistant grounded only when its passing
 * external-benchmark receipt is on a CONTAMINATION-RESISTANT suite (post-cutoff, leak-detected) — not a
 * chain-proof, memorization-inflated one like HumanEval. A pass on HumanEval proves the pipeline runs; it does
 * NOT prove honest frontier capability. This separates real grounding from flattering grounding.
 */
export function isContaminationResistantlyGrounded(dim: DimLike, evidence: OutcomeEvidence): boolean {
  return (dim.outcomes ?? []).some(o =>
    o.input_source?.type === 'external-benchmark'
    && isContaminationResistantSuite((o.input_source as { suite?: unknown }).suite)
    && isOutcomePassing(o, evidence.get(makeEvidenceKey(dim.id, o.id))));
}

export interface ExternalGroundingReport {
  totalDims: number;
  externallyGroundedDims: number;
  groundedDimIds: string[];
  /** CH-044: dims grounded by a CONTAMINATION-RESISTANT suite (the honest subset; excludes chain-proof
   *  passes like HumanEval). This is the real grounding number. */
  contaminationResistantGroundedDims: number;
  contaminationResistantGroundedDimIds: string[];
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
export function externalGroundingReport(
  matrix: Pick<CompeteMatrix, 'dimensions'>,
  evidence: OutcomeEvidence,
): ExternalGroundingReport {
  const dims = (matrix.dimensions ?? []) as DimLike[];
  const totalDims = dims.length;
  const grounded = dims.filter(d => isExternallyGrounded(d, evidence));
  const crGrounded = dims.filter(d => isContaminationResistantlyGrounded(d, evidence));
  const totalWeight = dims.reduce((s, d) => s + (Number.isFinite(d.weight) ? (d.weight as number) : 1), 0);
  const groundedWeight = grounded.reduce((s, d) => s + (Number.isFinite(d.weight) ? (d.weight as number) : 1), 0);
  const weightedGroundingRatio = totalWeight > 0 ? groundedWeight / totalWeight : 0;
  const dimGroundingRatio = totalDims > 0 ? grounded.length / totalDims : 0;
  const pct = Math.round(weightedGroundingRatio * 100);
  const chainProofOnly = grounded.length > 0 && crGrounded.length === 0;
  const summary = grounded.length === 0
    ? `0% externally grounded — every dimension's score rests on self-authored evidence (self-run commands against self-chosen inputs). The matrix is self-CONSISTENT, not yet world-CONSISTENT; no score is corroborated by a benchmark the grader could not author.`
    : `${pct}% of the weighted headline is externally grounded (${grounded.length}/${totalDims} dims): ${grounded.map(d => d.id).join(', ')}.` +
      (chainProofOnly
        ? ` BUT 0 dims are CONTAMINATION-RESISTANT grounded — the grounding is chain-proof only (e.g. HumanEval, memorization-inflated). The honest-frontier grounding is 0% (CH-044).`
        : ` ${crGrounded.length}/${totalDims} are CONTAMINATION-RESISTANT grounded (${crGrounded.map(d => d.id).join(', ')} — the honest subset).`);
  return {
    totalDims,
    externallyGroundedDims: grounded.length,
    groundedDimIds: grounded.map(d => d.id),
    contaminationResistantGroundedDims: crGrounded.length,
    contaminationResistantGroundedDimIds: crGrounded.map(d => d.id),
    weightedGroundingRatio,
    dimGroundingRatio,
    summary,
  };
}
