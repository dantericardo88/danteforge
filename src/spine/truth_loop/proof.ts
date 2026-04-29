import { createEvidenceBundle } from '@danteforge/evidence-chain';

import type { Artifact, Evidence, Verdict } from './types.js';

type Proofable = Artifact | Evidence | Verdict;

function withoutProof<T extends { proof?: unknown }>(value: T): Omit<T, 'proof'> {
  const { proof: _proof, ...rest } = value;
  return rest;
}

function proofFor<T extends Proofable>(
  record: T,
  kind: 'artifact' | 'evidence' | 'verdict',
  id: string,
  runId: string,
  gitSha: string | null,
): T {
  const payload = withoutProof(record);
  return {
    ...record,
    proof: createEvidenceBundle({
      runId,
      bundleId: `${kind}_${id}`,
      gitSha,
      evidence: [payload],
      createdAt: 'createdAt' in record && typeof record.createdAt === 'string'
        ? record.createdAt
        : new Date().toISOString(),
    }),
  };
}

export function proofArtifact(artifact: Artifact, gitSha: string | null): Artifact {
  return proofFor(artifact, 'artifact', artifact.artifactId, artifact.runId, gitSha);
}

export function proofEvidence(evidence: Evidence, gitSha: string | null): Evidence {
  return proofFor(evidence, 'evidence', evidence.evidenceId, evidence.runId, gitSha);
}

export function proofVerdict(verdict: Verdict, gitSha: string | null): Verdict {
  return proofFor(verdict, 'verdict', verdict.verdictId, verdict.runId, gitSha);
}
