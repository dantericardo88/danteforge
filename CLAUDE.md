# DanteForge - Developer Guide

## What This Is

DanteForge is an agentic development CLI (v0.5.0) that fuses battle-tested patterns from leading open-source tools into one opinionated workflow: structured specs, execution waves, multi-agent orchestration, skills, hard gates, TDD enforcement, Figma UX refinement via MCP, git worktree isolation, guided tech stack decisions, manual MCP self-healing, and self-improving lessons.

## Build & Test

```bash
npm ci           # deterministic install
npm run verify   # typecheck + lint + tests
npm run build    # tsup -> dist/index.js (single ESM bundle)
npm run test     # tsx --test tests/**/*.test.ts
npm run dev      # tsup --watch
npm run lint     # eslint (check mode)
npm run lint:fix # eslint --fix
```

## First time? Run `danteforge flow`

DanteForge has 5 workflows. Pick the one that matches what you're trying to do:

1. **New project** → `/specify` → `/plan` → `/tasks` → `/forge` → `/verify`
2. **Improve existing** → `/assess` → `/goal` → `/magic or /inferno` → `/outcome-check`
3. **Learn from OSS** → `/harvest-forge` → `/outcome-check` → `/share-patterns`
4. **Validate quality** → `/self-assess` → `/self-mutate` → `/ci-report`
5. **Recover from plateau** → `/status` → `/refused-patterns` → `/respec`

In Claude Code: use `/danteforge-flow` for the workflow picker, or `/danteforge-guide` to generate
a session-persistent guide file you can load with `@.danteforge/GUIDE.md`.

## Architecture

- `src/cli/` - Commander.js CLI with 103+ commands
- `src/core/` - State (YAML), config, LLM client, gates, skills, logger, handoff, prompt builder, token estimator, MCP adapter
- `src/matrix/` - **Matrix Kernel** — closed-loop verified multi-agent engineering control plane (see section below)
- `src/harvested/gsd/` - Wave executor, context-rot hooks, XML utils
- `src/harvested/spec/` - Clarify engine, templates
- `src/harvested/dante-agents/` - 5 agent roles, party mode, skills/, help engine
- `src/utils/` - Git worktree isolation
- `src/harvested/openpencil/` - Design-as-Code engine (.op codec, 86-tool registry, spatial decomposer, token extractor, headless SVG renderer)
- `hooks/` - Claude Code session-start hook runner + hook payload scripts
- `lib/` - JS skill discovery for plugin runtime
- `vscode-extension/` - VS Code integration (shells out to CLI)
- `.claude-plugin/` - Claude Code plugin manifest

## Matrix Kernel (`src/matrix/`)

DanteForge's substrate for coordinating many AI agents in parallel without losing truth, architecture, or control. Implements the **Observe → Map → Decompose → Simulate → Lease → Execute → Verify → Merge → Rescore → Learn → Repeat** loop with constitutional discipline: agents propose, DanteForge disposes.

**MVP status:** Phases 0–12 shipped, Golden Flow integration test passing, planning-loop CLI wired. Fixes A/B/C (self-scoring elimination, kernel-owned score writes, protected-line provenance) shipped on branch `matrix-kernel-phase-1`. Phase 13 (real Codex/Claude Code/DanteCode adapters) and Phase 14 (VS Code War Room) are follow-up passes.

**Surfaces:**
- CLI: `danteforge matrix-kernel <init|map-project|synthesize-dimensions|work-packets|simulate|status|leases-list|verify-capability|protect|protected-lines|unprotect>`
- Types: `src/matrix/types/*` (six graphs + courts + reports + capability-test + agent-evidence)
- Engines: `src/matrix/engines/*` (project graph, dimension synth, work packets, dependency graph, ownership, lease, conflict radar, simulation, retrospective, report generator, **capability-test-runner**, **protected-lines**)
- Courts: `src/matrix/courts/*` (verification, no-stub scan, red-team, taste-gate, merge-court)
- Adapters: `src/matrix/adapters/*` (interface, fake, generic-shell — real adapters deferred)
- Util: `src/matrix/util/glob.ts` (shared glob matcher)
- **Load-bearing test:** `tests/matrix-golden-flow.test.ts` — 18 assertions covering the entire MVP loop

**Self-scoring elimination (three enforced constraints):**

1. **capability_test gate (Fix A)** — Every dimension in matrix.json must carry a `capability_test` shell command (or `no_capability_test: true` marker). The merge court enforces: if `proposedAfter > 5.0` and the shell test exits non-zero, the merge is `BLOCKED_BY_POLICY` and the score is clamped to 5.0. Verify any dimension: `danteforge matrix-kernel verify-capability <dimensionId>`. Three meta-dimensions (`token_economy`, `enterprise_readiness`, `community_adoption`) are permanently capped at 5.0.

2. **Kernel-owned score writes (Fix B)** — Worker agents are structurally forbidden from committing `matrix.json` or anything under `score-proposals/`. `MATRIX_SCORE_SURFACE_PATTERNS` is prepended to every work packet's `globalForbidden` list. The pre-commit hook (`hooks/pre-commit.mjs`) additionally rejects any commit touching those paths unless `DANTEFORGE_MATRIX_MERGE_RECEIPT` is set in the environment (kernel-only). Agents produce `agent-evidence.json` — kernel reads evidence and writes scores.

3. **Protected line provenance (Fix C)** — When a capability_test passes, the responsible file:line ranges are recorded in `.danteforge/protected-lines.json`. The pre-commit hook rejects any commit that touches protected lines unless the commit message contains `--touches-protected`. Manage via: `danteforge matrix-kernel protect <file:start-end> <dimensionId>`, `danteforge matrix-kernel protected-lines`, `danteforge matrix-kernel unprotect <file:start-end>`.

**Reuse map** (per `docs/MATRIX_KERNEL_REPO_AUDIT.md`, marked historical):
The Matrix Kernel reuses Time Machine + DecisionNode + proof engine + `worktree.ts:createAgentWorktree` + `sanitize-locks.withFileLock` + `compete-matrix.ts:loadMatrix` + `matrix-development-engine.ts` merge logic + `sanitize-boundary.ts:buildSymbolGraph`. Avoid duplicating these primitives.

**Naming note:** The Matrix Kernel CLI parent is `matrix-kernel` (not `matrix`) to avoid colliding with the legacy `matrix` command (claim/propose/merge — exposed by `src/cli/commands/matrix.ts` over `matrix-development-engine.ts`). Resolution of the parent-command collision is deferred to a follow-up pass.

## Key Patterns

- **Three-mode execution**: Every command supports LLM API mode, `--prompt` (copy-paste), and local fallback
- **Hard gates**: `requireConstitution`, `requireSpec`, `requirePlan`, `requireTests` - bypass with `--light`
- **State**: `.danteforge/STATE.yaml` tracks project, phase, tasks, audit log
- **Config**: `~/.danteforge/config.yaml` stores API keys; `./.danteforge/` is project state only
- **Skills**: YAML frontmatter in `SKILL.md` files, discovered at runtime
- **LLM providers**: Ollama (default/local), Grok, Claude, OpenAI, Gemini - dynamic SDK loading
- **Token estimation**: Warns before expensive API calls, auto-chunks large inputs
- **Self-improving lessons**: `.danteforge/lessons.md` captures corrections and failures; auto-compacts; feeds into forge/party/tech-decide
- **Design-as-Code**: `.op` JSON format for version-controlled design artifacts; 86-tool OpenPencil registry; native SVG renderer; design token extraction to CSS/Tailwind
- **Maturity-Aware Quality Scoring**: 8-dimension scoring system (functionality, testing, error handling, security, UX polish, documentation, performance, maintainability) maps to 6 maturity levels (Sketch→Enterprise-Grade); convergence loops use maturity assessment to prevent "premature done"

## Workflow Pipeline

```
constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> forge/party (apply) -> verify -> synthesize
```

Build first, then refine visually. UX-refine runs after forge because you need live UI to push to Figma.

## File Size Standard (enforced)

**Every TypeScript file you write must stay under 500 non-blank LOC (ideal) / 750 LOC (hard cap).**

- ESLint warns at 500 lines (`max-lines` rule).
- `npm run check:file-size` **fails** (exits 1) if any `src/` file exceeds 750 LOC. This is wired into `verify:all`.
- LLM prompts (via `buildTaskPrompt`) include this constraint automatically.
- The `scoreMaintainability` dimension penalizes files over 500 LOC.

When a file approaches the limit, split it: `foo.ts` → `foo.ts` + `foo-types.ts` + `foo-utils.ts`.

## Definition of Done (Depth Doctrine)

A dimension is not complete until it has produced an observable artifact on the target hardware.
**Code without a receipt is a hypothesis, not a feature.**

### Score tiers (structurally enforced by `receipt-ceiling.ts` + `derived-score.ts`):

| Score | What it means | How to unlock |
|---|---|---|
| ≤5.0 | Code exists, unit tests pass | Module + tests (no outcomes needed) |
| ≤7.0 | Production callsite wired | Orphan check passes (harden gate) |
| ≤8.5 | Receipt on disk, ≤30 days | `danteforge validate <dim>` passes |
| ≤9.5 | Fresh receipt, ≤7 days | Outcome evidence fresh (T5 tier) |
| ≤10.0 | Multi-receipt + live verify | 3+ outcomes + VerifyReceipt.liveCheckPassed |

### Every forged module must answer before the wave closes:
1. **Callsite**: What production function calls this module? (not a test — the real `src/` entry point)
2. **Artifact**: What is the observable output? (file path, log line, CLI output — something you can point to)
3. **Silent failure**: What breaks if this module silently fails?

If answer 1 is "nothing yet" → mark as `orphan-pending`. Score ceiling: 5. Do not claim higher.

### Wave rhythm (enforced in harden-crusade, matrixdev):
- **Breadth waves** (odd): write modules + unit tests → score ceiling 6
- **Depth waves** (even): run `danteforge validate` → unlock 7-9 via receipts
- Depth waves write zero new production code. They run things.

### `danteforge validate <dim>` — the depth-doctrine receipt runner:
Runs declared outcomes, writes `OutcomeEvidenceEntry` receipts, reports before/after score.
Until this passes, the dimension is structurally capped at 7.0.

---

## Zero Tolerance (Non-Negotiable, Pre-Commit Enforced)

**No mocks. No stubs. No TODOs. In any code DanteForge agents write.**

The pre-commit hook (Pillar 2) blocks:
- `jest.mock(`, `vi.mock(`, `sinon.stub(`, `sinon.mock(` in `src/` files
- `// TODO`, `// FIXME` comments in `src/` files
- `throw new Error('not implemented')` or variants in `src/` files

The merge court (no-stub-scanner gate) blocks any work packet with these patterns.
Every wave prompt prepends this constraint.

If you cannot implement the real thing, write a `capability_test` that fails cleanly.
Never write a stub that passes silently — that is breadth masquerading as depth.

---

## Conventions

- `AGENTS.md` is the canonical agent instruction file (Codex/Claude/etc.); this file is adapter/context guidance
- ESM-only (`"type": "module"`)
- TypeScript strict mode, ES2022 target
- tsup bundles to single `dist/index.js`
- Skills live in `src/harvested/dante-agents/skills/<name>/SKILL.md`
- Tests use Node.js built-in test runner with tsx
- Attribution in NOTICE.md
