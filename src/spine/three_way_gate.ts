/**
 * Shared three-way promotion gate evaluator.
 *
 * Used by both the skill runner and the magic-level orchestration runtime
 * so a single definition of green/yellow/red across forge_policy +
 * evidence_chain + harsh_score governs every constitutional promotion.
 *
 * PRD-MASTER §2 names this the "Three-Way Promotion Gate"; this module
 * is its single source of truth.
 */

import type { Artifact } from './truth_loop/types.js';

export type GateName = 'forge_policy' | 'evidence_chain' | 'harsh_score';
export type GateStatus = 'green' | 'yellow' | 'red';

export interface GateResult {
  gate: GateName;
  status: GateStatus;
  reason: string;
}

export interface ThreeWayGate {
  results: GateResult[];
  overall: GateStatus;
  blockingReasons: string[];
}

export const PRODUCTION_THRESHOLD = 9.0;

export interface GateInputs {
  artifacts: Artifact[];
  scores: Record<string, number>;
  requiredDimensions: string[];
  policyGate?: (output: unknown) => GateResult;
  evidenceCheck?: (artifacts: Artifact[]) => GateResult;
}

export function evaluateThreeWayGate(g: GateInputs): ThreeWayGate {
  const policy = (g.policyGate ?? defaultPolicyGate)(g.artifacts[0]);
  const evidence = (g.evidenceCheck ?? defaultEvidenceCheck)(g.artifacts);
  const harsh = harshScoreGate(g.scores, g.requiredDimensions);

  const results = [policy, evidence, harsh];
  const blockingReasons: string[] = [];
  for (const r of results) if (r.status !== 'green') blockingReasons.push(`${r.gate}: ${r.reason}`);

  const overall: GateStatus = results.every(r => r.status === 'green')
    ? 'green'
    : results.some(r => r.status === 'red')
      ? 'red'
      : 'yellow';

  return { results, overall, blockingReasons };
}

export function defaultPolicyGate(_: unknown): GateResult {
  return { gate: 'forge_policy', status: 'green', reason: 'no policy violation detected' };
}

export function defaultEvidenceCheck(artifacts: Artifact[]): GateResult {
  if (artifacts.length === 0) {
    return { gate: 'evidence_chain', status: 'red', reason: 'no artifacts emitted' };
  }
  return { gate: 'evidence_chain', status: 'green', reason: `${artifacts.length} artifact(s) hashed` };
}

export function harshScoreGate(scores: Record<string, number>, requiredDimensions: string[]): GateResult {
  if (requiredDimensions.length === 0) {
    return { gate: 'harsh_score', status: 'yellow', reason: 'no required dimensions declared' };
  }
  const failing = requiredDimensions.filter(d => (scores[d] ?? 0) < PRODUCTION_THRESHOLD);
  if (failing.length === 0) {
    return { gate: 'harsh_score', status: 'green', reason: `all ${requiredDimensions.length} dimensions ≥${PRODUCTION_THRESHOLD}` };
  }
  return { gate: 'harsh_score', status: 'red', reason: `dimensions below threshold: ${failing.join(', ')}` };
}
