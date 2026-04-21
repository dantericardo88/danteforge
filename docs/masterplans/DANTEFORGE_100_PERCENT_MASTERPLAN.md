# DanteForge 100 Percent Completion Masterplan

Date: 2026-04-20
Status: Active source of truth for the 100 percent completion pass
Scope: Close the remaining internal finish-line gaps and ship a supported Codex install/distribution path

## 1. Authority

This document is the working authority for the final internal completion push.

It extends the current finish-line plan and becomes the source of truth whenever install/distribution work overlaps with scoring work:

- `docs/masterplans/DANTEFORGE_FINISH_LINE_MASTERPLAN.md`
- `docs/Standalone-Assistant-Setup.md`
- Codex-related install notes in `README.md`

The goal is not just "healthy repo." The goal is "healthy repo, truthful self-verification, and a Codex install surface that we can reliably reproduce on other machines."

## 2. Current Truth

As of 2026-04-20:

- `npm run verify` passes
- `npm run build` passes
- `npm run check:truth-surface` passes
- `npm run release:proof` passes
- `node dist/index.js verify --json` still fails against stale workflow bookkeeping

Current internal score posture:

- strict full score: about `9.28/10`
- internal scoped finish score, excluding adoption: about `9.44/10`

Remaining below-target gaps from the finish-line pass:

1. `operator_readiness`
2. `maintainability`

New completion requirement added by this plan:

3. a proven Codex install path that works for:
   - native local Codex workflow usage
   - explicit DanteForge CLI fallback via skill/tool use
   - repeatable install on other machines from npm, tarball, or source

## 3. 100 Percent Definition

DanteForge is "100 percent complete" for this internal phase when all of the following are true:

1. Every in-scope quality dimension is `>= 9.0/10`.
2. `node dist/index.js verify --json` passes for the real current repo state, or fails only for real current issues.
3. Verify receipts and readiness docs reflect the current SHA and latest truth.
4. Maintainability rises above the current `8.7` floor and has regression protection.
5. Local Codex can use DanteForge in three supported ways:
   - native slash-command workflow through `~/.codex/commands`
   - explicit CLI fallback through `~/.codex/skills/danteforge-cli/SKILL.md`
   - utility command/tool path through `~/.codex/config.toml` plus direct `danteforge` execution
6. Another machine can install DanteForge for Codex from:
   - published npm package
   - packaged tarball
   - source checkout / contributor flow
7. The install story is documented once, cross-linked everywhere else, and backed by automated smoke coverage.
8. These proof gates all pass:
   - `npm run verify`
   - `npm run build`
   - `npm run check:truth-surface`
   - `npm run release:proof`
   - `npm run release:check:install-smoke`

## 4. Supported Codex Install Contract

This is the install contract we should work toward and then defend with tests.

### 4A. Native local Codex workflow path

Expected surfaces:

- `~/.codex/commands/*.md`
- `~/.codex/AGENTS.md`
- repo-local `.codex/config.toml`

Expected behavior:

- workflow slash commands such as `/spark`, `/magic`, `/autoforge`, `/party`, and `/verify` run natively in Codex
- repo `AGENTS.md` still wins inside DanteForge repos
- user-level bootstrap fills the gap outside DanteForge repos without hijacking native slash commands

### 4B. Explicit DanteForge CLI fallback path

Expected surfaces:

- `~/.codex/skills/danteforge-cli/SKILL.md`
- installed `danteforge` binary or local `npx danteforge`

Expected behavior:

- if native workflow command files are unavailable, Codex still has an explicit, documented CLI path
- terminal-style execution stays intentional instead of accidental

### 4C. Utility command and tool path

Expected surfaces:

- `~/.codex/config.toml`

Expected behavior:

- only non-colliding utility aliases are installed
- native workflow slash commands are never replaced by shell aliases
- common repair and verification actions stay one command away

### 4D. Cross-machine install modes

Supported modes:

1. npm global install
   - `npm install -g danteforge`
   - `danteforge setup assistants --assistants codex`
2. tarball install
   - `npm pack`
   - `npm install -g ./danteforge-<version>.tgz`
   - `danteforge setup assistants --assistants codex`
3. source / contributor install
   - `npm ci`
   - `npm run verify:all`
   - `npm link`
   - `danteforge setup assistants --assistants codex`

## 5. Workstreams

Each workstream below includes What, Where, Why, Verification, and Dependencies. `[P]` means it can run in parallel once its dependencies are satisfied.

### C100-1. Verify and State Coherence

Priority: P0
Size: M

What:

- Make the operator-facing `verify` command evaluate the real repo condition instead of failing on stale workflow bookkeeping.
- Define which `STATE.yaml` fields are authoritative for repo self-verification and which are advisory.
- Ensure verify receipts refresh against the current workspace SHA and current workflow evidence.

Where:

- `src/cli/commands/verify.ts`
- `src/core/state.ts`
- `src/core/completion-tracker.ts`
- `src/core/verify-receipts.ts`
- `tests/verify-json-e2e.test.ts`
- `tests/verify-light.test.ts`

Why:

This is the biggest remaining trust gap. Right now the engineering truth is better than DanteForge's own self-assessment surface.

Verification:

- `node dist/index.js verify --json`
- `npm run verify`
- targeted verify tests covering stale-state vs current-state behavior

Dependencies:

- none

### C100-2. Receipt Authority and Readiness Truth

Priority: P0
Size: M

What:

- Make the readiness guide consume the latest real verify outcome and current SHA.
- Stop stale verify receipts from remaining the apparent source of truth after fresh successful runs.
- Tighten the rendered proof story so docs match receipts and receipts match the repo.

Where:

- `src/core/readiness-doc.ts`
- `scripts/sync-operational-readiness.ts`
- `docs/Operational-Readiness-v<version>.md`
- `tests/readiness-doc.test.ts`
- any stale/current receipt coverage touched by C100-1

Why:

Operator readiness is a truth-surface problem now, not a capability problem.

Verification:

- `npm run sync:readiness-doc`
- `npm run check:truth-surface`
- readiness tests proving fresh receipts outrank stale ones

Dependencies:

- C100-1

### C100-3. Maintainability Lift

Priority: P1
Size: L

What:

- Reduce complexity in the highest-friction command and state surfaces.
- Remove duplicated install/help/readiness wording where one shared source can own it.
- Add or tighten focused tests around the refactored seams so maintainability gains are real, not cosmetic.

Where:

- likely hot spots in `src/cli/commands/verify.ts`, `src/cli/commands/setup-assistants.ts`, `src/core/assistant-installer.ts`, `src/core/readiness-doc.ts`, and `src/core/workflow-surface.ts`
- associated tests under `tests/`

Why:

The repo is strong, but the maintainability score is still the last pure code-quality gap under target.

Verification:

- `npm run verify`
- strict score improvement from the current maintainability baseline
- no coverage regressions in touched surfaces

Dependencies:

- C100-1
- C100-2

### C100-4. Codex Install Productization

Priority: P0
Size: M

What:

- Turn the existing Codex bootstrap into a clearly supported product surface, not just a collection of working pieces.
- Make `setup assistants --assistants codex` print a crisp Codex-specific next-step checklist.
- Ensure `doctor` can explicitly validate Codex bootstrap health and repair guidance.
- Keep native slash commands, CLI fallback skill, and non-colliding utility aliases clearly separated in both behavior and docs.

Where:

- `src/core/assistant-installer.ts`
- `src/cli/commands/setup-assistants.ts`
- `src/cli/commands/doctor.ts`
- `agents/codex-home-AGENTS.md`
- `.codex/config.toml`
- `tests/assistant-install.test.ts`
- Codex-related doctor tests if missing

Why:

We already have most of the mechanics. The gap now is supportability, guidance quality, and clear install guarantees for Codex itself.

Verification:

- assistant install tests cover skills, commands, bootstrap, and non-colliding aliases
- doctor reports Codex bootstrap health accurately
- temp-home install flow confirms the expected Codex surfaces after explicit setup

Dependencies:

- none

### C100-5. Cross-Machine Codex Install and Distribution Path [P]

Priority: P0
Size: M

What:

- Define one canonical Codex install guide for other machines.
- Explicitly support npm, tarball, and source installs as first-class paths.
- Document the difference between local Codex support and hosted Codex limitations.
- Make the guidance usable by a developer setting up a brand-new machine without repo tribal knowledge.

Where:

- new canonical guide: `docs/Codex-Install.md`
- `docs/Standalone-Assistant-Setup.md`
- `README.md`
- `RELEASE.md`
- `tests/release-docs.test.ts`

Why:

Right now the pieces exist, but the install story is spread across multiple docs. Another machine should not require archaeology.

Verification:

- release docs tests assert the canonical guide is referenced from README and release docs
- the guide includes npm, tarball, and source flows plus validation steps
- hosted-vs-local Codex expectations are explicit and consistent everywhere

Dependencies:

- C100-4

### C100-6. Codex Install Smoke and Release Proof [P]

Priority: P0
Size: M

What:

- Promote Codex install proof into the release smoke path explicitly.
- Ensure packaged install smoke proves that plain install does not mutate Codex, and explicit setup does.
- Add coverage for the exact Codex contract: commands, bootstrap, skill fallback, and utility aliases.

Where:

- `scripts/check-package-install-smoke.mjs`
- `package.json`
- `tests/assistant-install.test.ts`
- `tests/release-docs.test.ts`
- any additional smoke tests created for Codex install proof

Why:

If Codex install is part of the product, it needs the same fail-closed proof discipline as the rest of the release surface.

Verification:

- `npm run release:check:install-smoke`
- `npm run release:proof`
- smoke failures are preserved with clear temp paths when the Codex contract breaks

Dependencies:

- C100-4
- C100-5

### C100-7. Command and Skill Truth Convergence [P]

Priority: P1
Size: S

What:

- Ensure the Codex bootstrap, command markdown, bundled skills, and repo docs all describe the same workflow and fallback rules.
- Remove or tighten duplicate Codex install wording that can drift.

Where:

- `agents/codex-home-AGENTS.md`
- `commands/*.md` where necessary
- `src/harvested/dante-agents/skills/danteforge-cli/SKILL.md`
- `README.md`
- `docs/Standalone-Assistant-Setup.md`
- `tests/command-skill-coverage.test.ts`
- `tests/release-docs.test.ts`

Why:

We should not have a "works in code, drifts in docs" failure mode once install becomes a first-class finish gate.

Verification:

- command/skill coverage tests pass
- release docs tests pass
- bootstrap and fallback wording stay aligned across code and docs

Dependencies:

- C100-4
- C100-5

### C100-8. Hold-the-Floor Regression Locks [P]

Priority: P1
Size: S

What:

- Add or tighten regression coverage around the dimensions already sitting exactly at `9.0`.
- Focus especially on developer experience, autonomy, spec-driven workflow, and convergence/self-healing surfaces while the last gaps are being closed.

Where:

- `tests/cli-release-readiness.test.ts`
- `tests/command-skill-coverage.test.ts`
- `tests/release-docs.test.ts`
- any targeted workflow/help/readiness tests touched by the earlier workstreams

Why:

The last stretch is where a strong system can accidentally regress the dimensions that were only barely above water.

Verification:

- `npm run verify`
- no regression in strict scoring for `developer_experience`, `autonomy`, `spec_driven_pipeline`, or `convergence_self_healing`

Dependencies:

- C100-1
- C100-2
- C100-4

## 6. Recommended Execution Order

Run in this order:

1. C100-1
2. C100-2
3. C100-4
4. C100-5 and C100-6 in parallel
5. C100-3
6. C100-7
7. C100-8

Rationale:

- C100-1 and C100-2 close the remaining trust gap inside the repo itself.
- C100-4 turns Codex install from "working implementation" into "supported product surface."
- C100-5 and C100-6 then make that surface transferable and release-proof.
- C100-3, C100-7, and C100-8 make sure the final pass is clean, not just functional.

## 7. Proof Bundle For Completion

Before calling the project 100 percent complete, capture and retain evidence for:

- `npm run verify`
- `npm run build`
- `node dist/index.js verify --json`
- `npm run check:truth-surface`
- `npm run release:proof`
- `npm run release:check:install-smoke`
- a fresh Codex temp-home install proving:
  - no Codex mutation on package install alone
  - Codex skills appear after explicit setup
  - `~/.codex/commands/autoforge.md` exists
  - `~/.codex/AGENTS.md` exists
  - `~/.codex/skills/danteforge-cli/SKILL.md` exists
  - `~/.codex/config.toml` contains only the intended non-colliding utility aliases

## 8. The Simple North Star

The finish line is:

"DanteForge can truthfully verify itself, document itself, install itself into Codex cleanly, and be reproduced on another machine without guesswork."

That is the 100 percent bar for this phase.
