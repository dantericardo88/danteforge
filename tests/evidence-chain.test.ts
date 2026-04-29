import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HashChain,
  MerkleTree,
  createEvidenceBundle,
  createReceipt,
  hashDict,
  sha256,
  stableJSON,
  verifyBundle,
  verifyReceipt,
} from '../packages/evidence-chain/src/index.ts';

describe('@danteforge/evidence-chain primitives', () => {
  it('stableJSON deterministically orders object keys', () => {
    const a = { b: 2, a: { d: 4, c: 3 }, z: [ { y: 2, x: 1 } ] };
    const b = { z: [ { x: 1, y: 2 } ], a: { c: 3, d: 4 }, b: 2 };

    assert.equal(stableJSON(a), stableJSON(b));
    assert.equal(stableJSON(a), '{"a":{"c":3,"d":4},"b":2,"z":[{"x":1,"y":2}]}');
  });

  it('hashDict changes when payload changes', () => {
    assert.equal(sha256('abc').length, 64);
    assert.notEqual(hashDict({ score: 9.1 }), hashDict({ score: 9.2 }));
  });

  it('HashChain verifies valid entries and rejects tampering, broken prevHash, and reorder', () => {
    const chain = new HashChain<{ step: string }>();
    chain.append({ step: 'collect' }, { createdAt: '2026-04-29T10:00:00.000Z' });
    chain.append({ step: 'verify' }, { createdAt: '2026-04-29T10:01:00.000Z' });
    chain.append({ step: 'verdict' }, { createdAt: '2026-04-29T10:02:00.000Z' });

    assert.equal(chain.verifyIntegrity().valid, true);

    const tampered = chain.toJSON();
    tampered[1] = { ...tampered[1]!, payload: { step: 'skip-verify' } };
    assert.equal(HashChain.verifyEntries(tampered).valid, false);

    const brokenPrev = chain.toJSON();
    brokenPrev[1] = { ...brokenPrev[1]!, prevHash: '0'.repeat(64) };
    assert.equal(HashChain.verifyEntries(brokenPrev).valid, false);

    const reordered = chain.toJSON();
    [reordered[1], reordered[2]] = [reordered[2]!, reordered[1]!];
    assert.equal(HashChain.verifyEntries(reordered).valid, false);
  });

  it('MerkleTree verifies inclusion proofs and rejects the wrong leaf', () => {
    const leaves = ['a', 'b', 'c', 'd'].map(v => sha256(v));
    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(2);

    assert.equal(MerkleTree.verifyProof(leaves[2]!, proof, tree.root), true);
    assert.equal(MerkleTree.verifyProof(sha256('wrong'), proof, tree.root), false);
  });

  it('round-trips receipts and bundles, then fails after mutation', () => {
    const receipt = createReceipt({
      runId: 'run_20260429_001',
      gitSha: 'abc123',
      action: 'truth-loop-verdict',
      payload: { verdict: 'progress_real_but_not_done', score: 8.7 },
      createdAt: '2026-04-29T10:03:00.000Z',
    });

    assert.equal(receipt.schemaVersion, 'evidence-chain.v1');
    assert.equal(receipt.verificationStatus, 'unverified');
    assert.equal(verifyReceipt(receipt).valid, true);

    const mutatedReceipt = { ...receipt, payload: { verdict: 'complete', score: 10 } };
    assert.equal(verifyReceipt(mutatedReceipt).valid, false);

    const bundle = createEvidenceBundle({
      runId: 'run_20260429_001',
      gitSha: 'abc123',
      bundleId: 'bundle_truth_loop',
      evidence: [
        { kind: 'artifact', hash: sha256('artifact') },
        { kind: 'verdict', hash: receipt.hash },
      ],
      createdAt: '2026-04-29T10:04:00.000Z',
    });

    assert.equal(bundle.merkleRoot.length, 64);
    assert.equal(verifyBundle(bundle).valid, true);

    const mutatedBundle = {
      ...bundle,
      evidence: [...bundle.evidence, { kind: 'late-extra', hash: sha256('late') }],
    };
    assert.equal(verifyBundle(mutatedBundle).valid, false);
  });
});
