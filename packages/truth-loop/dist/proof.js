import { createEvidenceBundle } from '@danteforge/evidence-chain';
function withoutProof(value) {
    const { proof: _proof, ...rest } = value;
    return rest;
}
function proofFor(record, kind, id, runId, gitSha) {
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
export function proofArtifact(artifact, gitSha) {
    return proofFor(artifact, 'artifact', artifact.artifactId, artifact.runId, gitSha);
}
export function proofEvidence(evidence, gitSha) {
    return proofFor(evidence, 'evidence', evidence.evidenceId, evidence.runId, gitSha);
}
export function proofVerdict(verdict, gitSha) {
    return proofFor(verdict, 'verdict', verdict.verdictId, verdict.runId, gitSha);
}
//# sourceMappingURL=proof.js.map