/**
 * /dante-design-an-interface executor — 3-parallel-agent design exploration.
 *
 * Deterministic mode produces 3 designs from caller-supplied prompts and
 * synthesizes a winner via a scored two-stage review. Hardware ceiling
 * enforced (max 3 parallel; refuses if more requested).
 */

import { createHash } from 'node:crypto';
import type { SkillExecutor } from '../runner.js';
import { HardwareCeilingError, assertHardwareCeiling } from '../../magic_skill_orchestration/index.js';

export interface DesignInputs {
  brief: string;
  hardConstraints: string[];
  successCriteria: string[];
  roles: string[];
  designs?: Record<string, { content: string; tradeoffsAccepted: string[] }>;
}

interface DesignReview {
  role: string;
  stageA: { specCompliance: 'pass' | 'fail'; missingConstraints: string[] };
  stageB: { qualityScore: number; rationale: string };
}

interface DesignOutput {
  selectedRole: string | null;
  selectionRationale: string;
  reviews: DesignReview[];
  diversityCheck: 'pass' | 'fail';
  finalArtifactHash: string | null;
  blockingIssues: string[];
}

export const danteDesignAnInterfaceExecutor: SkillExecutor = async (raw) => {
  const inputs = parseInputs(raw);
  const blocking: string[] = [];

  // Hardware ceiling: max 3 parallel agents
  try {
    assertHardwareCeiling('inferno', inputs.roles.length);
  } catch (err) {
    if (err instanceof HardwareCeilingError) {
      blocking.push(err.message);
      return blockingResult(blocking);
    }
    throw err;
  }
  if (inputs.roles.length < 1) {
    blocking.push('No roles specified — refusing to dispatch 0 parallel agents');
    return blockingResult(blocking);
  }

  const designs = inputs.designs ?? {};
  for (const role of inputs.roles) {
    if (!designs[role]) {
      blocking.push(`Role "${role}" produced no design (sub-agent failed or skipped)`);
    }
  }
  if (blocking.length > 0) return blockingResult(blocking);

  // Two-stage review per design
  const reviews: DesignReview[] = inputs.roles.map(role => {
    const design = designs[role]!;
    const missing = inputs.hardConstraints.filter(c => !design.content.toLowerCase().includes(c.toLowerCase()));
    const stageA: DesignReview['stageA'] = missing.length === 0
      ? { specCompliance: 'pass', missingConstraints: [] }
      : { specCompliance: 'fail', missingConstraints: missing };
    const qualityScore = stageA.specCompliance === 'pass'
      ? scoreQuality(design, inputs.successCriteria)
      : 0;
    return {
      role,
      stageA,
      stageB: {
        qualityScore,
        rationale: stageA.specCompliance === 'pass'
          ? `quality score ${qualityScore.toFixed(2)} based on success-criteria coverage and tradeoff explicitness`
          : `disqualified — missing constraints: ${missing.join(', ')}`
      }
    };
  });

  // Diversity check: tradeoff lists must differ
  const tradeoffSets = inputs.roles.map(r => new Set(designs[r]!.tradeoffsAccepted));
  const allSame = tradeoffSets.every(s => setsEqual(s, tradeoffSets[0]!));
  const diversityCheck: 'pass' | 'fail' = allSame ? 'fail' : 'pass';

  // Selection
  const stageAPassed = reviews.filter(r => r.stageA.specCompliance === 'pass');
  if (stageAPassed.length === 0) {
    return blockingResult(['No design passed Stage A spec compliance — re-dispatch with refined brief']);
  }
  if (stageAPassed.length === 1) {
    const winner = stageAPassed[0]!;
    return wrapOutput({
      selectedRole: winner.role,
      selectionRationale: `Only design that passed Stage A spec compliance.`,
      reviews,
      diversityCheck,
      finalArtifactHash: hashOf(designs[winner.role]!.content),
      blockingIssues: []
    }, designs, reviews);
  }
  // Multi-pass — pick highest qualityScore; if tie, escalate
  const sortedByScore = [...stageAPassed].sort((a, b) => b.stageB.qualityScore - a.stageB.qualityScore);
  const top = sortedByScore[0]!;
  const second = sortedByScore[1]!;
  if (Math.abs(top.stageB.qualityScore - second.stageB.qualityScore) < 0.01) {
    return blockingResult([
      `Tie between ${top.role} and ${second.role} on Stage B quality — escalate to founder rather than auto-tiebreak`
    ]);
  }
  return wrapOutput({
    selectedRole: top.role,
    selectionRationale: `${top.role} scored ${top.stageB.qualityScore.toFixed(2)} vs runner-up ${second.role} at ${second.stageB.qualityScore.toFixed(2)}. Tradeoffs lost: ${designs[top.role]!.tradeoffsAccepted.join('; ')}.`,
    reviews,
    diversityCheck,
    finalArtifactHash: hashOf(designs[top.role]!.content),
    blockingIssues: []
  }, designs, reviews);
};

function parseInputs(raw: Record<string, unknown>): DesignInputs {
  return {
    brief: typeof raw.brief === 'string' ? raw.brief : '',
    hardConstraints: Array.isArray(raw.hardConstraints) ? (raw.hardConstraints as string[]) : [],
    successCriteria: Array.isArray(raw.successCriteria) ? (raw.successCriteria as string[]) : [],
    roles: Array.isArray(raw.roles) ? (raw.roles as string[]) : [],
    designs: (typeof raw.designs === 'object' && raw.designs !== null
      ? raw.designs
      : undefined) as DesignInputs['designs']
  };
}

function scoreQuality(design: { content: string; tradeoffsAccepted: string[] }, successCriteria: string[]): number {
  if (successCriteria.length === 0) return 7.0; // baseline when criteria not stated
  const hits = successCriteria.filter(c => design.content.toLowerCase().includes(c.toLowerCase())).length;
  const coverage = hits / successCriteria.length;
  const tradeoffBonus = Math.min(1, design.tradeoffsAccepted.length / 2);
  return Number((6.0 + coverage * 3.0 + tradeoffBonus).toFixed(2));
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function hashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function blockingResult(blocking: string[]): Awaited<ReturnType<SkillExecutor>> {
  const output: DesignOutput = {
    selectedRole: null,
    selectionRationale: 'BLOCKED — see blockingIssues',
    reviews: [],
    diversityCheck: 'fail',
    finalArtifactHash: null,
    blockingIssues: blocking
  };
  return {
    output,
    phaseArtifacts: [{ label: 'phase_blocked', payload: blocking }],
    surfacedAssumptions: ['Design exploration blocked; founder must adjust brief or roles before retry.']
  };
}

function wrapOutput(output: DesignOutput, designs: Record<string, { content: string; tradeoffsAccepted: string[] }>, reviews: DesignReview[]): Awaited<ReturnType<SkillExecutor>> {
  return {
    output,
    phaseArtifacts: [
      { label: 'phase1_brief_parsed', payload: { selectedRole: output.selectedRole } },
      ...Object.entries(designs).map(([role, d]) => ({ label: `subagent_${role}_design`, payload: d })),
      { label: 'phase3_reviews', payload: reviews },
      { label: 'phase4_synthesis', payload: { selected: output.selectedRole, rationale: output.selectionRationale } }
    ],
    surfacedAssumptions: [
      `Selection assumes Stage B quality scoring weights success-criteria coverage equally with tradeoff explicitness; founder may override.`
    ]
  };
}
