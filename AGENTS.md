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
- In Codex, treat workflow slash commands backed by `commands/*.md` as native repo commands. When the user invokes `/spark`, `/ember`, `/magic`, `/blaze`, `/inferno`, `/autoforge`, `/party`, or another workflow slash command, execute the workflow in the workspace instead of defaulting to `danteforge <command>` unless the user explicitly asks for CLI execution or parity testing.
- Keep `.codex/config.toml` free of workflow-command alias collisions so native slash commands win in Codex.
- Do not commit generated/vendor paths (`node_modules/`, `dist/`, `coverage/`, `./.danteforge/`, `vscode-extension/node_modules/`, `vscode-extension/dist/`).

## Definition Of Done

- `npm run verify` passes
- `npm run build` passes
- `npm --prefix vscode-extension run build` passes when extension files changed
- Tests/docs updated when behavior or operator workflow changes

## Workflow Pipeline

```
review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship
```

Use `--light` flag on any command to bypass gates for simple changes.

## DanteForge CLI Commands

### Magic Levels

Usage rule:
- First-time new matrix dimension + fresh OSS discovery -> `danteforge inferno`
- All follow-up PRD gap closing -> `danteforge magic`

| Command | Intensity | Token Level | Combines (Best Of) | Primary Use Case |
|---------|-----------|-------------|--------------------|------------------|
| `danteforge spark [goal]` | Planning | Zero | review + constitution + specify + clarify + tech-decide + plan + tasks | Every new idea or project start |
| `danteforge ember [goal]` | Light | Very Low | Budget magic + light checkpoints + basic loop detect | Quick features, prototyping, token-conscious work |
| `danteforge canvas [goal]` | Design-First | Low-Medium | Design generation + autoforge + UX token extraction + verify | Frontend-heavy features where visual design drives implementation |
| `danteforge magic [goal]` | Balanced (Default) | Low-Medium | Balanced party lanes + autoforge reliability + verify + lessons | Daily main command - 80% of all work |
| `danteforge blaze [goal]` | High | High | Full party + strong autoforge + synthesize + retro + self-improve | Big features needing real power |
| `danteforge nova [goal]` | Very High | High-Max | Planning prefix + blaze execution + inferno polish (no OSS) | Feature sprints needing planning + deep execution |
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
| `danteforge verify` | Verification checks on project state | none | `--release`, `--live`, `--url`, `--json`, `--recompute` |
| `danteforge synthesize` | Generate UPR.md from all artifacts | none | — |

### Multi-Agent & Automation

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `danteforge spark [goal]` | Zero-token planning preset | `--prompt`, `--skip-tech-decide` |
| `danteforge ember [goal]` | Very low-token preset for quick follow-up work | `--profile`, `--prompt` |
| `danteforge canvas [goal]` | Design-first frontend preset | `--profile`, `--prompt`, `--design-prompt` |
| `danteforge party` | Multi-agent collaboration mode | `--worktree`, `--isolation`, `--design` |
| `danteforge autoforge [goal]` | Deterministic auto-orchestration | `--dry-run`, `--auto`, `--score-only`, `--max-waves`, `--profile`, `--parallel`, `--force` |
| `danteforge magic [goal]` | Balanced default preset for daily gap-closing | `--level`, `--profile`, `--prompt`, `--worktree`, `--isolation` |
| `danteforge blaze [goal]` | High-power preset with full party escalation | `--profile`, `--prompt`, `--worktree`, `--isolation`, `--with-design`, `--design-prompt` |
| `danteforge nova [goal]` | Very-high-power: planning prefix + deep execution + polish, no OSS | `--profile`, `--prompt`, `--worktree`, `--isolation`, `--tech-decide`, `--with-design` |
| `danteforge inferno [goal]` | Maximum-power preset with OSS discovery | `--profile`, `--prompt`, `--worktree`, `--isolation`, `--max-repos`, `--with-design` |

### Quality & Release

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `danteforge qa --url <url>` | Structured QA with health score | `--type`, `--baseline`, `--fail-below` |
| `danteforge ship` | Paranoid release guidance + version bump plan | `--dry-run`, `--skip-review` |
| `danteforge retro` | Project retrospective with trends | `--summary`, `--cwd` |
| `danteforge lessons [correction]` | Self-improving rules from corrections | `--compact`, `--prompt` |

### Exploration & Discovery

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `danteforge debug <issue>` | 4-phase systematic debugging | `--prompt` |
| `danteforge browse <subcommand>` | Browser automation (navigate, screenshot, inspect) | `--url`, `--port` |
| `danteforge awesome-scan` | Discover and classify skills across sources | `--source`, `--domain`, `--install` |
| `danteforge oss` | Auto-detect project, search OSS, clone, license-gate, extract patterns | `--prompt`, `--dry-run`, `--max-repos` |
| `danteforge harvest` | Titan Harvest V2: 5-step constitutional harvest of OSS patterns | `--prompt`, `--lite` |
| `danteforge local-harvest [paths...]` | Harvest patterns from local private repos/folders/zips — combines with OSS CI | `--config`, `--depth`, `--prompt`, `--dry-run`, `--max-sources` |

### Utilities

| Command | Description |
|---------|-------------|
| `danteforge config` | Manage API keys and LLM provider settings |
| `danteforge setup <tool>` | Interactive setup wizard (figma, assistants) |
| `danteforge doctor` | System health check and diagnostics |
| `danteforge dashboard` | Launch progress dashboard (local HTML) |
| `danteforge compact` | Compact audit log |
| `danteforge cost` | Session token / cost report (budget usage summary) |
| `danteforge mcp-start` | Start MCP server exposing 15 DanteForge tools |
| `danteforge help [query]` | Context-aware guidance |
| `danteforge update-mcp` | Manual MCP self-healing |
| `danteforge import <file>` | Import LLM-generated file into .danteforge/ |
| `danteforge feedback` | Generate prompt from UPR.md for LLM refinement |
| `danteforge skills import` | Import Antigravity skill bundle |
| `danteforge policy [get\|set <value>]` | Get or set self-edit policy (deny \| confirm \| allow-with-audit) |
| `danteforge audit` | Query self-edit audit log (`--last N`, `--format json`) |

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

## Hard Gates

DanteForge enforces mandatory checkpoints (bypass with `--light`):
- Constitution must exist before specification
- Spec must exist before planning
- Plan must exist before execution
- Tests must exist before code (when TDD enabled)

## v0.9.2 Trust Spine

### Safe Self-Edit Policy

DanteForge enforces a **fail-closed** policy on protected core files by default.

**Protected paths** (require explicit approval to modify):
- `src/core/state.ts`, `src/core/gates.ts`, `src/core/handoff.ts`
- `src/core/workflow-enforcer.ts`, `src/core/autoforge.ts`, `src/core/pdse.ts`
- `src/cli/index.ts`

**Policy modes** (set `selfEditPolicy` in `STATE.yaml`):
| Policy | Behavior |
|--------|----------|
| `deny` (default) | Protected mutations blocked; audit entry written |
| `confirm` | Interactive y/N prompt in TTY; degrades to deny in non-TTY |
| `allow-with-audit` | Approved with warning log; audit entry always written |

The autoforge loop gates each forge wave with `checkProtectedTaskPaths` before dispatch. Any task that declares a protected file path will be evaluated against the current policy before proceeding.

**CLI commands:** `danteforge policy get|set <deny|confirm|allow-with-audit>` reads/writes `selfEditPolicy` in STATE.yaml. `danteforge audit [--last N] [--format json]` queries the audit log at `.danteforge/audit/self-edit.log`.

### Verify Receipts

After every `danteforge verify` run, a machine-readable receipt is written to:
- `.danteforge/evidence/verify/latest.json` — full JSON receipt
- `.danteforge/evidence/verify/latest.md` — human-readable summary

Use `danteforge verify --json` to emit the receipt JSON to stdout (logger output is redirected to stderr, making the output machine-parseable). Use `--recompute` to force a re-evaluation even if state is fresh.

The `lastVerifyStatus` field in `STATE.yaml` reflects the receipt outcome (`pass`/`warn`/`fail`) and is used by the completion tracker to determine if verification is complete. A timestamp alone is not sufficient — the receipt status must be `pass`.

### Receipt-Based Completion

The completion tracker uses `lastVerifyStatus === 'pass'` (not `lastVerifiedAt !== undefined`) as the truth signal for verification completeness. This ensures a failed or warned verify run does not falsely advance the pipeline.
