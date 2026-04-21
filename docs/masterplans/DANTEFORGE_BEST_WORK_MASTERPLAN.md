# DanteForge Best-Work Masterplan

**Date:** 2026-04-18  
**Version Target:** v0.17.x excellence pass  
**Status:** Proposed  
**Goal:** Turn DanteForge from "credible and ambitious" into a project that feels fast, sharp, evidence-closed, clean to operate, and unmistakably ready for a real public push.

## Best-Work Definition

DanteForge reaches "best work" when all of the following are true at the same time:

- `npm run verify` completes reliably enough to be part of the normal daily loop instead of an occasional endurance event.
- `npm run build` no longer spends most of its wall time in declaration generation and feels proportionate to the size of the repo.
- The active readiness guide reflects current receipts for the current package version and current git SHA instead of stale historical evidence.
- Common repo flows (`verify`, `build`, readiness sync, release proof) leave a predictable and intentionally clean working tree.
- The public story is easy to understand on the first read: one flagship workflow, clearly supported surfaces, and a smaller set of claims.
- Release proof resolves into one obvious artifact chain rather than a scattered collection of partially overlapping docs.

## Current Truth

As of this masterplan:

- `npm run verify` is green, but it is still too slow to feel good in the daily development loop.
- `npm run build` is green, but the DTS phase dominates total runtime and makes build feedback too expensive.
- The active readiness guide is structurally honest, but it can still point at stale receipts and old versions if the evidence loop is not refreshed end to end.
- The repo still accumulates a lot of visible churn across docs, proof artifacts, and example outputs.
- The command surface is powerful, but the first-read product story is still broader than it should be.

## Non-Goals

Until this masterplan is complete:

- Do **not** add new flagship commands or new matrix dimensions.
- Do **not** expand GA claims beyond surfaces backed by current receipts and release proof.
- Do **not** add more examples until the official example is clean, persuasive, and stable.
- Do **not** spend time on aesthetic polish that does not improve speed, truthfulness, cleanliness, onboarding, or release clarity.

## Execution Order

1. BW-1 verify throughput and deterministic test-lane control.
2. BW-2 build speed and declaration output isolation.
3. BW-3 evidence freshness and readiness auto-sync.
4. BW-4 repo cleanliness after common flows.
5. BW-5 flagship story tightening.
6. BW-6 release proof simplification.
7. BW-7 official example showcase pass.

## Task Inventory

### BW-1. [L] Rebuild verify around explicit slow-lane control

- **What:** Replace the current "one giant alphabetical test invocation" approach with an explicit runner plan that knows about slow lanes, captures timing, and prevents child-process timeout flakes from being the thing that decides whether `npm run verify` is trustworthy.
- **Where:** `scripts/run-test-suite.mjs`, `package.json`, `tests/helpers/cli-runner.ts`, slow suites under `tests/ascend*.test.ts`, `tests/autoforge*.test.ts`, `tests/verify-json-e2e.test.ts`, and new helper scripts if needed such as `scripts/test-manifest.mjs` or `scripts/test-timings.mjs`.
- **Why:** The repo now passes verify, but the default verify path still costs too much time and remains vulnerable to saturated-suite timing behavior.
- **Verification:** `npm test`; targeted slow-lane test commands; confirm no helper-driven CLI test returns `status: null`; record and compare timing before/after on the same machine; keep `npm run verify` green.
- **Dependencies:** None.

### BW-2. [L] Cut build time by separating bundle work from declaration work

- **What:** Reshape the build so bundling and declaration emit are intentional, measurable stages rather than one `tsup` path dominated by DTS generation; scope declaration emit to the published surface and avoid paying for unnecessary graph work every build.
- **Where:** `tsup.config.ts`, `package.json`, new build tsconfig files such as `tsconfig.build.json` or `tsconfig.types.json`, published entrypoints `src/cli/index.ts` and `src/sdk.ts`, and build coverage such as `tests/build-isolation.test.ts`.
- **Why:** A build that is technically correct but operationally expensive still drags down release confidence and local iteration speed.
- **Verification:** `npm run build`; compare total runtime and declaration runtime before/after; `npm pack --dry-run`; confirm dist artifacts and published typings remain correct.
- **Dependencies:** None, but it should land before the final release rehearsal.

### BW-3. [M] Close the evidence loop so active readiness can never go stale

- **What:** Make the active readiness guide and related proof surfaces fail closed on stale version, stale SHA, or missing current receipts; wire the evidence refresh path so current verify/release/live runs become the authoritative source of truth automatically.
- **Where:** `src/cli/commands/verify.ts`, `src/core/readiness-doc.ts`, `scripts/sync-operational-readiness.ts`, `scripts/proof-receipts.mjs`, `scripts/check-release-proof.mjs`, `scripts/check-truth-surface.mjs`, `docs/Operational-Readiness-v0.17.0.md`, `README.md`, `RELEASE.md`, `tests/readiness-doc.test.ts`, `tests/release-docs.test.ts`, `tests/release-check.test.ts`.
- **Why:** The doc architecture is better now, but it still does not feel finished while the active readiness view can present old receipts as if they were current truth.
- **Verification:** `npm run verify`; `npm run release:proof`; `npm run sync:readiness-doc`; `npm run check:truth-surface`; confirm the active guide reports the current package version and current git SHA.
- **Dependencies:** BW-1 and BW-2, because the best evidence loop depends on a fast enough verify/build path.

### BW-4. [M] Make the repo clean after the flows people actually run

- **What:** Remove or quarantine unintended churn from docs, proof generation, SBOM output, and example artifacts so the repo stays readable after normal workflows; teach hygiene checks to distinguish approved evidence from accidental residue.
- **Where:** `.gitignore`, `scripts/check-repo-hygiene.mjs`, `scripts/sync-dantecode.mjs`, `scripts/generate-sbom.mjs`, `docs/Operational-Readiness-v*.md`, `docs/Release-History.md`, `examples/todo-app/.danteforge/`, `examples/todo-app/evidence/`, `tests/example-todo-app.test.ts`.
- **Why:** A project cannot feel finished when everyday commands leave the tree looking noisy or ambiguous.
- **Verification:** Start from a clean checkout or simulated-fresh checkout, run `npm run verify`, `npm run build`, `npm run sync:readiness-doc`, and `npm run check:repo-hygiene:strict`; confirm only intentional outputs remain.
- **Dependencies:** BW-1 through BW-3, because those tasks define the flows whose output must stay clean.

### BW-5. [M] Narrow the flagship story to one obvious product shape

- **What:** Rewrite top-level docs, help text, and showcase surfaces so first-time users encounter one primary path and a clearly labeled set of supported surfaces; move the long tail from the pitch surface into reference material.
- **Where:** `README.md`, `RELEASE.md`, `docs/COMMAND_REFERENCE.md`, `docs/ARCHITECTURE.md`, `src/cli/commands/help.ts`, `src/cli/commands/showcase.ts`, `vscode-extension/README.md`, `docs/tutorials/`, `docs/case-studies/`.
- **Why:** DanteForge is now stronger than its first-read presentation. The next step is not adding more commands; it is making the flagship path feel unmistakable.
- **Verification:** Regenerate affected docs; rerun help/showcase/doc tests such as `tests/showcase.test.ts`, `tests/ci-golden-paths.test.ts`, and any command-reference coverage; sanity-check the README first screen for clarity.
- **Dependencies:** BW-3, so the story is aligned to real evidence rather than aspirational wording.

### BW-6. [M] Simplify release proof into one authoritative chain

- **What:** Consolidate the release story so there is one obvious authority path: active readiness guide, release proof receipt, proof pack, SBOM, notices, VSIX artifact, and supported-surface evidence; clearly separate active readiness from archived historical docs.
- **Where:** `scripts/check-release-proof.mjs`, `scripts/proof-receipts.mjs`, `docs/Operational-Readiness-v*.md`, `docs/Release-History.md`, `.github/workflows/ci.yml`, `.github/workflows/live-canary.yml`, `.github/workflows/release.yml`, `vscode-extension/.artifacts/`, `sbom/`.
- **Why:** The repo already has a lot of real release machinery, but the public proof surface is still heavier and more fragmented than it should be.
- **Verification:** `npm run release:proof`; `npm run release:check`; inspect the generated receipt, readiness guide, and proof-pack links; confirm the three supported surfaces are understandable without side knowledge.
- **Dependencies:** BW-3 and BW-4.

### BW-7. [S] Keep the official example showcase-grade and truth-grade at once

- **What:** Finish the official example so it demonstrates the core CLI story cleanly, stays runnable, and does not regress into compiled or scratch artifact sprawl.
- **Where:** `examples/todo-app/README.md`, `examples/todo-app/package.json`, `examples/todo-app/evidence/`, `examples/todo-app/src/`, `examples/todo-app/tests/`, `tests/example-todo-app.test.ts`, `docs/case-studies/public-example.md`.
- **Why:** One clean, honest, persuasive example is a stronger proof point than many half-maintained examples.
- **Verification:** Example-focused tests; example README accuracy pass; proof/case-study links match the actual example artifacts; repo-hygiene checks remain green after example workflows.
- **Dependencies:** BW-4 and BW-5.

## Parallelization Notes

- BW-1 and BW-2 can begin in parallel if ownership is split carefully, but both touch `package.json`, so one person should own final script integration.
- BW-5 can start once BW-3 defines the final truth surface.
- BW-7 can run in parallel with BW-6 once the cleanliness rules from BW-4 are settled.

## Final Verification Sweep

Run this sequence as the final authority pass:

1. `npm run verify`
2. `npm run build`
3. `npm run sync:readiness-doc`
4. `npm run check:truth-surface`
5. `npm run check:repo-hygiene:strict`
6. `npm run release:proof`
7. `npm run release:check`

## Ship Criteria

The masterplan is complete when:

- the default quality loop is fast enough that the team will actually use it constantly,
- the active readiness guide is always current or obviously wrong,
- the working tree stays readable after normal commands,
- the README/help/release story feels focused instead of sprawling,
- and release proof reads like one coherent system rather than several adjacent systems.
