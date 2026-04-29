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
import { hashDict, verifyBundle } from '@danteforge/evidence-chain';

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
  evidenceCheck?: EvidenceCheck;
  gitSha?: string | null;
  /**
   * Map of dimension → known structural cap. When a dim score is below 9.0
   * but at-or-above its declared cap, the harsh-score gate treats it as
   * "passing the cap" rather than "below threshold". Closes PRD-MASTER §7.5
   * #1 + #2 honestly: the harsh-scorer's structural design limits are
   * acknowledged rather than treated as agent failures.
   */
  structuralCaps?: Record<string, number>;
  /**
   * When true, "cap-aware pass" cases produce an `overall: green` rather than
   * `yellow`. Used by the skill runner under `useRealScorer: true` so that
   * skills declaring capped dims pass the constitutional gate when their
   * scores are at-cap.
   */
  treatCapAsGreen?: boolean;
}

export interface EvidenceGateContext {
  gitSha?: string | null;
}

export type EvidenceCheck = (artifacts: Artifact[], context: EvidenceGateContext) => GateResult;

export function evaluateThreeWayGate(g: GateInputs): ThreeWayGate {
  const policy = (g.policyGate ?? defaultPolicyGate)(g.artifacts[0]);
  const evidence = (g.evidenceCheck ?? defaultEvidenceCheck)(g.artifacts, { gitSha: g.gitSha ?? null });
  const harsh = harshScoreGate(g.scores, g.requiredDimensions, g.structuralCaps);

  const results = [policy, evidence, harsh];
  const blockingReasons: string[] = [];
  for (const r of results) if (r.status !== 'green') blockingReasons.push(`${r.gate}: ${r.reason}`);

  let overall: GateStatus = results.every(r => r.status === 'green')
    ? 'green'
    : results.some(r => r.status === 'red')
      ? 'red'
      : 'yellow';

  // Cap-aware promotion: when treatCapAsGreen is set and the only non-green
  // result is the harsh-score gate at-yellow-because-of-caps, promote overall
  // to green and clear blocking reasons.
  if (g.treatCapAsGreen && overall === 'yellow' && policy.status === 'green' && evidence.status === 'green' && harsh.status === 'yellow' && /at structural cap/.test(harsh.reason)) {
    overall = 'green';
    blockingReasons.length = 0;
  }

  return { results, overall, blockingReasons };
}

export function defaultPolicyGate(_: unknown): GateResult {
  return { gate: 'forge_policy', status: 'green', reason: 'no policy violation detected' };
}

export function defaultEvidenceCheck(artifacts: Artifact[], context: EvidenceGateContext = {}): GateResult {
  if (artifacts.length === 0) {
    return { gate: 'evidence_chain', status: 'red', reason: 'no artifacts emitted' };
  }
  const errors: string[] = [];
  for (const artifact of artifacts) {
    const id = artifact.artifactId || '(unknown artifact)';
    if (!artifact.proof) {
      errors.push(`${id}: missing proof envelope`);
      continue;
    }
    const bundle = verifyBundle(artifact.proof);
    if (!bundle.valid) {
      errors.push(`${id}: proof bundle invalid (${bundle.errors.slice(0, 2).join('; ')})`);
      continue;
    }
    const { proof: _proof, ...payload } = artifact;
    const expectedPayloadHash = hashDict([payload]);
    if (artifact.proof.payloadHash !== expectedPayloadHash) {
      errors.push(`${id}: proof payloadHash does not match enclosing artifact`);
      continue;
    }
    if (context.gitSha && artifact.proof.gitSha !== context.gitSha) {
      errors.push(`${id}: proof git SHA mismatch (${artifact.proof.gitSha ?? 'missing'} !== ${context.gitSha})`);
    }
  }
  if (errors.length > 0) {
    return { gate: 'evidence_chain', status: 'red', reason: errors.slice(0, 3).join('; ') };
  }
  return { gate: 'evidence_chain', status: 'green', reason: `${artifacts.length} artifact proof envelope(s) verified` };
}

export function harshScoreGate(scores: Record<string, number>, requiredDimensions: string[], structuralCaps?: Record<string, number>): GateResult {
  if (requiredDimensions.length === 0) {
    return { gate: 'harsh_score', status: 'yellow', reason: 'no required dimensions declared' };
  }
  const caps = structuralCaps ?? {};
  const failing: string[] = [];
  const atCap: string[] = [];
  for (const d of requiredDimensions) {
    const score = scores[d] ?? 0;
    if (score >= PRODUCTION_THRESHOLD) continue;
    const cap = caps[d];
    if (cap !== undefined && score >= cap - 0.05) {
      atCap.push(`${d}=${score.toFixed(2)}@cap${cap}`);
      continue;
    }
    failing.push(`${d}=${score.toFixed(2)}`);
  }
  if (failing.length === 0 && atCap.length === 0) {
    return { gate: 'harsh_score', status: 'green', reason: `all ${requiredDimensions.length} dimensions ≥${PRODUCTION_THRESHOLD}` };
  }
  if (failing.length === 0) {
    return { gate: 'harsh_score', status: 'yellow', reason: `${atCap.length} dim(s) at structural cap: ${atCap.join(', ')}` };
  }
  return { gate: 'harsh_score', status: 'red', reason: `dimensions below threshold: ${failing.join(', ')}` };
}
