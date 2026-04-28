/**
 * /dante-triage-issue executor — 4-phase root-cause loop with SoulSeal receipt.
 *
 * The executor consumes structured triage inputs (symptom, hypotheses,
 * falsification log, fix design) and produces a sha256-signed receipt.
 * The receipt is written to .danteforge/incidents/<runId>/soulseal_receipt.json.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

import type { SkillExecutor } from '../runner.js';

export interface TriageInputs {
  symptom: string;
  reproductionSteps: string[];
  failingCondition: string;
  hypotheses: { id: string; statement: string; falsificationTest: string; status?: 'falsified' | 'confirmed' | 'inconclusive' }[];
  fix?: { proximate: string; structural: string; regressionTest: string };
  mode?: 'standard' | 'adversarial' | 'quick';
  incidentRoot?: string;
  runId?: string;
}

interface TriageOutput {
  rootCauseConfirmed: boolean;
  rootCauseStatement: string | null;
  soulSealHash: string;
  soulSealPath: string | null;
  blockingIssues: string[];
}

export const danteTriageIssueExecutor: SkillExecutor = async (raw) => {
  const inputs = parseInputs(raw);
  const blocking: string[] = [];

  // Phase 1: reproduction must be stated
  if (inputs.reproductionSteps.length === 0) {
    blocking.push('Phase 1 reproduction steps missing');
  }

  // Phase 2: ≥3 hypotheses
  const phase2Ok = inputs.hypotheses.length >= 3;
  if (!phase2Ok) {
    blocking.push(`Phase 2 requires ≥3 hypotheses; got ${inputs.hypotheses.length}`);
  }

  // Phase 3: exactly one confirmed, others falsified
  const confirmed = inputs.hypotheses.filter(h => h.status === 'confirmed');
  const falsified = inputs.hypotheses.filter(h => h.status === 'falsified');
  const inconclusive = inputs.hypotheses.filter(h => !h.status || h.status === 'inconclusive');
  let rootCauseConfirmed = false;
  let rootCauseStatement: string | null = null;
  if (phase2Ok && confirmed.length === 1 && inconclusive.length === 0) {
    rootCauseConfirmed = true;
    rootCauseStatement = confirmed[0]!.statement;
  } else if (confirmed.length > 1) {
    blocking.push(`Phase 3 ambiguous: ${confirmed.length} confirmed hypotheses (expected 1)`);
  } else if (inconclusive.length > 0) {
    blocking.push(`Phase 3 incomplete: ${inconclusive.length} inconclusive hypotheses remain`);
  } else if (confirmed.length === 0) {
    blocking.push('Phase 3 produced 0 confirmed hypotheses; root cause not identified');
  }

  // Phase 4: defense in depth (skipped in quick mode)
  if (inputs.mode !== 'quick') {
    if (!inputs.fix) {
      blocking.push('Phase 4 fix design missing — defense-in-depth required outside quick mode');
    } else {
      if (!inputs.fix.proximate) blocking.push('Phase 4 proximate fix layer missing');
      if (!inputs.fix.structural) blocking.push('Phase 4 structural fix layer missing — bug class will recur');
      if (!inputs.fix.regressionTest) blocking.push('Phase 4 regression test missing — bug will silently re-fire');
    }
  }

  // Phase 5: SoulSeal receipt
  const receipt = {
    symptom: inputs.symptom,
    reproductionSteps: inputs.reproductionSteps,
    failingCondition: inputs.failingCondition,
    hypotheses: inputs.hypotheses,
    rootCauseStatement,
    fix: inputs.fix ?? null,
    mode: inputs.mode ?? 'standard'
  };
  const canonical = JSON.stringify(receipt, Object.keys(receipt).sort(), 2);
  const soulSealHash = createHash('sha256').update(canonical).digest('hex');

  let soulSealPath: string | null = null;
  if (inputs.incidentRoot && inputs.runId) {
    const dir = resolve(inputs.incidentRoot, inputs.runId);
    mkdirSync(dir, { recursive: true });
    soulSealPath = resolve(dir, 'soulseal_receipt.json');
    writeFileSync(soulSealPath, JSON.stringify({ ...receipt, soulSealHash }, null, 2) + '\n', 'utf-8');
  }

  const output: TriageOutput = {
    rootCauseConfirmed,
    rootCauseStatement,
    soulSealHash,
    soulSealPath,
    blockingIssues: blocking
  };

  return {
    output,
    phaseArtifacts: [
      { label: 'phase1_reproduction', payload: { steps: inputs.reproductionSteps, failingCondition: inputs.failingCondition } },
      { label: 'phase2_hypotheses', payload: inputs.hypotheses },
      { label: 'phase3_falsification_log', payload: { confirmed, falsified, inconclusive } },
      { label: 'phase4_fix_design', payload: inputs.fix ?? null },
      { label: 'phase5_soulseal_receipt', payload: { hash: soulSealHash, path: soulSealPath } }
    ],
    surfacedAssumptions: rootCauseConfirmed
      ? [`Root cause confirmed: ${rootCauseStatement}; founder reviews proposed fix before commit.`]
      : [`Root cause NOT confirmed (blocking: ${blocking.length}); founder must decide whether to escalate or re-run triage.`]
  };
};

function parseInputs(raw: Record<string, unknown>): TriageInputs {
  return {
    symptom: typeof raw.symptom === 'string' ? raw.symptom : '',
    reproductionSteps: Array.isArray(raw.reproductionSteps) ? (raw.reproductionSteps as string[]) : [],
    failingCondition: typeof raw.failingCondition === 'string' ? raw.failingCondition : '',
    hypotheses: Array.isArray(raw.hypotheses) ? (raw.hypotheses as TriageInputs['hypotheses']) : [],
    fix: (typeof raw.fix === 'object' && raw.fix !== null ? raw.fix : undefined) as TriageInputs['fix'],
    mode: (typeof raw.mode === 'string' ? raw.mode : 'standard') as TriageInputs['mode'],
    incidentRoot: typeof raw.incidentRoot === 'string' ? raw.incidentRoot : undefined,
    runId: typeof raw.runId === 'string' ? raw.runId : undefined
  };
}
