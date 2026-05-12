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
- In Codex, treat workflow slash commands backed by `commands/*.md` as native repo commands. When the user invokes `/spark`, `/ember`, `/canvas`, `/magic`, `/blaze`, `/nova`, `/inferno`, `/autoforge`, `/party`, `/local-harvest`, or another workflow slash command, execute the workflow in the workspace instead of defaulting to `danteforge <command>` unless the user explicitly asks for CLI execution or parity testing.
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

## Cross-Tool Skill + Command Distribution

This repo doubles as a skills library for Claude Code, Codex, Cursor, Windsurf,
Aider, OpenHands, Copilot, Continue, and Gemini CLI. Every file under `commands/`
becomes both a Claude Code slash command (canonical path) AND a per-tool rule
file when users run `danteforge setup assistants --assistants all`. The
installer:

- Copies `commands/*.md` to `~/.codex/commands/` (Codex native slash commands)
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

### Exploration & Discovery

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `danteforge debug <issue>` | 4-phase systematic debugging | `--prompt` |
| `danteforge browse <subcommand>` | Browser automation (navigate, screenshot, inspect) | `--url`, `--port` |
| `danteforge awesome-scan` | Discover and classify skills across sources | `--source`, `--domain`, `--install` |
| `danteforge oss` | Auto-detect project, search OSS, clone, license-gate, extract patterns | `--prompt`, `--dry-run`, `--max-repos` |
| `danteforge oss-clean` | Remove cached OSS repos from .danteforge/oss-repos/ | `--dry-run` |
| `danteforge oss-learn` | Re-extract patterns from cached OSS repos and regenerate OSS_REPORT.md | `--prompt` |
| `danteforge local-harvest [paths...]` | Harvest patterns from local private repos, folders, and zip archives | `--config`, `--depth`, `--prompt`, `--dry-run`, `--max-sources` |
| `danteforge harvest` | Titan Harvest V2: 5-step constitutional harvest of OSS patterns | `--prompt`, `--lite` |
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
| `danteforge score` | Fast pure-fs score: one number + 3 P0 action items in <5 seconds (no LLM) | `--full` |
| `danteforge prime` | Generate .danteforge/PRIME.md session brief for Claude Code | `--copy` |
| `danteforge teach` | Capture an AI correction into lessons.md and auto-update PRIME.md | |
| `danteforge go` | Daily driver: run self-improve loop with no flags (maxCycles:5, target:9.0) | |
| `danteforge harvest-pattern` | Focused OSS pattern harvest with Y/N confirmation per gap | `--max-repos` |
| `danteforge build` | Guided spec-to-ship wizard: constitution→specify→clarify→plan→tasks→forge→verify→score | `--interactive` |
| `danteforge ascend` | Fully autonomous scoring loop: classify ceiling dims, drive all achievable to 9.0/10 | `--target`, `--max-cycles`, `--interactive`, `--dry-run` |
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
