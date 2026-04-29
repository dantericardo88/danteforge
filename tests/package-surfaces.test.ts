import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { verifyBundle } from '@danteforge/evidence-chain';
import {
  nextRunId,
  proofArtifact,
  proofEvidence,
  proofVerdict,
  type Artifact,
  type Evidence,
  type Verdict,
} from '@danteforge/truth-loop';
import {
  evaluateThreeWayGate,
  PRODUCTION_THRESHOLD,
} from '@danteforge/three-way-gate';

describe('v1.1 package surfaces', () => {
  it('exports truth-loop proof helpers through @danteforge/truth-loop', () => {
    const runId = nextRunId('/tmp/no-existing-runs', new Date('2026-04-29T00:00:00.000Z'));
    const artifact: Artifact = {
      artifactId: 'artifact_package_surface',
      runId,
      type: 'repo_snapshot',
      source: 'repo',
      createdAt: '2026-04-29T12:00:00.000Z',
      uri: '.danteforge/truth-loop/run/artifacts/repo.json',
      hash: 'a'.repeat(64),
    };
    const evidence: Evidence = {
      evidenceId: 'evidence_package_surface',
      runId,
      artifactId: artifact.artifactId,
      kind: 'hash_verification',
      claimSupported: 'artifact hash is stable',
      verificationMethod: 'sha256',
      status: 'passed',
    };
    const verdict: Verdict = {
      verdictId: 'verdict_package_surface',
      runId,
      summary: 'package surface verified',
      score: 9.4,
      confidence: 'high',
      finalStatus: 'complete',
    };

    const proofedArtifact = proofArtifact(artifact, 'abc123');
    const proofedEvidence = proofEvidence(evidence, 'abc123');
    const proofedVerdict = proofVerdict(verdict, 'abc123');

    assert.equal(verifyBundle(proofedArtifact.proof!).valid, true);
    assert.equal(verifyBundle(proofedEvidence.proof!).valid, true);
    assert.equal(verifyBundle(proofedVerdict.proof!).valid, true);
  });

  it('exports the three-way gate through @danteforge/three-way-gate', () => {
    const runId = 'run_20260429_001';
    const artifact = proofArtifact({
      artifactId: 'artifact_gate_surface',
      runId,
      type: 'repo_snapshot',
      source: 'repo',
      createdAt: '2026-04-29T12:00:00.000Z',
      uri: '.danteforge/truth-loop/run/artifacts/repo.json',
      hash: 'b'.repeat(64),
    }, 'abc123');

    const gate = evaluateThreeWayGate({
      artifacts: [artifact],
      gitSha: 'abc123',
      scores: { tokenEconomy: PRODUCTION_THRESHOLD },
      requiredDimensions: ['tokenEconomy'],
    });

    assert.equal(gate.overall, 'green');
    assert.deepEqual(gate.blockingReasons, []);
  });
});
