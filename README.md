# DanteForge

DanteForge is an agent-oriented development workflow for Codex, Claude Code, VS Code, and direct CLI use. It turns high-level intent into explicit artifacts, execution prompts, and verification gates without claiming work happened when it did not.

> Anti-Stub Doctrine: shipped implementation must not rely on `TODO`, `FIXME`, `TBD`, or placeholder/stub markers. Repo verification enforces this with `npm run check:anti-stub`.

> **5-10x Token Savings**: Local-first planning, scoped wave execution, hard gates, context rot detection, and self-improving lessons mean you can run multiple projects without burning through LLM credits. See [docs/Token-Savings.md](docs/Token-Savings.md) for the full breakdown.

## Product Focus

DanteForge is designed to be used in three primary ways:

1. From terminal-based coding agents such as Codex or Claude Code.
2. From the VS Code extension as a workspace command surface.
3. From the raw CLI in repositories that want structured planning and execution artifacts.

The CLI and the VS Code extension are both first-class release targets.
The packaged npm artifact also carries the `.claude-plugin/` manifests used for plugin-host packaging and parity checks.

## Who This Is For

DanteForge is for developers and teams who want:

- **Structured development workflows** — not ad-hoc prompting, but a deterministic pipeline from idea to verified implementation
- **Multi-agent orchestration** — coordinate multiple coding agents (Claude Code, Codex, Gemini, OpenCode, Cursor) with shared state
- **Offline-first planning** — generate specs, plans, and tasks locally without burning LLM credits
- **Quality gates** — hard gates that prevent skipping steps, anti-stub doctrine, and fail-closed verification
- **Token efficiency** — scoped context windows, wave-based execution, and self-improving lessons reduce LLM costs by 5-10x

### Compared To

| Feature | DanteForge | Cursor | Aider | Continue.dev | Windsurf |
|---------|-----------|--------|-------|--------------|----------|
| Structured pipeline | 12-stage | No | No | No | No |
| Multi-agent party mode | Yes | No | No | No | No |
| Offline planning | Yes | No | Partial | Partial | No |
| Hard quality gates | Yes | No | No | No | No |
| Agent-agnostic | Yes | Cursor only | Git-based | VS Code | Windsurf only |
| Design-as-Code | Yes (.op files) | No | No | No | No |
| OSS pattern harvesting | Yes (license-gated) | No | No | No | No |
| Autonomous optimization | Yes (autoresearch) | No | No | No | No |

## Operational Status

DanteForge `0.8.0` is in GA hardening for offline and fail-closed operation. Treat release readiness as proven only when the verification and release gates below pass in your environment and CI. For the current-state verification surface and the explicit follow-up list, see [docs/Operational-Readiness-v0.8.0.md](docs/Operational-Readiness-v0.8.0.md).

## Install

### From source

```bash
git clone https://github.com/danteforge/danteforge.git
cd danteforge
npm ci
npm run verify:all
npm link
```

### From a packaged tarball

If you are validating the packed release before npm publish, install from the generated tarball instead of the public registry:

```bash
npm pack
npm install -g ./danteforge-0.8.0.tgz
```

Run `npm run verify:live` only when you are validating a secret-backed live environment or a release candidate.

For GitHub-hosted live canaries, use `.github/workflows/live-canary.yml` with repository secrets and variables configured.

Package install is intentionally non-mutating for user home and project assistant files. To enable assistants explicitly after install, run:

```bash
danteforge setup assistants
```

This installs the bundled DanteForge skills into the user-level Claude, Codex, Gemini/Antigravity, and OpenCode registries:

- `~/.claude/skills`
- `~/.codex/skills`
- `~/.gemini/antigravity/skills`
- `~/.config/opencode/skills`

For Codex, explicit setup syncs the workflow command markdown files into `~/.codex/commands`, keeps a small non-colliding set of CLI utility aliases in `~/.codex/config.toml`, and maintains a managed global bootstrap at `~/.codex/AGENTS.md`, so commands such as `/spark`, `/ember`, `/magic`, `/blaze`, `/inferno`, `/autoforge`, and `/party` stay native workflow commands instead of shell aliases in local Codex environments.

The bundled skill catalog also includes `danteforge-cli`, which now acts as an explicit CLI fallback when the user asks for terminal execution or when native workflow command files are unavailable.

If you need to repair or re-run that explicit setup:

```bash
danteforge setup assistants
```

Standalone CLI secrets remain host-agnostic: configure them once with `danteforge config`, and DanteForge will read them from the shared user-level file `~/.danteforge/config.yaml` no matter whether you launch it from Codex, Claude Code, Gemini/Antigravity, OpenCode, or a raw terminal.

If you want Cursor project bootstrap files as well, run:

```bash
danteforge setup assistants --assistants cursor
```

This creates `.cursor/rules/danteforge.mdc` in the current project.

For the full standalone install matrix, assistant targets, and secret setup flow, see [docs/Standalone-Assistant-Setup.md](docs/Standalone-Assistant-Setup.md).

To harvest one upstream Antigravity bundle into the packaged DanteForge skills catalog:

```bash
danteforge skills import --from antigravity --bundle "Web Wizard" --enhance
```

Each successful import updates `src/harvested/dante-agents/skills/IMPORT_MANIFEST.yaml` so maintainers can audit which bundles and skills were harvested.

### VS Code extension

```bash
npm --prefix vscode-extension ci
npm --prefix vscode-extension run verify
```

The extension prefers a workspace-local DanteForge binary when one exists in `node_modules/.bin/`, and falls back to a global `danteforge` install otherwise.

## Quick Start

```bash
danteforge init    # detect project, check health, show next steps
```

### With an LLM configured

```bash
danteforge config --set-key "grok:xai-YOUR-KEY"
danteforge inferno "Build a modern photo-sharing app with real-time feeds"
```

### Local-only mode

```bash
danteforge constitution
danteforge specify "Build a modern photo-sharing app with real-time feeds"
danteforge clarify
danteforge plan
danteforge tasks
danteforge forge 1 --prompt
```

In local-only mode:

- `specify`, `clarify`, `plan`, and `tasks` generate real artifacts in `.danteforge/`.
- `forge` requires a live LLM for direct execution, or `--prompt` for manual prompt generation.
- `verify` exits non-zero when artifacts or phase requirements are incomplete.

## Agent Setup

### Codex / Claude Code

- `AGENTS.md` is the canonical instruction file for coding agents.
- `.codex/config.toml` contains the standard install, verification, release, and non-colliding CLI utility aliases for Codex tooling.
- `CLAUDE.md` contains adapter notes and architecture context for Claude-oriented workflows.
- DanteForge package install does not modify assistant registries automatically.
- Run `danteforge setup assistants` to explicitly install or refresh Claude, Codex, Gemini/Antigravity, and OpenCode registries.
- For Codex specifically, keep the repo-local `.codex/config.toml` and refresh `~/.codex/skills`, `~/.codex/config.toml`, `~/.codex/commands`, and `~/.codex/AGENTS.md` with `danteforge setup assistants --assistants codex` after upgrades.
- In Codex, workflow slash commands are native and come from `commands/*.md` plus `~/.codex/commands/*.md`; use the CLI only when explicitly requested.
- Codex, Claude, Gemini/Antigravity, and OpenCode all receive the bundled `danteforge-cli` skill as a CLI fallback path for explicit terminal execution.
- Run `danteforge setup assistants --assistants cursor` to create the Cursor project bootstrap rule in `.cursor/rules/`.
- Secrets still live once in `~/.danteforge/config.yaml` even when different assistants invoke the CLI.

## What Codex Can Do Today

- Local Codex environments can use synced `~/.codex/skills`, `~/.codex/commands`, `~/.codex/AGENTS.md`, and the repo-local `.codex/config.toml` for a native DanteForge workflow experience.
- Hosted Codex/chat surfaces may not honor user-level installs such as `~/.codex/commands` or `~/.codex/skills`; that is a platform limitation, not a DanteForge bug.
- When native Codex command files are unavailable, the bundled `danteforge-cli` skill is the explicit fallback path for terminal-style execution.
- If Codex does not feel native locally, verify `~/.codex/commands`, `~/.codex/skills`, `~/.codex/AGENTS.md`, and the current repo’s `.codex/config.toml`, then rerun `danteforge setup assistants --assistants codex`.

### VS Code

Available extension commands:

- `DanteForge: Constitution`
- `DanteForge: Specify Idea`
- `DanteForge: Review Project`
- `DanteForge: Verify State`
- `DanteForge: Doctor`
- `DanteForge: Forge Wave`
- `DanteForge: Party Mode`
- `DanteForge: Magic Mode`

## Core Workflow

```text
review -> constitution -> specify -> clarify -> plan -> tasks -> forge -> verify -> synthesize
```

Typical CLI usage:

```bash
danteforge review
danteforge constitution
danteforge specify "Build a modern photo-sharing app with real-time feeds and social features"
danteforge clarify
danteforge plan
danteforge tasks
danteforge forge 1 --parallel --profile quality
danteforge verify
danteforge synthesize
```

If the project has a frontend workflow:

```bash
danteforge ux-refine --openpencil
danteforge ux-refine --prompt --figma-url <your-figma-file-url>
danteforge forge 2 --figma --prompt --profile quality
danteforge party --worktree --isolation
danteforge autoforge "stabilize the release candidate" --dry-run
```

## Magic Levels

Usage rule:
- First-time new matrix dimension + fresh OSS discovery -> `/inferno`
- All follow-up PRD gap closing -> `/magic`

| Command | Intensity | Token Level | Combines (Best Of) | Primary Use Case |
| --- | --- | --- | --- | --- |
| `danteforge spark [goal]` | Planning | Zero | review + constitution + specify + clarify + plan + tasks | Every new idea or project start |
| `danteforge ember [goal]` | Light | Very Low | Budget magic + light checkpoints + basic loop detect | Quick features, prototyping, token-conscious work |
| `danteforge magic [goal]` | Balanced (Default) | Low-Medium | Balanced party lanes + autoforge reliability + lessons | Daily main command - 80% of all work |
| `danteforge blaze [goal]` | High | High | Full party + strong autoforge + self-improve | Big features needing real power |
| `danteforge inferno [goal]` | Maximum | Maximum | Full party + max autoforge + deep OSS mining + evolution | First big attack on new matrix dimension |

Full operator guidance lives in [.danteforge/MAGIC-LEVELS.md](.danteforge/MAGIC-LEVELS.md).

## Command Reference

| Command | Description |
| --- | --- |
| `danteforge init` | Interactive first-run wizard — detect project, check health, show next steps |
| `danteforge constitution` | Initialize project principles and constraints |
| `danteforge specify <idea>` | Turn a high-level idea into `SPEC.md` |
| `danteforge clarify` | Generate `CLARIFY.md` for requirement gaps |
| `danteforge plan` | Generate `PLAN.md` from the current spec |
| `danteforge tasks` | Generate `TASKS.md` and store phase 1 tasks |
| `danteforge design <prompt>` | Generate `DESIGN.op` with a real LLM or `--prompt` |
| `danteforge ux-refine` | Run `--openpencil` extraction or generate a `--prompt`-driven UX refinement workflow |
| `danteforge forge [phase]` | Execute a wave with LLMs or generate prompts with `--prompt` |
| `danteforge spark [goal]` | Zero-token planning preset for new ideas and project starts |
| `danteforge ember [goal]` | Very low-token preset for token-conscious follow-up work |
| `danteforge party` | Launch multi-agent collaboration mode, with optional `--worktree` and `--isolation` |
| `danteforge review` | Scan the repo and generate `CURRENT_STATE.md` |
| `danteforge browse` | Drive the browser automation surface for navigation, screenshots, console, network, and accessibility evidence |
| `danteforge qa` | Run structured browser QA with health scoring, baselines, `--url`, and optional fail thresholds |
| `danteforge retro` | Generate retrospective artifacts and delta tracking from the current project state |
| `danteforge ship` | Run paranoid review, version bump guidance, changelog drafting, and release guidance |
| `danteforge verify` | Fail-closed artifact and state verification, with optional `--release` checks |
| `danteforge synthesize` | Merge artifacts into `UPR.md` |
| `danteforge autoforge [goal]` | Deterministic pipeline orchestration with optional goal annotation |
| `danteforge awesome-scan` | Discover, classify, and optionally import skills across sources |
| `danteforge skills import --from antigravity` | Import and wrap one Antigravity bundle into `src/harvested/dante-agents/skills/` |
| `danteforge doctor` | Check local setup, real repairs (`--fix`), and live integrations (`--live`) |
| `danteforge dashboard` | Start a local status dashboard |
| `danteforge magic [goal]` | Run the balanced default preset for daily gap-closing |
| `danteforge blaze [goal]` | Run the high-power preset with full party escalation |
| `danteforge inferno [goal]` | Run the maximum-power preset with OSS discovery and evolution |
| `danteforge setup figma` | Configure Figma MCP integration |
| `danteforge update-mcp` | Check and apply MCP metadata updates |
| `danteforge tech-decide` | Generate tech-stack guidance |
| `danteforge lessons` | Capture and compact persistent lessons |
| `danteforge autoresearch <goal>` | Autonomous metric-driven optimization loop |
| `danteforge oss` | Autonomous OSS pattern harvesting with license gates |
| `danteforge harvest <system>` | Titan Harvest V2 — constitutional pattern harvesting |
| `danteforge docs` | Generate or update the command reference documentation |

Common flags:

| Flag | Description |
| --- | --- |
| `--parallel` | Run phase tasks in parallel where possible |
| `--profile <type>` | `quality`, `balanced`, or `budget` |
| `--prompt` | Force prompt generation instead of direct execution |
| `--light` | Bypass hard gates for exploratory work |
| `--worktree` | Run in an isolated git worktree |
| `--isolation` | Run party subagents behind review isolation |
| `--figma` | Use the prompt-driven Figma refinement path during forge (`forge` requires `--prompt`) |
| `--skip-ux` | Skip UX refinement paths |
| `--quiet` | Suppress non-error output |
| `--verbose` | Enable verbose logging |

## No API Key Required

DanteForge supports useful local behavior without an API key.

- Planning commands write deterministic local artifacts.
- Execution commands require a live provider unless you pass `--prompt`.
- `--prompt` remains available for any command when you want explicit copy-paste control.

Example:

```bash
danteforge specify "Your idea" --prompt
```

Prompts are saved under `.danteforge/prompts/`.

## Verification

Repository-level quality gates:

```bash
npm run verify
npm run verify:all
npm run check:anti-stub
npm run check:repo-hygiene
npm run check:repo-hygiene:strict
npm run check:plugin-manifests
npm run check:third-party-notices
npm run check:cli-smoke
npm run release:check
npm run release:check:install-smoke
npm run release:check:strict
npm run release:check:simulated-fresh
npm run verify:live
npm run release:ga
```

What they mean:

- `npm run verify`: root typecheck, lint, anti-stub scan, and tests.
- `npm run check:anti-stub`: scans shipped implementation paths for `TODO`, `FIXME`, `TBD`, and placeholder/stub markers.
- `npm run verify:all`: root verification, CLI build, and VS Code extension verification.
- `npm run check:plugin-manifests`: validates the packaged `.claude-plugin/` manifests against the npm package metadata.
- `npm run check:cli-smoke`: runs operator-facing CLI smoke checks against the built `dist` binary.
- `npm run release:check:install-smoke`: packs the CLI, installs it into a temp project, and proves the installed binary runs.
- `npm run release:check`: repo hygiene, verification, plugin manifest validation, packed CLI install smoke test, packaging dry run, and notice validation.
- `npm run release:check:strict`: stages an isolated temp sandbox copy, enforces strict generated-path hygiene there, then runs the strict release chain.
- `npm run release:check:simulated-fresh`: copies the repo to a temp sandbox, isolates home/config state, runs the strict hygiene gate before installs, then runs the normal release gate in that simulated fresh environment.
- `npm run verify:live`: runs real provider, upstream, and Figma reachability checks using live secrets and services.
- `npm run release:ga`: runs the strict release gate plus `verify:live`.
- `.github/workflows/live-canary.yml`: scheduled/manual secret-backed canary for `build`, `check:cli-smoke`, and `verify:live`.

Live verification environment:

```bash
set DANTEFORGE_LIVE_PROVIDERS=openai,claude
set OPENAI_API_KEY=...
set ANTHROPIC_API_KEY=...
```

- `DANTEFORGE_LIVE_PROVIDERS` selects which providers are exercised: `openai`, `claude`, `gemini`, `grok`, `ollama`.
- `OPENAI_API_KEY` is required when `openai` is selected.
- `ANTHROPIC_API_KEY` is required when `claude` is selected.
- `GEMINI_API_KEY` is required when `gemini` is selected.
- `XAI_API_KEY` is required when `grok` is selected.
- `OLLAMA_MODEL` is required when `ollama` is selected. Prefer the exact installed tag, for example `qwen2.5-coder:latest`.
- `OLLAMA_BASE_URL` is optional and defaults to `http://127.0.0.1:11434`.
- `DANTEFORGE_LIVE_TIMEOUT_MS` optionally raises the live-check timeout for all providers.
- `OLLAMA_TIMEOUT_MS` optionally raises the timeout for slower local Ollama models.
- `ANTIGRAVITY_BUNDLES_URL` optionally overrides the live Antigravity upstream target.
- `FIGMA_MCP_URL` optionally overrides the live Figma MCP endpoint target.

Runtime verification:

- `danteforge verify` checks DanteForge artifacts and phase consistency.
- `danteforge verify --release` includes build/package/install release checks from the CLI.
- It exits non-zero when verification is incomplete or broken.
- `npm run release:check:simulated-fresh` reproduces the strict release flow in a temp checkout.

GA checklist:

- `npm run verify`
- `npm run verify:all`
- `npm run check:cli-smoke`
- `npm run release:check:strict`
- `npm run release:check:simulated-fresh`
- `npm audit --omit=dev`
- `npm --prefix vscode-extension audit --omit=dev`
- successful `npm run verify:live` canary

## LLM Providers

Supported providers:

- `ollama`
- `grok`
- `claude`
- `openai`
- `gemini`

Examples:

```bash
danteforge config --set-key "grok:xai-..."
danteforge config --set-key "claude:sk-..."
danteforge config --set-key "openai:sk-..."
```

Secrets are stored in the user-level config file at `~/.danteforge/config.yaml`.

## Figma MCP

Figma support is optional and works best in MCP-aware environments.

```bash
danteforge setup figma
danteforge ux-refine --prompt --figma-url <your-figma-file-url>
danteforge ux-refine --openpencil
```

Host tiers:

- Full: Claude Code, Codex
- Pull-only: Cursor, VS Code, Windsurf
- Prompt-only: unknown hosts

Automatic Figma execution is not treated as GA unless a real MCP execution path is available. The supported GA paths are `ux-refine --prompt` and `ux-refine --openpencil`.

## Release

For maintainers:

```bash
npm run release:check:strict
npm run release:check:simulated-fresh
npm run verify:live
npm run release:ga
```

Before `npm run verify:live`, configure the live environment explicitly:

- `DANTEFORGE_LIVE_PROVIDERS=openai,claude,gemini,grok,ollama`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and `XAI_API_KEY` as needed for the selected providers
- `OLLAMA_MODEL` for local Ollama validation. Use an exact installed tag when possible.
- `OLLAMA_BASE_URL` if Ollama is not running on `http://127.0.0.1:11434`
- `DANTEFORGE_LIVE_TIMEOUT_MS` to raise live-check timeouts globally
- `OLLAMA_TIMEOUT_MS` to raise timeouts for slower local Ollama models
- `ANTIGRAVITY_BUNDLES_URL` only if you need to point at a non-default upstream bundle manifest
- `FIGMA_MCP_URL` only if you need to point at a non-default Figma MCP endpoint

See [RELEASE.md](RELEASE.md) for the full release flow.

## License

MIT. See [LICENSE](LICENSE) for details.
