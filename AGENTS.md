# AGENTS.md - DanteForge

## Canonical Agent Instructions

This file is the repo-level source of truth for coding agents (Codex, Claude Code, Gemini, OpenCode, Cursor, etc.).
`CLAUDE.md` contains adapter notes and architecture context, but agent behavior and quality gates should follow this file first.

## Quick Commands

- Install: `npm ci`
- Verify (fail-closed): `npm run verify`
- Full repo verify (CLI + extension): `npm run verify:all`
- Build CLI: `npm run build`
- Build VS Code extension: `npm --prefix vscode-extension ci && npm --prefix vscode-extension run build`
- Repo hygiene check: `npm run check:repo-hygiene`
- Strict repo hygiene check (fresh checkout/release): `npm run check:repo-hygiene:strict`
- Third-party notices completeness check (release): `npm run check:third-party-notices`

## Repo Notes

- ESM-only TypeScript CLI bundled with `tsup` to `dist/index.js`.
- Project workflow artifacts live in `./.danteforge/` (state/spec/plan/tasks/prompts).
- Secrets are stored in user config at `~/.danteforge/config.yaml` (migrated from legacy project-local config on first read).
- Prefer small, high-confidence edits and keep CLI behavior backward compatible unless a task explicitly changes UX/contracts.
- In Codex and Grok Build, treat workflow slash commands backed by `commands/*.md` as native repo commands. When the user invokes `/spark`, `/ember`, `/canvas`, `/magic`, `/blaze`, `/nova`, `/inferno`, `/autoforge`, `/party`, `/local-harvest`, `/frontier`, or another workflow slash command (or the `danteforge-` prefixed forms in Grok), execute the workflow in the workspace instead of defaulting to `danteforge <command>` unless the user explicitly asks for CLI execution or parity testing.
- For long-running autonomous frontier attainment (50-100+ dimensions), the canonical command is `danteforge frontier --drive --target-dims 70`. This is the "one command" that loops using harden-crusade + strict doctrine gates until the target is honestly reached. Prefer this over manual crusade/ascend loops when the goal is set-and-forget frontier closure.
- Keep `.codex/config.toml` free of workflow-command alias collisions so native slash commands win in Codex.
- Do not commit generated/vendor paths (`node_modules/`, `dist/`, `coverage/`, `./.danteforge/`, `vscode-extension/node_modules/`, `vscode-extension/dist/`).

## File Size Standard (enforced — do not bypass)

Every TypeScript source file in `src/` and `packages/` must stay within these limits:

| Threshold | LOC (non-blank) | Action |
|-----------|----------------|--------|
| **Ideal** | ≤ 500 | Target for all new files |
| **Warning** | 501–750 | ESLint warns; must plan a split |
| **Hard cap** | > 750 | `npm run check:file-size` exits 1 — CI fails |

**Why this matters for LLMs:** Files over 500 LOC exceed the practical context window where an LLM can reason about the whole file without making structural mistakes (missing imports, wrong function scope, stale variable names). At 750+ LOC, error rates climb significantly.

**How to split:** When a module grows past 500 LOC, extract into focused sub-modules:
```
foo.ts          → foo.ts + foo-types.ts + foo-utils.ts
commands/bar.ts → commands/bar.ts + commands/bar-helpers.ts
```

Keep the public API surface in the main file; move implementation details to `-utils.ts` or `-helpers.ts` siblings.

## Multi-Agent Anti-Bloat Guard (enforced)

When multiple agents work in parallel, shared runtime files are treated as kernel
surfaces. Do not add dimension-specific business logic to frozen files listed in
`.danteforge/agent-guard.json`; add an owned helper, hook, adapter, or registrar
instead.

Before parallel work, create an ephemeral claim under `.danteforge/agent-claims/`
and choose a workstream from `.danteforge/agent-ownership.json`. Claim files are
never committed. Before committing, run:

```
npm run check:agent-guard -- --staged --workstream <workstream>
npm run check:file-size
```

Use `DANTEFORGE_ALLOW_FROZEN=1` only for explicit platform-kernel work that adds
or repairs extension points. See `docs/AGENT_BLOAT_PREVENTION_SYSTEM.md`.

## Matrix Development Engine (enforced)

Any command or agent that scores, improves, rescales, or reviews competitive
dimensions must use the Matrix Development Engine:

```
claim dimension -> run work -> propose score -> locked merge -> Time Machine snapshot -> guard verification
```

Do not edit `.danteforge/compete/matrix.json` directly after scoring work. Use
`danteforge matrix status|claim|propose|merge|ascend`, or the compatibility
wrapper `npm run dimension:ascent`. Default merge policy is `harsh-min`, so
skeptical downgrades win over optimistic stale writes. The agent guard fails
direct matrix edits unless a Matrix Development merge receipt is present.

### capability_test requirement (Fix A — enforced)

Every dimension in `matrix.json` must carry a `capability_test` field. Scores
above **5.0** are blocked by merge-court unless the `capability_test` shell command
exits 0 in the same wave. Dimensions that cannot be shell-tested carry
`no_capability_test: true` and are permanently capped at 5.0.

To run a single capability test for diagnosis:
```bash
danteforge matrix-kernel verify-capability <dimensionId>
```

Do NOT define capability_tests that rewrap harness checks (export existence, file
existence). The command must invoke the real underlying capability.

### Kernel-owned score writes (Fix B — enforced)

Worker agents dispatched by `matrix-kernel run-wave` are **structurally incapable**
of writing to `matrix.json` or any score-surface file. The lease contract includes
these paths in `forbiddenPaths`. If a worker attempts to stage `matrix.json`, the
pre-commit hook exits 1 and the lease fails loudly.

The kernel (not agents) runs the adversarial scorer on each evidence file and
writes the resulting score through the locked merge flow.

Each worker must produce `.danteforge/matrix/leases/<leaseId>/agent-evidence.json`
describing files touched, tests added, and capability_test exit codes. Workers
must NOT self-score.

### Protected line provenance (Fix C — enforced)

When a `capability_test` passes for a dimension, the kernel records the responsible
implementation into `.danteforge/protected-lines.json`. Future waves that touch
those lines must:
1. Include `--touches-protected` in the commit message
2. Re-run the affected `capability_test` and confirm it passes

Commands:
```bash
danteforge matrix-kernel protect <file:start-end> <dimensionId>   # record protection
danteforge matrix-kernel protected-lines                           # list current protections
danteforge matrix-kernel unprotect <file:start-end>               # explicit removal (requires reason)
```

### Dimension exclusion (de-prioritization, not removal)

Per-project user preference to skip a dimension across sprints, work-packet
generation, and gap-rank reporting:

```bash
danteforge compete --exclude <dim_id>   # de-prioritize, keep in matrix for scoring
danteforge compete --include <dim_id>   # reverse
```

The list is persisted as `excludedDimensions: string[]` in `matrix.json`. The
`matrix-kernel work-packets` engine, `getNextSprintDimension`, `getTopGapDimensions`,
and `classifyDimensions` all consult this list. Use `--exclude` (not
`--drop-dimension`) when the dimension should still count for scoring continuity
but agents should never auto-target it.

See `docs/MATRIX_DEVELOPMENT_ENGINE.md`.

## Scoring Doctrine — All Loops (mandatory for every agent on every surface)

Every command, loop, agent, and tool that produces or influences a score MUST follow these rules. They are enforced by `src/core/scoring-doctrine.ts` (full text) and propagated to every LLM prompt via `wrapPromptWithDoctrine()`. Violating these rules produces invalid scores that deceive the project owner.

### The 13 rules

**1. EVIDENCE ONLY** — Scores come from outcome evidence (receipts, passing tests, CLI runs). Never from opinions, gut feel, or hardcoded numbers.

**2. CORRECT COMPETITOR TAXONOMY** — Compare ONLY against actual competitors in `positioning.md`. Downstream consumers, adjacent tools, different-category products → reference tier only. Excluded from gap and priority calculations.

**3. GAP-TO-LEADER** — Show gap-to-leader against actual competitors for every dimension. A zero gap must be audited — do not hand-wave it.

**4. NO ADOPTION PENALTY** — NEVER penalize for adoption metrics (users, downloads, stars) on a pre-release product. Score what the tool CAN DO.

**5. THE GAP IS THE VALUE** — Surface where competitors genuinely beat us. Inflating scores or hiding gaps helps no one.

**6. "HARSH" MEANS EVIDENCE-BASED** — Not "penalize for no public users." If the evidence says 9.0, the score is 9.0. If it says 4.0, it's 4.0.

**7. RECEIPTS REQUIRED** — Every score must trace to a specific artifact: file that exists, test that passes, command that runs.

**8. RUNTIME VERIFICATION ABOVE 7.0** — Structural checks (file exists, string present) are capped at T4/7.0. Scores above 7.0 require runtime execution: cli-smoke, runtime-exec, or e2e-workflow.

**9. ZERO-EVIDENCE FALLBACK** — If `node scripts/evidence-rescore.mjs` reports 0 evidence entries, do NOT accept existing matrix scores. Run every outcome command directly and compute tier-based scores from raw pass/fail. Scores above 5.0 are not defensible until `danteforge validate` has produced at least one receipt per dimension.

**10. FIX A — CAPABILITY_TEST GATE** — For every dimension with a declared `capability_test` field: run it as part of any scoring pass. If it exits non-zero AND the evidence-derived score > 5.0, the score is **clamped to 5.0** regardless of outcomes. NEVER declare `FRONTIER_REACHED` on a dimension whose `capability_test` is failing. Record the command and output as the receipt.

**11. OUTCOME TRIAGE** — When an outcome command fails, determine root cause before scoring:
- **(a) Genuine capability gap** — code is missing/broken → reduces score, appears in gap list
- **(b) Outcome definition bug** — wrong path/keyword/expectation → flag in `OUTCOME_BUGS`, no score penalty, fix the definition
- **(c) Bootstrapping dependency** — checks for artifacts the scoring system itself produces → flag in `BOOTSTRAP_DEPS`, score on other outcomes, fix = run `danteforge validate`

**12. BOOTSTRAPPING DEPENDENCY FLAG** — Outcomes that check for `outcome-evidence/` files or other scoring artifacts are bootstrapping dependencies. Report in `BOOTSTRAP_DEPS`. The fix is `danteforge validate`, not new code.

**13. TIME MACHINE** — Every scoring pass, crusade cycle, validate run, and harden verdict MUST emit a Time Machine causal commit via `createTimeMachineCommit`. Record: `gitSha`, `dimensionId`, `scoreBefore`, `scoreAfter`, `outcomesPassed`, `capabilityTestResult`, and the loop name. A loop that does not record Time Machine commits MUST NOT write final scores to `matrix.json`.

### Per-cycle scoring sequence for ANY autonomous loop

```
1. danteforge validate <dimId> --force-cold   → write OutcomeEvidenceEntry receipts
2. node scripts/evidence-rescore.mjs           → update matrix.json from evidence
3. Run capability_test.command                 → Fix A: clamp to 5.0 if exit ≠ 0
4. createTimeMachineCommit(...)                → audit trail (mandatory before score write)
5. npm run dimension:ascent -- propose/merge   → single-writer score commit
```

Steps 1–4 must complete before any score is accepted. If step 4 (Time Machine) fails, do NOT write the score — log `PROVENANCE_MISSING`.

### Frontier definition for each dimension

Every dimension in matrix.json declares its competitive universe:
- `oss_leader` + `gap_to_oss_leader` — the OSS tool to harvest from (harvestable patterns)
- `closed_source_leader` + `gap_to_closed_source_leader` — the closed-source gold standard
- `scores` map — one entry per actual competitor (14 total: 2 closed-source + 12 OSS)

`FRONTIER_REACHED` = ALL of the following must be true simultaneously:
1. score ≥ target (evidence-rescore derived, not self-reported)
2. `capability_test` PASS (Fix A — exit code 0)
3. ≥3 T5+ outcomes from the past 7 days
4. **CIP PASS** — `runCIPCheck()` from `src/core/completion-integrity.ts` returns `blocksFrontierReached: false`:
   - `cipScore` within 0.5 of target
   - `cipClass` is `'verified'` or `'partially-verified'`
   - Zero stubs/mocks/TODOs in the dimension's critical path
   - All declared outcomes pass when re-executed cold
   - At least one outcome declared (zero outcomes = Rule 9 zero-evidence fallback)

If ANY condition fails, the loop continues. **FRONTIER_REACHED is never self-declared by an agent.**
Bypassing CIP requires explicit `--skip-cip` (development escape hatch — never a default).

### What "set it and forget it" means operationally

Run `/crusade`, `/ascend`, or `/harden-crusade` in Claude Code. The loop will:
1. Auto-detect the competitive universe from matrix.json
2. Harvest OSS patterns from `oss_leader` via `danteforge inferno --dim <id>`
3. Validate with receipts via `danteforge validate <id> --force-cold`
4. Rescore from evidence via `node scripts/evidence-rescore.mjs`
5. Apply Fix A gate (hard 5.0 cap on capability_test failure)
6. Emit Time Machine commit for every accepted score
7. Re-rank by gap-to-leader and repeat until `ALL_DONE`

The loop stops honestly when every dimension is `FRONTIER_REACHED` or `AT_CEILING` — not when self-reported scores look good.

## Cross-Tool Skill + Command Distribution

This repo doubles as a skills library for Claude Code, Codex, Cursor, Windsurf,
Aider, OpenHands, Copilot, Continue, Gemini CLI, and Grok Build. Every file under `commands/`
becomes both a Claude Code slash command (canonical path) AND a per-tool rule
file when users run `danteforge setup assistants --assistants all`. The
installer:

- Copies `commands/*.md` to `~/.codex/commands/` (Codex native slash commands)
- Writes `danteforge-<name>/SKILL.md` wrappers into `~/.grok/skills/` (Grok Build native `/danteforge-*` slash commands)
- Writes each command as `.cursor/rules/danteforge-<name>.mdc` with
  `alwaysApply: false`
- Writes each command as `.windsurf/rules/danteforge-<name>.md` with a derived
  name/description header
- Ships every `src/harvested/dante-agents/skills/<name>/SKILL.md` to each tool's
  skills directory

**Authoring contract:** new slash commands live in `commands/`, NOT in
`.claude-plugin/commands/` (that directory was retired — Claude Code's plugin
discovery reads from `commands/` at the plugin root). Every command file must
carry a frontmatter header with `name:` and `description:` so the per-tool
exporters can derive correct metadata.

## Autonomous `/matrixdev`

`/matrixdev` defaults to autonomous mode: probe adapter (claude → codex →
ollama → fake), dispatch wave 1, run all courts, emit report — no per-step
confirmations. Pass `--ask` to opt into the old prompt-per-step flow, or
`--safe` to force the fake adapter for a dry-run validation.

The `Safe agents now: 0` warning is treated as non-blocking when each wave
contains exactly one packet (single-packet waves are trivially safe). Hard
blockers (`Blocked packets > 0`, protected-path violations, ownership
violations) still halt dispatch.

## Three-Role Architecture: Embedded / Orchestrator / Observer

The matrix kernel runs in one of three modes depending on launch context.
Detection happens via `CLAUDE_PLUGIN_ROOT` / `CODEX_SESSION` env vars
(`src/core/host-detection.ts:detectHostAI()`).

1. **Embedded mode** (`--adapter embedded`, or `--adapter auto` inside a host AI).
   The kernel writes Work Instruction Packets to
   `.danteforge/embedded-mode/<leaseId>/work-instruction.md`. The host AI
   reads each packet and executes the lease *inline* with its own Edit/Write
   tools. No subprocess is spawned, so a single Claude Code / Codex
   subscription is billed once. The host signals completion via
   `danteforge matrix-kernel embedded-complete <leaseId>` — the kernel
   captures `git diff --name-only HEAD` and queues the lease for verify-court.

2. **Orchestrator mode** (`--adapter claude|codex|ollama|<api>`, or `auto` in
   a plain terminal). The kernel spawns real worker subprocesses via the
   existing adapters in `src/matrix/adapters/`. This is the right mode for
   headless CI runs and multi-agent parallel work.

3. **Observer mode** (`danteforge war-room`). A read-side terminal TUI that
   tails the matrix state files via `fs.watchFile()` and renders Plan +
   Leases + Courts + Mailbox + Retro panels. Works in any TTY (tmux, ssh,
   integrated terminal). `--once` produces a single render for CI.

The **mailbox bus** at `.danteforge/matrix/matrix.mailbox.json` is the
shared message log across modes. Any agent (worker or embedded) can post
via `matrix-kernel mailbox post --from <lease> --to <lease|broadcast>
--type <type> --summary <text>` and poll via `mailbox poll
[--lease <id>] [--timeout <ms>] [--types <comma>]`. `matrix-kernel
mailbox list` shows the full history. Wave dispatch in `run-wave`
auto-publishes a `merge_ready` / `regression_detected` /
`human_decision_required` message per completed lease so observers see
progress without polling git or grep'ing logs.

State writes are protected by `withFileLock` (atomic O_EXCL with TTL
reclaim, from `src/core/sanitize-locks.ts`) — two parallel agents updating
`matrix.agent-runs.json` concurrently cannot tear each other's data.

## Definition Of Done

- `npm run verify` passes
- `npm run check:agent-guard` passes for the changed files/workstream
- `npm run build` passes
- `npm --prefix vscode-extension run build` passes when extension files changed
- Tests/docs updated when behavior or operator workflow changes
- No new file exceeds 500 non-blank LOC (hard limit: 750)

## Workflow Pipeline

```
review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship
```

Use `--light` flag on any command to bypass gates for simple changes.

## DanteForge CLI Commands

### Magic Levels

Usage rule:
- Frontend-heavy feature where design should drive implementation -> `danteforge canvas`
- First-time new matrix dimension + fresh OSS discovery -> `danteforge inferno`
- All follow-up PRD gap closing -> `danteforge magic`

| Command | Intensity | Token Level | Combines (Best Of) | Primary Use Case |
|---------|-----------|-------------|--------------------|------------------|
| `danteforge spark [goal]` | Planning | Zero | review + constitution + specify + clarify + tech-decide + plan + tasks | Every new idea or project start |
| `danteforge ember [goal]` | Light | Very Low | Budget magic + light checkpoints + basic loop detect | Quick features, prototyping, token-conscious work |
| `danteforge canvas [goal]` | Design-First | Low-Medium | design + autoforge + ux-refine + verify | Frontend-heavy features where visual design drives implementation |
| `danteforge magic [goal]` | Balanced (Default) | Low-Medium | Balanced party lanes + autoforge reliability + verify + lessons | Daily main command - 80% of all work |
| `danteforge blaze [goal]` | High | High | Full party + strong autoforge + synthesize + retro + self-improve | Big features needing real power |
| `danteforge nova [goal]` | Very High | High-Max | Planning prefix + blaze execution + inferno polish (no OSS) | Feature sprints that need planning + deep execution without OSS overhead |
| `danteforge inferno [goal]` | Maximum | Maximum | Full party + max autoforge + deep OSS mining + evolution | First big attack on new matrix dimension |

### Core Workflow

| Command | Description | Gates | Key Flags |
|---------|-------------|-------|-----------|
| `danteforge review` | Scan repo, generate CURRENT_STATE.md | none | `--prompt` |
| `danteforge constitution` | Define project principles and constraints | none | — |
| `danteforge specify <idea>` | High-level idea to spec artifacts | requireConstitution | `--prompt`, `--light`, `--ceo-review`, `--refine` |
| `danteforge clarify` | Q&A on current spec, identify gaps | requireSpec | `--prompt`, `--light` |
| `danteforge tech-decide` | Guided tech stack selection (3-5 options per category) | none | `--prompt`, `--auto` |
| `danteforge plan` | Spec to detailed implementation plan | requireSpec | `--prompt`, `--light`, `--ceo-review`, `--refine` |
| `danteforge tasks` | Plan to executable task list with waves | requirePlan | `--prompt`, `--light` |
| `danteforge design <prompt>` | Design artifacts via OpenPencil engine | none | `--format`, `--parallel`, `--worktree`, `--prompt` |
| `danteforge forge [phase]` | Execute development waves | requirePlan | `--parallel`, `--profile`, `--worktree`, `--light` |
| `danteforge ux-refine` | UX refinement (OpenPencil or Figma) | none | `--openpencil`, `--figma-url`, `--live`, `--lint` |
| `danteforge verify` | Verification checks on project state | none | `--release`, `--live`, `--url` |
| `danteforge synthesize` | Generate UPR.md from all artifacts | none | — |

### Multi-Agent & Automation

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `danteforge spark [goal]` | Zero-token planning preset | `--prompt` |
| `danteforge ember [goal]` | Very low-token preset for quick follow-up work | `--profile`, `--prompt` |
| `danteforge canvas [goal]` | Design-first frontend preset | `--profile`, `--prompt`, `--design-prompt` |
| `danteforge party` | Multi-agent collaboration mode | `--worktree`, `--isolation`, `--design` |
| `danteforge autoforge [goal]` | Deterministic auto-orchestration | `--dry-run`, `--auto`, `--score-only`, `--max-waves`, `--profile`, `--parallel`, `--force` |
| `danteforge crusade` | Frontier crusade across competitive dimensions | `--frontier`, `--parallel`, `--loop`, `--verify-cap`, `--target` |
| `danteforge magic [goal]` | Balanced default preset for daily gap-closing | `--level`, `--profile`, `--prompt`, `--worktree`, `--isolation` |
| `danteforge blaze [goal]` | High-power preset with full party escalation | `--profile`, `--prompt`, `--worktree`, `--isolation`, `--with-design`, `--design-prompt` |
| `danteforge nova [goal]` | Very-high-power preset with planning prefix and deep execution | `--profile`, `--prompt`, `--worktree`, `--isolation`, `--tech-decide`, `--with-design`, `--design-prompt` |
| `danteforge inferno [goal]` | Maximum-power preset with OSS discovery | `--profile`, `--prompt`, `--worktree`, `--isolation`, `--max-repos`, `--with-design`, `--local-sources`, `--local-depth` |

### Quality & Release

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `danteforge qa --url <url>` | Structured QA with health score | `--type`, `--baseline`, `--fail-below` |
| `danteforge ship` | Paranoid release guidance + version bump plan | `--dry-run`, `--skip-review` |
| `danteforge retro` | Project retrospective with trends | `--summary`, `--cwd` |
| `danteforge lessons [correction]` | Self-improving rules from corrections | `--compact`, `--prompt` |
| `danteforge proof` | Score-arc evidence report: before/after delta since a date or git SHA | `--since` |
| `danteforge validate` | Produce outcome receipts and evidence for scoring | `--force-cold`, `--all` |
| `danteforge harden` | Run harden gate checks for a dimension | `--dim` |
| `danteforge harden-crusade` | Autoresearch hardening loop with harden-gate verification | `--loop`, `--target`, `--parallel` |

### Exploration & Discovery

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `danteforge debug <issue>` | 4-phase systematic debugging | `--prompt` |
| `danteforge browse <subcommand>` | Browser automation (navigate, screenshot, inspect) | `--url`, `--port` |
| `danteforge awesome-scan` | Discover and classify skills across sources | `--source`, `--domain`, `--install` |
| `danteforge oss` | Auto-detect project, search OSS, clone, license-gate, extract patterns | `--prompt`, `--dry-run`, `--max-repos` |
| `danteforge oss-loop` | Competitive landscape discovery loop until plateau | `--plateau-passes`, `--max-passes`, `--discovery-file` |
| `danteforge oss-sync` | Restore and update matrix-required OSS repos from registry | `--update`, `--stale-days`, `--dry-run` |
| `danteforge oss-clean` | Remove cached OSS repos from .danteforge/oss-repos/ | `--dry-run` |
| `danteforge oss-learn` | Re-extract patterns from cached OSS repos and regenerate OSS_REPORT.md | `--prompt` |
| `danteforge local-harvest [paths...]` | Harvest patterns from local private repos, folders, and zip archives | `--config`, `--depth`, `--prompt`, `--dry-run`, `--max-sources` |
| `danteforge harvest` | Titan Harvest V2: 5-step constitutional harvest of OSS patterns | `--prompt`, `--lite` |
| `danteforge titan-harvest-loop` | Clean-room harvest loop for GPL/AGPL repos queued by oss-loop | `--max-repos`, `--dry-run` |
| `danteforge wiki-ingest` | Ingest source files into the three-tier knowledge wiki | `--bootstrap`, `--prompt` |
| `danteforge wiki-lint` | Run lint cycle on wiki: contradictions, staleness, link integrity | `--heuristic-only` |
| `danteforge wiki-query <topic>` | Query the wiki for relevant knowledge | `--json` |
| `danteforge wiki-status` | View wiki health metrics dashboard | `--json` |
| `danteforge wiki-export` | Export wiki as Obsidian vault or static HTML | `--format`, `--out` |
| `danteforge resume` | Resume a paused autoforge loop from the last checkpoint | |
| `danteforge refused-patterns` | List/add/remove patterns from the refused-patterns blocklist | `--add`, `--remove`, `--clear` |
| `danteforge respec` | Re-run specification with lessons learned and refused patterns injected | |
| `danteforge cross-synthesize` | Synthesize winning patterns from attribution history to escape a plateau | `--window` |
| `danteforge compete` | Competitive Harvest Loop: score gaps, sprint to close them (6-phase CHL) | `--init`, `--sprint`, `--rescore`, `--report`, `--auto` |
| `danteforge gap` | Gap report and next actions | |
| `danteforge score` | Fast pure-fs score: one number + 3 P0 action items in <5 seconds (no LLM) | `--full` |
| `danteforge prime` | Generate .danteforge/PRIME.md session brief for Claude Code | `--copy` |
| `danteforge teach` | Capture an AI correction into lessons.md and auto-update PRIME.md | |
| `danteforge go` | Daily driver: run self-improve loop with no flags (maxCycles:5, target:9.0) | |
| `danteforge harvest-pattern` | Focused OSS pattern harvest with Y/N confirmation per gap | `--max-repos` |
| `danteforge build` | Guided spec-to-ship wizard: constitution→specify→clarify→plan→tasks→forge→verify→score | `--interactive` |
| `danteforge ascend` | Fully autonomous scoring loop: classify ceiling dims, drive all achievable to 9.0/10 | `--target`, `--max-cycles`, `--interactive`, `--dry-run` |
| `danteforge sanitize` | Break up oversized files via hybrid AST + LLM splitting under safety rails | `--check`, `--dry-run`, `--threshold`, `--max-cycles`, `--max-tokens`, `--yes` |
| `danteforge danteforge` | Maximum-power all-in-one: harvest + OSS + 10-wave autoforge + party + convergence | |

### Utilities

| Command | Description |
|---------|-------------|
| `danteforge config` | Manage API keys and LLM provider settings |
| `danteforge setup <tool>` | Interactive setup wizard (figma, assistants) |
| `danteforge doctor` | System health check and diagnostics |
| `danteforge dashboard` | Launch progress dashboard (local HTML) |
| `danteforge compact` | Compact audit log |
| `danteforge help [query]` | Context-aware guidance |
| `danteforge update-mcp` | Manual MCP self-healing |
| `danteforge import <file>` | Import LLM-generated file into .danteforge/ |
| `danteforge feedback` | Generate prompt from UPR.md for LLM refinement |
| `danteforge skills import` | Import Antigravity skill bundle |

## Agent Roles

| Agent | Role | Skills |
|-------|------|--------|
| **PM** | Task prioritization, scope management | writing-plans |
| **Architect** | Technical design, dependencies, architecture | api-patterns, database-design |
| **Dev** | Implementation, TDD, code generation | test-driven-development, using-git-worktrees |
| **UX/Design** | Frontend patterns, accessibility, .op generation | design-orchestrator, design-token-sync, visual-regression |
| **Scrum Master** | Process enforcement, gate checks, lessons | lessons, systematic-debugging |
| **Code Reviewer** | Two-stage quality verification | requesting-code-review |

### Design Agent
- Role: Design-as-Code generation, token extraction, visual consistency
- Specialization: .op JSON scene graphs, spatial decomposition, design tokens
- Skills: design-orchestrator, design-token-sync, visual-regression
- Output: DESIGN.op, design-tokens.css, design system audit

## Quality Standards & Maturity System

DanteForge includes a maturity-aware quality scoring system that prevents "premature done":

### 6 Maturity Levels
- **Level 1 (Sketch)**: Proves the idea works - demo to co-founder
- **Level 2 (Prototype)**: Investor-ready - basic tests, input validation
- **Level 3 (Alpha)**: Internal team use - 70%+ coverage, structured logging
- **Level 4 (Beta)**: Paid beta customers - 80%+ coverage, error recovery
- **Level 5 (Customer-Ready)**: Production launch - 85%+ coverage, monitoring, pen-tested
- **Level 6 (Enterprise-Grade)**: Fortune 500 - 90%+ coverage, multi-tenant, SOC2/GDPR

### Magic Preset Target Levels
Each magic preset automatically targets a specific maturity level:
- `spark` → Level 1 (Sketch)
- `ember` → Level 2 (Prototype)
- `canvas` → Level 3 (Alpha)
- `magic` → Level 4 (Beta)
- `blaze` → Level 5 (Customer-Ready)
- `nova` / `inferno` → Level 6 (Enterprise-Grade)

### Convergence Loops & Reflection Gate
After the main build pipeline, DanteForge runs a **maturity assessment** that scores your code across 8 dimensions:
1. Functionality (PDSE completeness + integration fitness)
2. Testing (coverage, test files, E2E tests)
3. Error Handling (try/catch ratio, custom errors)
4. Security (secrets management, npm audit, dangerous patterns)
5. UX Polish (loading states, accessibility, responsive design - web only)
6. Documentation (PDSE clarity + freshness)
7. Performance (nested loops, O(n²) patterns, profiling)
8. Maintainability (PDSE testability + constitution + function size)

If `currentLevel < targetLevel` and critical gaps exist (gap > 20 points), the convergence loop runs **3 focused autoforge waves** targeting the top gaps, then re-checks maturity.

Use `danteforge maturity --preset <level>` to check if your code meets the quality standard for a specific preset.

Use `danteforge define-done` to set the completion target — defines what "9+" means by analyzing competitors, extracting every unique function-level capability, building a union of 40-100 features, and scoring against that universe.

Use `danteforge universe` to view the competitive feature universe — all unique capabilities across competitors, scored against the current project.

Use `danteforge assess` for harsh self-assessment against the feature universe or 12 quality dimensions, with competitor benchmarking and gap masterplan generation.

Use `danteforge self-improve` to run the autonomous quality loop — it scores harshly, generates a masterplan, and keeps forging until the completion target (9+/10 on 90%+ of features) is met.

See `docs/MATURITY-SYSTEM.md` for detailed explanations and `commands/maturity.md` for CLI usage.

## Hard Gates

DanteForge enforces mandatory checkpoints (bypass with `--light`):
- Constitution must exist before specification
- Spec must exist before planning
- Plan must exist before execution
- Tests must exist before code (when TDD enabled)
- Maturity level must meet target (in convergence loops)
