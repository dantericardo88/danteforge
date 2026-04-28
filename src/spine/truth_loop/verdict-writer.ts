/**
 * Synthesize claim states into a Verdict per PRD-26 §5.5 disagreement policy.
 * Strictness modes:
 *   strict   — any unsupported_claim or contradicted_claim => not complete
 *   standard — partial verdicts allowed; confidence downgrade
 *   dev      — incomplete artifacts allowed but flagged
 */

import type { Verdict, ReconciledClaim, Strictness, FinalStatus, Confidence } from './types.js';
import { newVerdictId } from './ids.js';

export interface VerdictInputs {
  runId: string;
  reconciled: ReconciledClaim[];
  strictness: Strictness;
  budgetExhausted?: boolean;
  evidenceMissing?: string[];
}

export function buildVerdict(inputs: VerdictInputs): Verdict {
  const supported: string[] = [];
  const unsupported: string[] = [];
  const contradicted: string[] = [];
  const opinion: string[] = [];
  for (const r of inputs.reconciled) {
    switch (r.status) {
      case 'supported':
      case 'passed':
        supported.push(r.claim.text);
        break;
      case 'contradicted':
      case 'failed':
        contradicted.push(r.claim.text);
        break;
      case 'opinion':
        opinion.push(r.claim.text);
        break;
      case 'unsupported':
      case 'missing':
      case 'inconclusive':
      default:
        unsupported.push(r.claim.text);
        break;
    }
  }

  const blockingGaps: string[] = [];
  if (inputs.evidenceMissing && inputs.evidenceMissing.length > 0) {
    blockingGaps.push(...inputs.evidenceMissing);
  }
  if (contradicted.length > 0) {
    blockingGaps.push(`${contradicted.length} contradicted claim(s) require resolution`);
  }
  if (inputs.strictness === 'strict' && unsupported.length > 0) {
    blockingGaps.push(`${unsupported.length} unsupported claim(s) under strict mode`);
  }

  const finalStatus = pickStatus(inputs, supported.length, unsupported.length, contradicted.length, blockingGaps.length);
  const confidence = pickConfidence(inputs.strictness, supported.length, unsupported.length, contradicted.length);
  const score = computeScore(supported.length, unsupported.length, contradicted.length, opinion.length);

  return {
    verdictId: newVerdictId(inputs.runId),
    runId: inputs.runId,
    summary: summarize(finalStatus, supported.length, unsupported.length, contradicted.length, opinion.length),
    score,
    confidence,
    blockingGaps,
    unsupportedClaims: unsupported,
    supportedClaims: supported,
    contradictedClaims: contradicted,
    opinionClaims: opinion,
    finalStatus
  };
}

function pickStatus(inputs: VerdictInputs, sup: number, uns: number, con: number, blocking: number): FinalStatus {
  if (inputs.budgetExhausted) return 'budget_stopped';
  if (con > 0) return 'blocked';
  if (inputs.strictness === 'strict' && uns > 0) return 'evidence_insufficient';
  if (blocking > 0) return 'progress_real_but_not_done';
  if (sup === 0 && uns === 0) return 'evidence_insufficient';
  if (uns > 0) return 'progress_real_but_not_done';
  return 'complete';
}

function pickConfidence(strictness: Strictness, sup: number, uns: number, con: number): Confidence {
  if (con > 0) return 'low';
  if (sup === 0) return 'low';
  const ratio = sup / Math.max(1, sup + uns);
  if (ratio >= 0.9) return strictness === 'strict' ? 'high' : 'medium-high';
  if (ratio >= 0.7) return 'medium-high';
  if (ratio >= 0.5) return 'medium';
  if (ratio >= 0.3) return 'medium-low';
  return 'low';
}

function computeScore(sup: number, uns: number, con: number, opn: number): number {
  const verifiable = sup + uns + con;
  if (verifiable === 0) return Math.min(opn * 0.1, 5);
  const base = (sup / verifiable) * 10;
  const penalty = con * 0.5 + uns * 0.2;
  return Math.max(0, Math.min(10, Number((base - penalty).toFixed(2))));
}

function summarize(status: FinalStatus, sup: number, uns: number, con: number, opn: number): string {
  return `Verdict: ${status}. Claims — supported:${sup} unsupported:${uns} contradicted:${con} opinion:${opn}.`;
}
