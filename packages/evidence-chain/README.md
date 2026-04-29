# @danteforge/evidence-chain

> Zero-dependency cryptographic evidence primitives for tamper-evident agent receipts.

[![npm version](https://img.shields.io/npm/v/@danteforge/evidence-chain.svg)](https://www.npmjs.com/package/@danteforge/evidence-chain)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The substrate behind DanteForge's three-way promotion gate. Use it to produce **mechanically verifiable** receipts for AI agent runs, scoring outputs, harvest evidence, and any other artifact whose provenance must be checkable by an independent party.

**v1.x scope**: SHA-256 + stable JSON + hash chain + Merkle tree + receipt/bundle verification. **No keys.** No external timestamping. Tamper-evidence without identity-binding. Ed25519 signing is deferred until the receipt substrate is stable across sister repos.

## Why this exists

Most agent tooling optimizes for *output*. This package optimizes for **earned belief** — every receipt carries a content hash, every chain links to the prior link, every bundle exposes a Merkle root, every artifact can be re-verified by anyone with the package and the receipt. "Trust the chain" becomes "verify the chain or fail closed."

If the data was tampered with, verification fails. The receipt is the gate.

## Install

```bash
npm install @danteforge/evidence-chain
```

Zero runtime dependencies. Node 18+ required (for `node:crypto`).

## Quick start

```typescript
import {
  createReceipt,
  verifyReceipt,
  createEvidenceBundle,
  aggregateChildReceipts,
  verifyBundle,
  HashChain,
  MerkleTree,
} from '@danteforge/evidence-chain';

// 1. Single receipt
const receipt = createReceipt({
  receiptId: 'task_42_outcome',
  action: 'task.complete',
  payload: { taskId: 42, result: 'shipped' },
  gitSha: 'abc123...',
});
const result = verifyReceipt(receipt);  // { valid: true, errors: [] }

// 2. Evidence bundle (multiple linked receipts)
const bundle = createEvidenceBundle({
  bundleId: 'sprint_42',
  evidence: [
    { step: 'plan',   summary: '...', score: 9.1 },
    { step: 'forge',  summary: '...', score: 9.0 },
    { step: 'verify', summary: '...', score: 9.5 },
  ],
  gitSha: 'abc123...',
});
const bundleResult = verifyBundle(bundle);

// 2b. Aggregate child receipts from multiple agents/repos into one parent proof
const aggregate = aggregateChildReceipts('run_42', [
  createReceipt({ action: 'codex.patch', payload: { repo: 'DanteForge' } }),
  createReceipt({ action: 'claude.review', payload: { repo: 'DanteCode' } }),
]);
const aggregateResult = verifyBundle(aggregate);

// 3. Append-only hash chain
const chain = new HashChain<{ event: string; ts: string }>();
chain.append({ event: 'session.start', ts: '...' });
chain.append({ event: 'task.complete', ts: '...' });
const integrity = chain.verifyIntegrity();  // { valid: true, errors: [] }

// 4. Merkle tree with inclusion proofs
const tree = new MerkleTree(['hash1', 'hash2', 'hash3', 'hash4']);
const proof = tree.getProof(1);
const proofValid = MerkleTree.verifyProof('hash2', proof.proof, tree.root);
```

## Public API

### Constants
- `EVIDENCE_CHAIN_SCHEMA_VERSION` — `'evidence-chain.v1'` (lock-frozen for v1.x)
- `ZERO_HASH` — sentinel for chain head

### Hashing
- `stableJSON(value)` — deterministic JSON serialization (sorted keys, undefined-stripped)
- `sha256(input)` — hex-encoded SHA-256 of string or `Uint8Array`
- `hashDict(value)` — convenience: `sha256(stableJSON(value))`

### Receipts
- `createReceipt<T>({ receiptId, action, payload, gitSha?, prevHash?, createdAt? })` → `Receipt<T>`
- `verifyReceipt(receipt)` → `VerificationResult` with `{ valid, errors, expectedHash, actualHash }`

### Bundles (multi-receipt with Merkle root)
- `createEvidenceBundle<T>({ bundleId, evidence: T[], gitSha?, prevHash?, createdAt? })` → `EvidenceBundle<T>`
- `aggregateChildReceipts(runId, children)` → `EvidenceBundle<Receipt<unknown>>`
- `verifyBundle(bundle)` → `VerificationResult`

### Chains (append-only)
- `new HashChain<T>(entries?)` → `.append(payload, opts?)`, `.headHash`, `.toJSON()`, `.verifyIntegrity()`
- `new ReceiptChain<T>(receipts?)` → `.append(input)`, `.headHash`, `.toJSON()`, `.verifyIntegrity()`
- `HashChain.verifyEntries<TEntry>(entries)` — verify a chain reconstructed from JSON

### Merkle trees
- `new MerkleTree(leaves: string[])` → `.root`, `.getProof(index)`
- `MerkleTree.verifyProof(leafHash, proofSteps, expectedRoot)` → `boolean`

### Types
`VerificationStatus`, `VerificationResult`, `ProofEnvelope`, `Receipt`, `CreateReceiptInput`, `EvidenceBundle`, `CreateEvidenceBundleInput`, `HashChainEntry`, `HashChainAppendOptions`, `MerkleProofStep`, `MerkleInclusionProof`.

## ProofEnvelope schema (v1)

Every receipt and bundle carries a proof envelope:

```typescript
interface ProofEnvelope {
  schemaVersion: 'evidence-chain.v1';
  runId?: string;
  receiptId?: string;
  gitSha?: string | null;
  createdAt: string;          // ISO 8601
  payloadHash: string;        // sha256(stableJSON(payload))
  prevHash: string;           // ZERO_HASH if first in chain
  merkleRoot?: string;        // bundles only
  verificationStatus: 'unverified' | 'valid' | 'invalid';
}
```

**Stability promise (v1.x):** No required field will be removed. Optional fields may be added. A new `schemaVersion` literal will be introduced for any breaking change. Consumers should always check `schemaVersion === 'evidence-chain.v1'` before deserializing.

## Use cases

- **AI agent receipts** — every tool call, decision, or output gets a hash-anchored receipt; chain replay lets auditors verify nothing was inserted out of order.
- **Score / verification gates** — promotion logic refuses to advance unless the artifact's bundle verifies.
- **Cross-repo handoffs** — DanteForge → DanteCode → DanteAgents handoffs use the same bundle shape; consumers verify provenance at every hop.
- **Multi-agent parent proofs** — sibling agents produce child receipts; `aggregateChildReceipts` folds them into one parent bundle for promotion gates.
- **MCP tool calls** — when an agent host (Cursor, Aider, Claude Code) invokes a DanteForge MCP tool, the response can include a verifiable receipt so the host can prove what it received.
- **Evidence harvest manifests** — OSS pattern harvest, score snapshots, and any structured output ships with a Merkle-rooted bundle.

## What this is NOT (yet)

- **Not signed.** Tampering is detectable; identity is not bound. A future v1.x/v2 signing layer can add Ed25519 detached signatures once key management is deliberately designed.
- **Not externally timestamped.** Self-anchored chain is fine for v1; v2 may add Sigstore / OpenTimestamps integration.
- **Not post-quantum.** SHA-256 has known weaknesses against future quantum adversaries; v3+ may switch to SHA-3 or hash-based signatures if the threat model demands it.

## Versioning

This package follows [Semantic Versioning](https://semver.org/). The `ProofEnvelope` shape and the public function signatures are stability boundaries — breaking changes to either bump the major version. New optional fields and new exported helpers can ship in minor versions.

See [CHANGELOG.md](./CHANGELOG.md) for release history.

## Related

- [`danteforge`](https://www.npmjs.com/package/danteforge) — agentic development CLI; uses this package for the three-way promotion gate.
- [JSON schemas](https://github.com/dantericardo88/danteforge/tree/main/src/spine/schemas) — frozen v1 schemas for Truth Loop artifacts/evidence/verdicts.

## License

[MIT](./LICENSE)
