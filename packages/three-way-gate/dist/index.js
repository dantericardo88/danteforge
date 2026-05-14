import { hashDict, verifyBundle } from '@danteforge/evidence-chain';
export const PRODUCTION_THRESHOLD = 9.0;
export function evaluateThreeWayGate(g) {
    const policy = (g.policyGate ?? defaultPolicyGate)(g.artifacts[0]);
    const evidence = (g.evidenceCheck ?? defaultEvidenceCheck)(g.artifacts, { gitSha: g.gitSha ?? null });
    const harsh = harshScoreGate(g.scores, g.requiredDimensions, g.structuralCaps);
    const results = [policy, evidence, harsh];
    const blockingReasons = [];
    for (const r of results)
        if (r.status !== 'green')
            blockingReasons.push(`${r.gate}: ${r.reason}`);
    let overall = results.every(r => r.status === 'green')
        ? 'green'
        : results.some(r => r.status === 'red')
            ? 'red'
            : 'yellow';
    if (g.treatCapAsGreen && overall === 'yellow' && policy.status === 'green' && evidence.status === 'green' && harsh.status === 'yellow' && /at structural cap/.test(harsh.reason)) {
        overall = 'green';
        blockingReasons.length = 0;
    }
    return { results, overall, blockingReasons };
}
export function defaultPolicyGate(_) {
    return { gate: 'forge_policy', status: 'green', reason: 'no policy violation detected' };
}
export function defaultEvidenceCheck(artifacts, context = {}) {
    if (artifacts.length === 0) {
        return { gate: 'evidence_chain', status: 'red', reason: 'no artifacts emitted' };
    }
    const errors = [];
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
export function harshScoreGate(scores, requiredDimensions, structuralCaps) {
    if (requiredDimensions.length === 0) {
        return { gate: 'harsh_score', status: 'yellow', reason: 'no required dimensions declared' };
    }
    const caps = structuralCaps ?? {};
    const failing = [];
    const atCap = [];
    for (const d of requiredDimensions) {
        const score = scores[d] ?? 0;
        if (score >= PRODUCTION_THRESHOLD)
            continue;
        const cap = caps[d];
        if (cap !== undefined && score >= cap - 0.05) {
            atCap.push(`${d}=${score.toFixed(2)}@cap${cap}`);
            continue;
        }
        failing.push(`${d}=${score.toFixed(2)}`);
    }
    if (failing.length === 0 && atCap.length === 0) {
        return { gate: 'harsh_score', status: 'green', reason: `all ${requiredDimensions.length} dimensions >=${PRODUCTION_THRESHOLD}` };
    }
    if (failing.length === 0) {
        return { gate: 'harsh_score', status: 'yellow', reason: `${atCap.length} dim(s) at structural cap: ${atCap.join(', ')}` };
    }
    return { gate: 'harsh_score', status: 'red', reason: `dimensions below threshold: ${failing.join(', ')}` };
}
//# sourceMappingURL=index.js.map