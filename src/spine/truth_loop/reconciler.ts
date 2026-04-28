/**
 * Reconciliation engine. For each claim, attempt verification against
 * repo / test / prior-artifact evidence. Emits Evidence records.
 *
 * Anti-stub rule: a claim is never marked supported without an Evidence
 * record whose status is 'passed' (or 'partial' for split-claim cases).
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type {
  Claim,
  Evidence,
  EvidenceStatus,
  ReconciledClaim
} from './types.js';
import type { TestSummary, RepoSnapshot } from './collectors.js';
import { newEvidenceId } from './ids.js';

export interface ReconcileContext {
  repo: string;
  runId: string;
  testArtifactId: string;
  repoArtifactId: string;
  test: TestSummary;
  snapshot: RepoSnapshot;
}

export function reconcileClaims(claims: Claim[], ctx: ReconcileContext): { reconciled: ReconciledClaim[]; evidence: Evidence[] } {
  const reconciled: ReconciledClaim[] = [];
  const evidence: Evidence[] = [];
  for (const claim of claims) {
    const r = reconcileSingle(claim, ctx);
    reconciled.push(r.reconciled);
    if (r.evidence) evidence.push(r.evidence);
  }
  return { reconciled, evidence };
}

function reconcileSingle(claim: Claim, ctx: ReconcileContext): { reconciled: ReconciledClaim; evidence: Evidence | null } {
  switch (claim.type) {
    case 'mechanical':
      return verifyMechanical(claim, ctx);
    case 'repo':
      return verifyRepo(claim, ctx);
    case 'architecture':
      return markOpinion(claim, 'architecture claim — not falsifiable from repo evidence');
    case 'prediction':
      return markOpinion(claim, 'prediction — not provable now; logged as forecast');
    case 'preference':
      return markOpinion(claim, 'preference claim — requires founder confirmation');
    case 'strategic':
      return markOpinion(claim, 'strategic claim — directional input only');
  }
}

function verifyMechanical(claim: Claim, ctx: ReconcileContext): { reconciled: ReconciledClaim; evidence: Evidence } {
  const lower = claim.text.toLowerCase();
  let status: EvidenceStatus;
  let reasoning: string;

  if (!ctx.test.attempted) {
    status = 'inconclusive';
    reasoning = 'tests not executed in this run; cannot verify';
  } else if (/tests?\s+(pass|are\s+passing)/i.test(lower)) {
    status = ctx.test.failed === 0 && ctx.test.total > 0 ? 'passed' : 'failed';
    reasoning = `observed ${ctx.test.passed}/${ctx.test.total} pass, ${ctx.test.failed} fail`;
  } else if (/tests?\s+(fail|are\s+failing|broken)/i.test(lower)) {
    status = ctx.test.failed > 0 ? 'passed' : 'failed';
    reasoning = `observed ${ctx.test.failed} failures`;
  } else if (/build\s+(fails|broken)/i.test(lower)) {
    status = 'inconclusive';
    reasoning = 'build state not separately measured by truth-loop collector';
  } else {
    status = 'inconclusive';
    reasoning = 'mechanical claim could not be mapped to a measurable signal';
  }

  const evidence: Evidence = {
    evidenceId: newEvidenceId(),
    runId: ctx.runId,
    artifactId: ctx.testArtifactId,
    kind: 'test_result',
    claimSupported: claim.text,
    verificationMethod: 'parse-test-output',
    status,
    claimId: claim.claimId
  };
  return {
    reconciled: { claim, status: mapEvidenceStatus(status), evidenceId: evidence.evidenceId, reasoning },
    evidence
  };
}

function verifyRepo(claim: Claim, ctx: ReconcileContext): { reconciled: ReconciledClaim; evidence: Evidence } {
  const path = extractPath(claim.text);
  let status: EvidenceStatus;
  let reasoning: string;
  let location: string | undefined;
  if (!path) {
    status = 'inconclusive';
    reasoning = 'no concrete path extractable from claim text';
  } else {
    const full = resolve(ctx.repo, path);
    if (existsSync(full)) {
      const st = statSync(full);
      status = 'passed';
      reasoning = `path exists (${st.isDirectory() ? 'dir' : 'file'}, ${st.size} bytes)`;
      location = path;
    } else {
      status = 'failed';
      reasoning = `path does not exist on disk: ${path}`;
      location = path;
    }
  }
  const evidence: Evidence = {
    evidenceId: newEvidenceId(),
    runId: ctx.runId,
    artifactId: ctx.repoArtifactId,
    kind: 'file_inspection',
    claimSupported: claim.text,
    verificationMethod: 'fs.existsSync + statSync',
    status,
    location,
    claimId: claim.claimId
  };
  return {
    reconciled: { claim, status: mapEvidenceStatus(status), evidenceId: evidence.evidenceId, reasoning },
    evidence
  };
}

function markOpinion(claim: Claim, reason: string): { reconciled: ReconciledClaim; evidence: null } {
  return {
    reconciled: { claim, status: 'opinion', reasoning: reason },
    evidence: null
  };
}

function mapEvidenceStatus(s: EvidenceStatus): ReconciledClaim['status'] {
  if (s === 'passed') return 'supported';
  if (s === 'failed') return 'contradicted';
  if (s === 'partial') return 'partial';
  return s;
}

const PATH_PATTERNS = [
  /`([\w./-]+)`/,
  /\b((?:src|tests|docs|\.danteforge|vscode-extension)\/[\w./-]+)/,
  /\b([A-Z][\w-]+\.(?:ts|tsx|md|json|yaml))/
];

function extractPath(text: string): string | null {
  for (const re of PATH_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[1] ?? null;
  }
  return null;
}
