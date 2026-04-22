# DanteForge Truth Hardening Masterplan

**Date:** 2026-04-16  
**Status:** In execution  
**Goal:** Close the gaps found in the repo assessment by making verification green, workflow text canonical, readiness docs evidence-backed, and the bundled example free of noisy truth-surface drift.

## Done Criteria

- `npm run verify` passes at the repo root.
- Workflow pipeline text comes from one canonical source for CLI/help/doc-generation surfaces.
- The active operational readiness guide is generated from current receipt data instead of static success claims.
- The bundled `examples/todo-app` snapshot stays intentionally small and no longer creates hidden `.danteforge` churn.

## Task Inventory

### MP-1. Restore fail-closed verification

- **What:** Add regression coverage for forge failure lesson capture, then fix the executor type mismatch so `npm run verify` goes green again.
- **Where:** `tests/executor.test.ts`, `src/harvested/gsd/agents/executor.ts`, `src/cli/commands/lessons.ts` if signature alignment is needed.
- **Why:** The repo currently advertises fail-closed verification, but the default verify path fails on a TypeScript regression.
- **Verification:** Run the new targeted executor test first and confirm RED; then run the same test plus `npm run verify` and confirm GREEN.
- **Dependencies:** None.

### MP-2. Canonicalize workflow text

- **What:** Introduce a single workflow metadata source and route help/doc-generation/synthesis text through it instead of hand-copied pipeline strings.
- **Where:** New canonical source under `src/core/`; update `src/core/workflow-enforcer.ts`, `src/cli/commands/help.ts`, `src/cli/commands/synthesize.ts`, `src/cli/commands/docs.ts`, and truth-surface tests/docs that depend on the pipeline wording.
- **Why:** The repo currently presents multiple different workflow stories across AGENTS, README, help, synthesize, and architecture docs.
- **Verification:** Add/update tests proving the canonical pipeline string appears in generated/help surfaces; run targeted tests plus repo verify.
- **Dependencies:** MP-1 only insofar as `npm run verify` must be green at the end.

### MP-3. Generate evidence-backed readiness docs

- **What:** Replace static operational-readiness claims with a generated summary that reads the latest verify/live/release receipts and reports their actual status, timestamps, SHAs, and proof paths.
- **Where:** New readiness generator under `scripts/`; update `docs/Operational-Readiness-v0.17.0.md`, `README.md`, `RELEASE.md`, `scripts/proof-receipts.mjs`, `scripts/check-truth-surface.mjs`, and readiness/release tests.
- **Why:** The current readiness guide contains stale hard-coded claims that can drift away from the real repo state.
- **Verification:** Add tests that assert the readiness guide is receipt-driven and no longer hard-codes green-gate statements; regenerate the guide from current receipts and rerun relevant tests.
- **Dependencies:** MP-1 so the verify receipt can be refreshed from a green run.

### MP-4. Tighten the example truth surface

- **What:** Make the bundled `examples/todo-app` snapshot intentionally shippable by whitelisting only the required example artifacts and excluding generated wiki/history clutter.
- **Where:** `.gitignore`, `examples/todo-app/.danteforge/`, `examples/todo-app/README.md`, `tests/example-todo-app.test.ts`, and any repo-hygiene/truth-surface checks that assert the snapshot shape.
- **Why:** The example is meant to prove the pipeline honestly, but extra generated `.danteforge` entries keep creating review noise.
- **Verification:** Targeted example test coverage plus `npm run check:repo-hygiene` and full `npm run verify`.
- **Dependencies:** None.

## Execution Order

1. MP-1 verification regression via TDD.
2. MP-2 canonical workflow source and surface rewiring.
3. MP-3 readiness generation and proof-backed docs refresh.
4. MP-4 example truth-surface cleanup.
5. Final repo verification and receipt/doc refresh.

## Final Verification Sweep

- `npm test`
- `npm run check:repo-hygiene`
- `npm run verify`
- Regenerate the active readiness guide from receipts after the green verify run.
