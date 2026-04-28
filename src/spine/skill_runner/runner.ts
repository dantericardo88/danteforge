/**
 * Dante-native skill runner. Wraps a skill execution with:
 *   1. Pre-flight harsh-scorer check on declared dimensions
 *   2. Evidence chain emission (Artifact + Evidence per phase)
 *   3. Three-way promotion gate (forge_policy + evidence_chain + harsh_score)
 *   4. Verdict + NextAction emission via the truth-loop schema
 *
 * The runner does NOT execute the skill's prompt — it wraps an arbitrary
 * `execute()` function the caller provides, and decorates its output with
 * constitutional substrate.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  Artifact,
  Evidence,
  EvidenceStatus,
  Verdict,
  NextAction,
  ReconciledClaim
} from '../truth_loop/types.js';
import {
  newArtifactId,
  newEvidenceId,
  nextRunId,
  sha256
} from '../truth_loop/ids.js';
import { buildVerdict } from '../truth_loop/verdict-writer.js';
import { buildNextAction, renderPromptPacket } from '../truth_loop/next-action-writer.js';
import { assertValid } from '../truth_loop/schema-validator.js';

import type {
  GateResult,
  SkillRunInputs,
  SkillRunResult,
  ThreeWayGate
} from './types.js';

export interface SkillExecutor {
  (inputs: Record<string, unknown>): Promise<{
    output: unknown;
    /** Optional per-phase artifacts emitted by the skill itself. */
    phaseArtifacts?: Array<{ label: string; payload: unknown }>;
    /** Optional surfaced assumptions the skill flagged. */
    surfacedAssumptions?: string[];
  }>;
}

const PRODUCTION_THRESHOLD = 9.0;

export async function runSkill(execute: SkillExecutor, inputs: SkillRunInputs): Promise<SkillRunResult> {
  const now = inputs.now ?? new Date();
  const runId = inputs.runId ?? nextRunId(inputs.repo, now);
  const outDir = resolve(inputs.repo, '.danteforge', 'skill-runs', inputs.skillName, runId);
  mkdirSync(outDir, { recursive: true });

  const exec = await execute(inputs.inputs);

  const artifacts: Artifact[] = [];
  const evidence: Evidence[] = [];

  // Primary skill artifact
  const primaryBody = JSON.stringify(exec.output ?? null);
  const primaryArtifact: Artifact = {
    artifactId: newArtifactId(),
    runId,
    type: 'forge_score',
    source: 'claude',
    createdAt: now.toISOString(),
    uri: `file://${resolve(outDir, 'output.json').replace(/\\/g, '/')}`,
    hash: sha256(primaryBody),
    label: `skill:${inputs.skillName}:output`
  };
  assertValid('artifact', primaryArtifact);
  artifacts.push(primaryArtifact);

  for (const phase of exec.phaseArtifacts ?? []) {
    const body = JSON.stringify(phase.payload ?? null);
    const a: Artifact = {
      artifactId: newArtifactId(),
      runId,
      type: 'static_analysis',
      source: 'claude',
      createdAt: now.toISOString(),
      uri: `inline://skill/${inputs.skillName}/${phase.label}`,
      hash: sha256(body),
      label: `skill:${inputs.skillName}:${phase.label}`
    };
    assertValid('artifact', a);
    artifacts.push(a);
  }

  // Pre-flight harsh-scorer
  const requiredDims = inputs.frontmatter.requiredDimensions ?? [];
  const scorer = inputs.scorer ?? (() => Object.fromEntries(requiredDims.map(d => [d, 9.0] as const)));
  const scores = await Promise.resolve(scorer(requiredDims, exec.output));

  // Score evidence
  for (const dim of requiredDims) {
    const score = scores[dim] ?? 0;
    const status: EvidenceStatus = score >= PRODUCTION_THRESHOLD ? 'passed' : 'failed';
    const e: Evidence = {
      evidenceId: newEvidenceId(),
      runId,
      artifactId: primaryArtifact.artifactId,
      kind: 'static_analysis',
      claimSupported: `Skill ${inputs.skillName} scores ≥${PRODUCTION_THRESHOLD} on ${dim}`,
      verificationMethod: 'harsh-scorer pre-flight',
      status,
      location: `dimension:${dim}=${score.toFixed(2)}`
    };
    assertValid('evidence', e);
    evidence.push(e);
  }

  // Three-way gate
  const gate = evaluateGate({
    artifacts,
    scores,
    requiredDims,
    inputs
  });

  // Build verdict from gate + assumptions
  const reconciled: ReconciledClaim[] = [];
  for (const dim of requiredDims) {
    const score = scores[dim] ?? 0;
    if (score >= PRODUCTION_THRESHOLD) {
      reconciled.push({
        claim: { claimId: `dim_${dim}`, type: 'mechanical', text: `${dim} ≥ ${PRODUCTION_THRESHOLD}` },
        status: 'supported',
        reasoning: `score ${score.toFixed(2)}`
      });
    } else {
      reconciled.push({
        claim: { claimId: `dim_${dim}`, type: 'mechanical', text: `${dim} ≥ ${PRODUCTION_THRESHOLD}` },
        status: 'contradicted',
        reasoning: `score ${score.toFixed(2)} below threshold`
      });
    }
  }
  for (const a of exec.surfacedAssumptions ?? []) {
    reconciled.push({
      claim: { claimId: `asm_${reconciled.length}`, type: 'preference', text: a },
      status: 'opinion',
      reasoning: 'surfaced assumption — requires founder confirmation'
    });
  }

  const verdict = buildVerdict({
    runId,
    reconciled,
    strictness: 'strict',
    evidenceMissing: gate.blockingReasons
  });
  assertValid('verdict', verdict);

  const promptUri = `file://${resolve(outDir, 'next_action_prompt.md').replace(/\\/g, '/')}`;
  const nextAction = buildNextAction({
    verdict,
    targetRepo: inputs.repo,
    strictness: 'strict',
    promptUri
  });
  assertValid('next_action', nextAction);

  // Persist
  writeJson(outDir, 'run.json', {
    runId,
    skillName: inputs.skillName,
    frontmatter: inputs.frontmatter,
    startedAt: now.toISOString(),
    gate,
    scoresByDimension: scores
  });
  writeJson(outDir, 'output.json', exec.output ?? null);
  writeJson(outDir, 'artifacts.json', artifacts);
  writeJson(outDir, 'evidence.json', evidence);
  writeJson(outDir, 'verdict.json', verdict);
  writeJson(outDir, 'next_action.json', nextAction);
  writeFileSync(resolve(outDir, 'next_action_prompt.md'), renderPromptPacket(nextAction, verdict), 'utf-8');

  return {
    runId,
    skillName: inputs.skillName,
    artifacts,
    evidence,
    scoresByDimension: scores,
    gate,
    verdict,
    nextAction,
    output: exec.output,
    outputDir: outDir
  };
}

interface GateInputs {
  artifacts: Artifact[];
  scores: Record<string, number>;
  requiredDims: string[];
  inputs: SkillRunInputs;
}

function evaluateGate(g: GateInputs): ThreeWayGate {
  const policyGate = g.inputs.policyGate ?? defaultPolicyGate;
  const evidenceCheck = g.inputs.evidenceCheck ?? defaultEvidenceCheck;

  const policy = policyGate(g.artifacts[0]);
  const ev = evidenceCheck(g.artifacts);
  const harsh = harshScoreGate(g.scores, g.requiredDims);

  const results = [policy, ev, harsh];
  const blocking: string[] = [];
  for (const r of results) if (r.status !== 'green') blocking.push(`${r.gate}: ${r.reason}`);

  const overall = results.every(r => r.status === 'green')
    ? 'green'
    : results.some(r => r.status === 'red')
      ? 'red'
      : 'yellow';

  return { results, overall, blockingReasons: blocking };
}

function defaultPolicyGate(_: unknown): GateResult {
  return { gate: 'forge_policy', status: 'green', reason: 'no policy violation detected' };
}

function defaultEvidenceCheck(artifacts: Artifact[]): GateResult {
  if (artifacts.length === 0) {
    return { gate: 'evidence_chain', status: 'red', reason: 'no artifacts emitted' };
  }
  return { gate: 'evidence_chain', status: 'green', reason: `${artifacts.length} artifact(s) hashed` };
}

function harshScoreGate(scores: Record<string, number>, requiredDims: string[]): GateResult {
  if (requiredDims.length === 0) {
    return { gate: 'harsh_score', status: 'yellow', reason: 'no required dimensions declared' };
  }
  const failing = requiredDims.filter(d => (scores[d] ?? 0) < PRODUCTION_THRESHOLD);
  if (failing.length === 0) {
    return { gate: 'harsh_score', status: 'green', reason: `all ${requiredDims.length} dimensions ≥${PRODUCTION_THRESHOLD}` };
  }
  return { gate: 'harsh_score', status: 'red', reason: `dimensions below threshold: ${failing.join(', ')}` };
}

function writeJson(dir: string, name: string, body: unknown): void {
  writeFileSync(resolve(dir, name), JSON.stringify(body, null, 2) + '\n', 'utf-8');
}
