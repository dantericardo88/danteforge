# DanteForge v0.10.0 Operational Readiness

This document reflects the current shipped state of DanteForge `0.10.0` (Category-Defining Edition).

Historical readiness guides and planning snapshots are indexed in [Release-History.md](Release-History.md).

## New in v0.10.0

### PDSE Toolchain Grounding
- `src/core/pdse-toolchain.ts` — gathers real tsc/test/lint metrics and applies them to PDSE scores
- `src/core/pdse-snapshot.ts` — writes `.danteforge/latest-pdse.json` for VS Code status bar polling
- PDSE scores now reflect actual build health, not just LLM opinions

### Auto-Lessons Capture
- `src/core/auto-lessons.ts` — detects tsc regression, test regression, score drop, and convergence stall events
- Deterministic lesson templates (no LLM required) wired into autoforge-loop best-effort block

### Cross-Project Wiki Federation
- `src/core/wiki-federation.ts` — promotes high-confidence entities (≥0.75) to `~/.danteforge/global-wiki/`
- `getWikiContextForPrompt` queries global wiki (30% budget) in addition to local wiki

### Convergence Loop Escape Hatch
- `--pause-at <score>` flag on `danteforge autoforge` — writes `AUTOFORGE_PAUSED` file and breaks loop
- `danteforge resume` — reads pause file, deletes it, and restarts loop from saved snapshot

### Token ROI Visibility
- `src/core/token-roi.ts` — append-only JSONL at `.danteforge/token-roi.jsonl`
- `formatROISummary` — Markdown table showing tokens, score delta, efficiency, cost per wave

### VS Code First-Class Enhancement
- 5 new commands: `wikiQuery`, `wikiStatus`, `pdseScore`, `resume`, `pauseAt`
- Status bar polls `.danteforge/latest-pdse.json` every 5s showing live PDSE score

## Verification Surface

- 2444+ tests (node:test with tsx), 0 failures
- TypeScript strict mode, ES2022 target
- ESLint clean
- Anti-stub scan clean (no TODO/FIXME/TBD in shipped implementation)
- tsup build produces a single ESM bundle (`dist/index.js`)
- Release gates: repo hygiene, CLI smoke, plugin manifests, install smoke, dry-run pack, third-party notices
- Release proof receipts: durable JSON plus Markdown artifacts at `.danteforge/evidence/release/`
- Live verify receipts: durable JSON plus Markdown artifacts at `.danteforge/evidence/live/`
- Verify receipts: durable JSON plus Markdown artifacts at `.danteforge/evidence/verify/`

## Current Launch Contract

Treat `0.10.0` as launch-ready only when all of the following are green:

1. `npm run release:proof`
2. `npm run release:check:strict`
3. `npm run release:check:simulated-fresh`
4. `npm run verify:live`
5. GitHub Actions `release-proof` and `live-proof`

`danteforge verify --release` remains a maintainer-local project-state verifier. It is intentionally not the CI publish authority.

## Known Outstanding Work

- Golden path E2E tests on clean Windows/macOS/Linux machines
- Cross-platform CI matrix in GitHub Actions
- Onboarding benchmarks and ecosystem integrations
