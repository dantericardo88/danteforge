# Changelog

All notable changes to `@danteforge/evidence-chain` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-29

First stable release. The package now ships compiled `dist/` output with declaration files; consumers import via the standard `"main"`/`"types"`/`"exports"` resolution.

### Stability boundary

The following surfaces are **frozen for the v1.x line**:

- `ProofEnvelope` shape and its `schemaVersion: 'evidence-chain.v1'` literal
- `Receipt<T>` and `EvidenceBundle<T>` shapes (both extend `ProofEnvelope`)
- `HashChain<T>`, `ReceiptChain<T>`, and `MerkleTree` class APIs (constructor, `append`, `headHash`, `toJSON`, `verifyIntegrity`, `getProof`, `verifyProof`)
- All exported pure functions (`stableJSON`, `sha256`, `hashDict`, `createReceipt`, `verifyReceipt`, `createEvidenceBundle`, `verifyBundle`)

Breaking changes to any of the above will require a 2.0 major bump.

Additive changes (new optional fields, new helper exports) ship as minor releases.

### Added (since 0.1.0)

- `main` and `types` entry points pointing at compiled `dist/`
- Build script (`tsc -p tsconfig.json`) emitting JS + `.d.ts` + source maps
- `prepublishOnly` hook that cleans + builds before any publish
- `sideEffects: false` for tree-shaking
- `repository`, `homepage`, `bugs`, `keywords`, `engines` metadata
- `publishConfig.access: public` for scoped-package publishing
- LICENSE file (MIT)
- This CHANGELOG
- Comprehensive README with quick start + public API + stability promise

### Unchanged

The TypeScript source is byte-identical to 0.1.0. No runtime behavior changes.

## [0.1.0] — 2026-04-29

Initial implementation, internal-only release (not published to npm). Shipped as part of DanteForge Pass 11 — Proof Gate Sprint.

### Added

- `stableJSON(value)` — deterministic JSON serialization (sorted keys)
- `sha256(input)` and `hashDict(value)` — SHA-256 hashing primitives
- `HashChain<T>` and `ReceiptChain<T>` — append-only chains with head hash + integrity verification
- `MerkleTree` — root generation + inclusion proof verification
- `createReceipt`, `verifyReceipt` — single-receipt envelope + verification
- `createEvidenceBundle`, `verifyBundle` — multi-receipt bundles with Merkle root
- `ProofEnvelope` interface as the shared envelope shape
- `EVIDENCE_CHAIN_SCHEMA_VERSION` constant locked to `'evidence-chain.v1'`

[1.0.0]: https://github.com/dantericardo88/danteforge/tree/main/packages/evidence-chain
[0.1.0]: https://github.com/dantericardo88/danteforge/tree/main/packages/evidence-chain
