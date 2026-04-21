> **ARCHIVED** - This document reflects the v0.9.2 release. For the current release surface see [Operational-Readiness-v0.17.0.md](Operational-Readiness-v0.17.0.md). Do not treat this file as current release truth.

# DanteForge v0.9.2 Operational Readiness

This document reflects the shipped state of DanteForge `0.9.2` (Swarm Edition) at the time of that release.

Historical readiness guides and planning snapshots are indexed in [Release-History.md](Release-History.md).

## New in v0.9.2

### Release Proof Hardening
- `check-release-proof.mjs` - CI-facing release proof entrypoint with durable release receipts
- `proof-receipts.mjs` - shared JSON plus Markdown receipt writers for live and release proof
- `.danteforge/evidence/release/latest.json` - authoritative release proof receipt
- `.danteforge/evidence/live/latest.json` - authoritative live verify receipt
- Release proof receipts now include packaged npm metadata, artifact hashes, and publish-provenance summary details

### Workflow Truth
- Release workflow split into `release-proof`, `live-proof`, and `publish`
- Publish is hard-gated on both proof jobs succeeding
- Release runs upload receipt artifacts plus `vscode-extension/.artifacts/danteforge.vsix`

### Packaging and Install Surface
- Root package, VS Code extension, plugin manifests, generated artifact stamps, release docs, and lockfiles align on `0.9.2`
- VS Code extension overrides `picomatch >= 2.3.2` so a fresh extension install no longer emits the prior high-severity audit warning

## Verification Surface

- 2038+ tests (node:test with tsx), 0 failures
- TypeScript strict mode, ES2022 target
- ESLint clean
- Anti-stub scan clean (no TODO/FIXME/TBD in shipped implementation)
- tsup build produces a single ESM bundle (`dist/index.js`)
- Release gates: repo hygiene, CLI smoke, plugin manifests, install smoke, dry-run pack, third-party notices
- Release proof receipts: durable JSON plus Markdown artifacts at `.danteforge/evidence/release/`
- Live verify receipts: durable JSON plus Markdown artifacts at `.danteforge/evidence/live/`
- Verify receipts: durable JSON plus Markdown artifacts at `.danteforge/evidence/verify/`

## Current Launch Contract

Treat `0.9.2` as launch-ready only when all of the following are green:

1. `npm run release:proof`
2. `npm run release:check:strict`
3. `npm run release:check:simulated-fresh`
4. `npm run verify:live`
5. GitHub Actions `release-proof` and `live-proof`

`danteforge verify --release` remains a maintainer-local project-state verifier. It is intentionally not the CI publish authority.

## Known Outstanding Work

- Golden path E2E tests on clean Windows/macOS/Linux machines
- VS Code extension status panel (project health surface)
- Cross-platform CI matrix in GitHub Actions
