// External-consumer smoke test for @danteforge/evidence-chain v1.0.0.
// This file lives OUTSIDE the DanteForge repo. It only uses what npm install
// gave us. If something works here, it works for any external user.

import {
  // Constants
  EVIDENCE_CHAIN_SCHEMA_VERSION,
  ZERO_HASH,
  // Hashing primitives
  stableJSON,
  sha256,
  hashDict,
  // Receipt API
  createReceipt,
  verifyReceipt,
  // Bundle API
  createEvidenceBundle,
  verifyBundle,
  // Classes
  HashChain,
  ReceiptChain,
  MerkleTree,
} from '@danteforge/evidence-chain';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// 1. Constants
record('EVIDENCE_CHAIN_SCHEMA_VERSION is v1', EVIDENCE_CHAIN_SCHEMA_VERSION === 'evidence-chain.v1', EVIDENCE_CHAIN_SCHEMA_VERSION);
record('ZERO_HASH is 64-char hex of zeros', /^0{64}$/.test(ZERO_HASH));

// 2. stableJSON: deterministic ordering
const jsonA = stableJSON({ b: 2, a: 1, c: { z: 9, y: 8 } });
const jsonB = stableJSON({ a: 1, b: 2, c: { y: 8, z: 9 } });
record('stableJSON produces identical output for differently-ordered keys', jsonA === jsonB);

// 3. sha256: deterministic, 64-hex
const h1 = sha256('hello');
const h2 = sha256('hello');
record('sha256 is deterministic', h1 === h2);
record('sha256 returns 64-char hex', /^[a-f0-9]{64}$/.test(h1));
record('sha256 differs for different inputs', sha256('hello') !== sha256('world'));

// 4. hashDict: hashing structured payloads
const dictHash = hashDict({ task: 'demo', score: 9.5 });
record('hashDict returns 64-char hex', /^[a-f0-9]{64}$/.test(dictHash));
record('hashDict order-independent', hashDict({ a: 1, b: 2 }) === hashDict({ b: 2, a: 1 }));

// 5. createReceipt + verifyReceipt — happy path
const receipt = createReceipt({
  receiptId: 'smoke_test_receipt_1',
  action: 'smoke.test',
  payload: { msg: 'hello world', value: 42 },
  gitSha: 'abcd1234',
});
record('createReceipt returns object with hash', typeof receipt.hash === 'string' && receipt.hash.length === 64);
record('receipt has schemaVersion v1', receipt.schemaVersion === 'evidence-chain.v1');
record('receipt has expected receiptId', receipt.receiptId === 'smoke_test_receipt_1');
record('receipt has gitSha', receipt.gitSha === 'abcd1234');

const verResult = verifyReceipt(receipt);
record('verifyReceipt returns valid for unmodified receipt', verResult.valid === true);
record('verifyReceipt errors[] is empty when valid', Array.isArray(verResult.errors) && verResult.errors.length === 0);

// 6. Tamper detection — modify the payload after-the-fact
const tampered = { ...receipt, payload: { ...receipt.payload, value: 999 } };
const tamperedResult = verifyReceipt(tampered);
record('verifyReceipt detects tampered payload', tamperedResult.valid === false);
record('tampered result has errors[]', tamperedResult.errors.length > 0);

// 7. createEvidenceBundle + verifyBundle
const bundle = createEvidenceBundle({
  bundleId: 'smoke_test_bundle',
  evidence: [
    { step: 'one', value: 1 },
    { step: 'two', value: 2 },
    { step: 'three', value: 3 },
  ],
  gitSha: 'abcd1234',
});
record('bundle has merkleRoot', typeof bundle.merkleRoot === 'string' && bundle.merkleRoot.length === 64);
record('bundle has 3 evidenceHashes', Array.isArray(bundle.evidenceHashes) && bundle.evidenceHashes.length === 3);

const bundleVer = verifyBundle(bundle);
record('verifyBundle returns valid for unmodified bundle', bundleVer.valid === true);

// 8. Bundle tamper detection
const tamperedBundle = { ...bundle, evidence: [...bundle.evidence.slice(0, 2), { step: 'three', value: 999 }] };
const tamperedBundleVer = verifyBundle(tamperedBundle);
record('verifyBundle detects tampered evidence', tamperedBundleVer.valid === false);

// 9. HashChain
const chain = new HashChain();
chain.append({ event: 'session.start', ts: '2026-04-29T00:00:00Z' });
chain.append({ event: 'task.complete', ts: '2026-04-29T00:01:00Z' });
chain.append({ event: 'session.end', ts: '2026-04-29T00:02:00Z' });
record('HashChain.append produces non-empty headHash', typeof chain.headHash === 'string' && chain.headHash.length === 64);

const chainEntries = chain.toJSON();
record('HashChain.toJSON returns 3 entries', Array.isArray(chainEntries) && chainEntries.length === 3);

const chainCheck = chain.verifyIntegrity();
record('HashChain.verifyIntegrity returns valid for honest chain', chainCheck.valid === true);

// HashChain tamper detection — modify a payload after the fact
const tamperedEntries = JSON.parse(JSON.stringify(chainEntries));
tamperedEntries[1].payload.event = 'task.tampered';
const tamperedChainCheck = HashChain.verifyEntries(tamperedEntries);
record('HashChain.verifyEntries detects tampered payload', tamperedChainCheck.valid === false);

// 10. MerkleTree + inclusion proof
// getProof returns a MerkleProofStep[] (flat array). The MerkleInclusionProof
// interface is the SHAPE used inside EvidenceBundle.inclusionProofs, not the
// return type of getProof.
const leaves = [sha256('leaf-a'), sha256('leaf-b'), sha256('leaf-c'), sha256('leaf-d')];
const tree = new MerkleTree(leaves);
record('MerkleTree.root is non-empty', typeof tree.root === 'string' && tree.root.length === 64);

const proofSteps = tree.getProof(2);  // leaf-c
record('MerkleTree.getProof returns flat array of proof steps', Array.isArray(proofSteps) && proofSteps.length > 0);

const proofValid = MerkleTree.verifyProof(leaves[2], proofSteps, tree.root);
record('MerkleTree.verifyProof accepts valid inclusion proof', proofValid === true);

const proofInvalid = MerkleTree.verifyProof(sha256('not-a-leaf'), proofSteps, tree.root);
record('MerkleTree.verifyProof rejects invalid leaf', proofInvalid === false);

// Confirm the inclusion-proof shape inside an EvidenceBundle (the real consumer of MerkleInclusionProof)
record('bundle.inclusionProofs is an array of MerkleInclusionProof', Array.isArray(bundle.inclusionProofs) && bundle.inclusionProofs.length === 3 && typeof bundle.inclusionProofs[0].leafHash === 'string' && Array.isArray(bundle.inclusionProofs[0].proof));

// 11. ReceiptChain
const rChain = new ReceiptChain();
rChain.append({ receiptId: 'r1', action: 'a', payload: { v: 1 }, gitSha: 'sha1' });
rChain.append({ receiptId: 'r2', action: 'a', payload: { v: 2 }, gitSha: 'sha1' });
record('ReceiptChain.headHash is non-empty', typeof rChain.headHash === 'string' && rChain.headHash.length === 64);
record('ReceiptChain.verifyIntegrity returns valid', rChain.verifyIntegrity().valid === true);

// 12. Article X: zero runtime dependencies
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const installedPkg = JSON.parse(readFileSync(pathResolve(here, 'node_modules/@danteforge/evidence-chain/package.json'), 'utf-8'));
record('package has no dependencies field or empty', !installedPkg.dependencies || Object.keys(installedPkg.dependencies).length === 0);

// Summary
const total = results.length;
const passed = results.filter(r => r.ok).length;
const failed = total - passed;
console.log('\n=========================================');
console.log(`SMOKE TEST RESULT: ${passed}/${total} passed`);
console.log('=========================================');

// Emit JSON for proof anchoring
const summary = {
  package: '@danteforge/evidence-chain',
  version: installedPkg.version,
  schemaVersion: EVIDENCE_CHAIN_SCHEMA_VERSION,
  runAt: new Date().toISOString(),
  total,
  passed,
  failed,
  status: failed === 0 ? 'pass' : 'fail',
  results,
};
console.log('\nSMOKE_JSON_BEGIN');
console.log(JSON.stringify(summary, null, 2));
console.log('SMOKE_JSON_END');

process.exit(failed === 0 ? 0 : 1);
