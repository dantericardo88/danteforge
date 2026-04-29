import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createEvidenceBundle, sha256 } from '../packages/evidence-chain/src/index.ts';
import { evaluateThreeWayGate } from '../src/spine/three_way_gate.js';
import type { Artifact } from '../src/spine/truth_loop/types.js';

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    artifactId: 'art_proof_gate',
    runId: 'run_20260429_010',
    type: 'forge_score',
    source: 'codex',
    createdAt: '2026-04-29T12:00:00.000Z',
    uri: 'inline://proof-gate/artifact',
    hash: sha256('payload'),
    label: 'proof-gate-fixture',
    ...overrides,
  };
}

function proofedArtifact(gitSha = 'abc123'): Artifact {
  const base = artifact();
  const { proof: _proof, ...payload } = base;
  return {
    ...base,
    proof: createEvidenceBundle({
      runId: base.runId,
      bundleId: `artifact_${base.artifactId}`,
      gitSha,
      evidence: [payload],
      createdAt: base.createdAt,
    }),
  };
}

function passingGate(artifacts: Artifact[], gitSha = 'abc123') {
  return evaluateThreeWayGate({
    artifacts,
    scores: { testing: 9.5 },
    requiredDimensions: ['testing'],
    gitSha,
  });
}

describe('three-way gate proof enforcement', () => {
  it('promotes when every artifact proof verifies and the harsh score passes', () => {
    const gate = passingGate([proofedArtifact()]);

    assert.equal(gate.overall, 'green');
    assert.equal(gate.results.find(r => r.gate === 'evidence_chain')?.status, 'green');
  });

  it('fails closed when an artifact is missing its proof envelope', () => {
    const gate = passingGate([artifact()]);

    assert.equal(gate.overall, 'red');
    assert.match(gate.blockingReasons.join('\n'), /missing proof/i);
  });

  it('rejects an artifact whose payload changed after proof creation', () => {
    const sealed = proofedArtifact();
    const tampered = { ...sealed, hash: sha256('different-payload') };

    const gate = passingGate([tampered]);

    assert.equal(gate.overall, 'red');
    assert.match(gate.blockingReasons.join('\n'), /payloadHash|enclosing/i);
  });

  it('rejects an artifact whose Merkle proof was tampered', () => {
    const sealed = proofedArtifact();
    const tampered = {
      ...sealed,
      proof: {
        ...sealed.proof!,
        evidence: [{ ...sealed.proof!.evidence[0] as Record<string, unknown>, hash: sha256('altered') }],
      },
    };

    const gate = passingGate([tampered]);

    assert.equal(gate.overall, 'red');
    assert.match(gate.blockingReasons.join('\n'), /bundle|merkle|evidence/i);
  });

  it('rejects proof envelopes bound to a different git SHA', () => {
    const gate = passingGate([proofedArtifact('oldsha')], 'newsha');

    assert.equal(gate.overall, 'red');
    assert.match(gate.blockingReasons.join('\n'), /git sha/i);
  });
});
