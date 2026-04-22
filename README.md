# DanteForge - spec-driven agentic dev CLI. Works with Claude Code, local Codex installs, Cursor, and Goose.

[![npm version](https://img.shields.io/badge/npm-0.17.0-blue)](https://www.npmjs.com/package/danteforge)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

## 30-Second Install

```bash
npm install -g danteforge
danteforge go
```

## First 5 Minutes

```bash
danteforge go
```

**First run** (no project yet): 3-question setup wizard (2 min) -> fast score -> top 3 gaps.  
**Every run after**: shows current score, recommends the one next action, asks to confirm.

**What you'll see after setup:**

```text
  DanteForge - Project State
  -------------------------------------------------
  Overall  6.8/10  needs-work

  P0 gaps (below 7.0):
    Error Handling        ====....  6.2
    Security              =====...  6.8

  Recommended next step:
    Improve Error Handling  (currently 6.2/10)
    Runs one targeted improvement cycle and then re-checks your score.
    -> danteforge improve "improve error handling"

  Start? [Y/n]
```

**No API key yet?** All planning commands work offline. Only improvement loops need a provider.

```bash
danteforge score               # fast local score, no API key required
danteforge spark "your idea"   # zero-token planning - works without any API key
danteforge config --set-key "claude:<key>"  # add a key when ready
```

## Flagship Path

If you only learn one DanteForge loop, make it this one:

1. `danteforge go` - 3-question setup on first run, then your score and top gaps.
2. `danteforge improve "<goal>"` - targeted improvement cycle when you want to push one area.
3. `danteforge verify` - machine-readable quality gate before you call anything "done".

See it working right now - the todo-app has already been run through the full pipeline:

```bash
cd examples/todo-app && danteforge score
```

### What DanteForge actually gives you

| Without DanteForge | With DanteForge |
|---|---|
| AI produces code, you guess if it's good | Score 0-10 across 17 dimensions |
| Each session starts from scratch | Self-improving lessons injected from past failures |
| You accept whatever the AI produces | Convergence loop runs until quality gates pass |
| No idea how you compare to alternatives | Competitive matrix tracks gap to leader per dimension |
| Scoring is self-reported and inflated | Blind adversary model catches inflation automatically |

### Canonical Commands

Five commands, three levels. That's the whole mental model.

```bash
# plan — what should we build?
danteforge plan "build auth system" --level light     # review + specify
danteforge plan "build auth system" --level standard  # full planning pipeline
danteforge plan "build auth system" --level deep      # + tech-decide + tasks

# build — make progress
danteforge build "close auth gaps" --level light      # single forge wave
danteforge build "close auth gaps" --level standard   # magic-style balanced execution
danteforge build "close auth gaps" --level deep       # inferno + OSS harvest

# measure — how good are we?
danteforge measure --level light                      # quick score (default)
danteforge measure --level standard                   # score + maturity + proof delta
danteforge measure --level deep                       # verify + adversarial + convergence

# compete — where do we lag?
danteforge compete --level light                      # harsh self-assessment
danteforge compete --level standard                   # + universe refresh
danteforge compete --level deep                       # full Competitive Harvest Loop

# harvest — learn from OSS
danteforge harvest "CLI patterns" --level light       # focused pattern harvest
danteforge harvest --level standard                   # bounded OSS pass
danteforge harvest --level deep --until-saturation    # loop until library saturates
```

Branded presets (`spark`, `magic`, `inferno`, etc.) still work — they are aliases for the canonical commands above.

### Core commands

```bash
danteforge go          # smart entry point: state panel + guided action
danteforge start       # plain-English alias for go
danteforge score       # fast score: one number + 3 P0 items in <5s
danteforge measure     # plain-English alias for score
danteforge verify      # machine-readable quality gate
danteforge check       # plain-English alias for verify
danteforge improve     # plain-English alias for magic
danteforge ascend      # full autonomous loop: runs until all dims hit 9.0
danteforge init        # setup wizard (use --advanced for provider/editor extras)
```
## Full Pipeline Example

```bash
danteforge constitution   # define your project
danteforge nova           # 9-step autonomous build cycle (~$3)
danteforge assess         # 18-dimension quality report vs 27 competitors
```

## Works With

DanteForge exposes an MCP server that each of these agents can connect to directly:

- **Claude Code** - full MCP integration + plugin manifest + slash commands
- **Codex CLI (local installs)** - native workflow slash commands via `~/.codex/commands`
- **Cursor** - MCP server + `.cursor/mcp.json` config
- **Windsurf** - MCP server via stdio

```json
// Add to your Claude Code / Cursor MCP config:
{ "danteforge": { "command": "danteforge", "args": ["mcp-server"] } }
```

## Supported Programmatic API

The supported typed library surface is `danteforge/sdk`.

```ts
import { assess, computeHarshScore, loadState } from 'danteforge/sdk';
```

Treat the root `danteforge` package as the CLI entrypoint, not the primary typed API surface.

## Why DanteForge?

DanteForge is the **trust spine** for AI-assisted development â€” it prevents the "narrate completion, skip closure" failure mode that plagues most AI coding tools.

### Key Differentiators

- **Evidence-based convergence**: Runs assessâ†’forgeâ†’verifyâ†’assess loops until measurable quality targets are hit
- **Spec enforcement**: Constitution-driven pipeline prevents skipping steps (specâ†’clarifyâ†’planâ†’tasksâ†’forgeâ†’verify)
- **18-dimension quality scoring**: Self-assessment against 27 competitors with gap analysis and masterplans
- **Enterprise foundations**: audit trails, workspace controls, budget controls, and release gates
- **Multi-agent orchestration**: MCP server + plugin manifest for Claude Code, Cursor, Codex CLI, Goose
- **Constitution guarantees**: Project principles are enforced, not just suggested

## Stability

- **Stable**: core CLI workflow, verify gates, assistant setup, release checks, and the VS Code extension install path
- **Beta**: autonomous loops, live verification, and higher-power multi-agent orchestration
- **Experimental**: advanced provider integrations, deep OSS harvesting loops, and maintainer-only sibling repo sync flows

## Launch-Supported Surfaces

- **local-only CLI**: no API keys required for `danteforge init`, `danteforge go`, `danteforge review`, and the bundled example path
- **live-provider CLI**: secret-backed verification via `npm run verify:live` or `.github/workflows/live-canary.yml`
- **VS Code extension**: verified install/package path backed by `npm --prefix vscode-extension run verify`

### Quality Standards

DanteForge enforces a **maturity-aware quality system** with 6 levels:
- **Level 1 (Sketch)**: Proves the idea works
- **Level 2 (Prototype)**: Investor-ready MVP
- **Level 3 (Alpha)**: Internal team use
- **Level 4 (Beta)**: Paid beta customers
- **Level 5 (Customer-Ready)**: Production launch
- **Level 6 (Enterprise-Grade)**: Fortune 500 scale

## Quick Example

**Build a complete TODO CLI app in 3 minutes:**

```bash
# Define what you want
danteforge constitution "A simple CLI todo app with add, list, complete, delete"

# AI generates spec, plan, and code
danteforge nova "todo app with CLI interface"

# Quality check vs competitors
danteforge assess
```

See [`examples/todo-app/`](examples/todo-app/) for a complete walkthrough â€” spec to working code with zero manual coding.

## Advanced Usage

### Autonomous Development Loops
```bash
# Run until 9.0+ quality scores
danteforge self-improve --level 5

# Assess current state vs 27 competitors
danteforge assess --json | jq '.assessment.displayScore'
```

### MCP Integration
```json
// Add to Claude Code / Cursor config:
{
  "mcpServers": {
    "danteforge": {
      "command": "danteforge",
      "args": ["mcp-server"]
    }
  }
}
```

### Enterprise Features
```bash
# Audit trails and compliance
danteforge enterprise-readiness

# Multi-tenant isolation
danteforge config --workspace my-team

# Budget controls
danteforge spark --max-budget 5.00
```

## How DanteForge Compares

DanteForge occupies a different niche than editor-native tools (Cursor, Copilot) or hosted agents (Devin). It's a **CLI-first, spec-driven pipeline** â€” closest to Aider and Codex CLI in form factor, but with a structured constitution-to-verify workflow that those tools lack.

**Strengths:** Spec enforcement, multi-provider LLM support (7 providers), convergence loops, deterministic autoforge pipeline, budget controls.

**Gaps:** No deep IDE integration (VS Code extension is a terminal wrapper), no hosted mode, early-stage community.

Run `danteforge assess` for a full 18-dimension self-assessment against 27 competitors. Note: these scores are self-generated and not independently verified.

## Links

- [Integration Guide](docs/INTEGRATION-GUIDE.md)
- [Magic Levels](docs/MAGIC-LEVELS.md)
- [Release History](docs/Release-History.md)
- [First 15 Minutes](docs/tutorials/first-15-minutes.md)
- [Case Study: Public Example](docs/case-studies/public-example.md)
- [Case Study: Internal Self-Hosting](docs/case-studies/internal-self-hosting.md)
- [SECURITY.md](SECURITY.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

---

## Who This Is For

DanteForge is an agent-oriented development workflow for Codex, Claude Code, VS Code, and direct CLI use. It turns high-level intent into explicit artifacts, execution prompts, and verification gates without claiming work happened when it did not.

> Anti-Stub Doctrine: shipped implementation must not rely on `TODO`, `FIXME`, `TBD`, or placeholder/stub markers. Repo verification enforces this with `npm run check:anti-stub`.

> **5-10x Token Savings**: Local-first planning, scoped wave execution, hard gates, context rot detection, and self-improving lessons mean you can run multiple projects without burning through LLM credits. See [docs/Token-Savings.md](docs/Token-Savings.md) for the full breakdown.

## Operational Status

DanteForge `0.17.0` is in active development. Treat release readiness as proven only when the verification and release gates below pass in your environment and CI. [docs/Operational-Readiness-v0.17.0.md](docs/Operational-Readiness-v0.17.0.md) is generated from the latest local verify, release-proof, and live-proof receipts so the readiness story stays evidence-backed.

## Install

### From source

```bash
git clone https://github.com/dantericardo88/danteforge.git
cd danteforge
npm ci
npm run verify:all
npm link
```

### From a packaged tarball

If you are validating the packed release before npm publish, install from the generated tarball instead of the public registry:

```bash
npm pack
npm install -g ./danteforge-0.17.0.tgz
```

Maintainer note: `npm run build` is intentionally side-effect free. Use `npm run sync:dantecode` or `npm run build:local-sync` only when you explicitly want to sync the sibling DanteCode environment.

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

For Codex, explicit setup syncs the workflow command markdown files into `~/.codex/commands`, keeps a small non-colliding set of CLI utility aliases in `~/.codex/config.toml`, and maintains a managed global bootstrap at `~/.codex/AGENTS.md`, so commands such as `/spark`, `/ember`, `/canvas`, `/magic`, `/blaze`, `/nova`, `/inferno`, `/local-harvest`, `/autoforge`, and `/party` stay native workflow commands instead of shell aliases in local Codex environments.

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

For the full standalone install matrix, assistant targets, and secret setup flow, see [docs/Standalone-Assistant-Setup.md](docs/Standalone-Assistant-Setup.md). For the machine-to-machine Codex contract specifically, see [docs/Codex-Install.md](docs/Codex-Install.md).

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

### Goose

Goose integration is available via extension-based commands. Run `danteforge setup assistants --assistants goose` to install DanteForge skills into `~/.goose/skills/`. This enables native slash commands like `/spark`, `/magic`, `/verify`, etc., directly in Goose conversations.

For advanced integration, the extension `extensions/danteforge.json` provides tool-based access to DanteForge commands.

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
- For Codex specifically, keep the repo-local `.codex/config.toml` and refresh `~/.codex/skills`, `~/.codex/config.toml`, `~/.codex/commands`, and `~/.codex/AGENTS.md` with `danteforge setup assistants --assistants codex` after upgrades on local Codex installs.
- In Codex, workflow slash commands are native and come from `commands/*.md` plus `~/.codex/commands/*.md`; use the CLI only when explicitly requested.
- Codex, Claude, Gemini/Antigravity, and OpenCode all receive the bundled `danteforge-cli` skill as a CLI fallback path for explicit terminal execution.
- Run `danteforge setup assistants --assistants cursor` to create the Cursor project bootstrap rule in `.cursor/rules/`.
- Secrets still live once in `~/.danteforge/config.yaml` even when different assistants invoke the CLI.
- [docs/Codex-Install.md](docs/Codex-Install.md) is the canonical cross-machine setup guide for local Codex installs.

## What Codex Can Do Today

- Local Codex environments can use synced `~/.codex/skills`, `~/.codex/commands`, `~/.codex/AGENTS.md`, and the repo-local `.codex/config.toml` for a native DanteForge workflow experience.
- Hosted Codex/chat surfaces may not honor user-level installs such as `~/.codex/commands` or `~/.codex/skills`; that is a platform limitation, not a DanteForge bug.
- When native Codex command files are unavailable, the bundled `danteforge-cli` skill is the explicit fallback path for terminal-style execution.
- If Codex does not feel native locally, verify `~/.codex/commands`, `~/.codex/skills`, `~/.codex/AGENTS.md`, and the current repo's `.codex/config.toml`, then rerun `danteforge setup assistants --assistants codex`.
- For install and validation on another machine, follow [docs/Codex-Install.md](docs/Codex-Install.md).

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

<!-- DANTEFORGE_REPO_PIPELINE:START -->
```text
review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship
```
<!-- DANTEFORGE_REPO_PIPELINE:END -->

Most users never run the pipeline manually â€” `danteforge go`, `danteforge magic`, and
`danteforge ascend` orchestrate it automatically. Expand below if you want step-by-step control.

<details>
<summary>Step-by-step pipeline commands (click to expand)</summary>

```bash
danteforge review
danteforge constitution
danteforge specify "Build a modern photo-sharing app with real-time feeds and social features"
danteforge clarify
danteforge tech-decide
danteforge plan
danteforge tasks
danteforge design "social feed, profile, upload flow"
danteforge forge 1 --parallel --profile quality
danteforge ux-refine --openpencil
danteforge verify
danteforge synthesize
danteforge retro
```

If the project has a frontend workflow:

```bash
danteforge ux-refine --openpencil
danteforge ux-refine --prompt --figma-url <your-figma-file-url>
danteforge forge 2 --figma --prompt --profile quality
danteforge party --worktree --isolation
danteforge autoforge "stabilize the release candidate" --dry-run
```

</details>

## Magic Levels

Usage rule:
- Frontend-heavy feature where design should drive implementation -> `/canvas`
- First-time new matrix dimension + fresh OSS discovery -> `/inferno`
- All follow-up PRD gap closing -> `/magic`

| Command | Intensity | Token Level | Combines (Best Of) | Primary Use Case |
| --- | --- | --- | --- | --- |
| `danteforge spark [goal]` | Planning | Zero | review + constitution + specify + clarify + tech-decide + plan + tasks | Every new idea or project start |
| `danteforge ember [goal]` | Light | Very Low | Budget magic + light checkpoints + basic loop detect | Quick features, prototyping, token-conscious work |
| `danteforge canvas [goal]` | Design-First | Low-Medium | design + autoforge + ux-refine + verify | Frontend-heavy features where visual design drives implementation |
| `danteforge magic [goal]` | Balanced (Default) | Low-Medium | Balanced party lanes + autoforge reliability + verify + lessons | Daily main command - 80% of all work |
| `danteforge blaze [goal]` | High | High | Full party + strong autoforge + synthesize + retro + self-improve | Big features needing real power |
| `danteforge nova [goal]` | Very High | High-Max | Planning prefix + blaze execution + inferno polish (no OSS) | Feature sprints that need planning + deep execution without OSS overhead |
| `danteforge inferno [goal]` | Maximum | Maximum | Full party + max autoforge + deep OSS mining + evolution | First big attack on new matrix dimension |

Full operator guidance lives in [.danteforge/MAGIC-LEVELS.md](.danteforge/MAGIC-LEVELS.md).

## Quality Standards

DanteForge scores your code across **8 quality dimensions** and assigns it a **maturity level (1-6)** that represents real-world readiness:

| Level | Name | Score | Use Case |
| --- | --- | --- | --- |
| 1 | Sketch | 0-20 | Demo to co-founder |
| 2 | Prototype | 21-40 | Show investors |
| 3 | Alpha | 41-60 | Internal team use |
| 4 | Beta | 61-75 | Paid beta customers |
| 5 | Customer-Ready | 76-88 | Production launch |
| 6 | Enterprise-Grade | 89-100 | Fortune 500 contracts |

Each magic preset targets a specific maturity level. The **convergence loop** uses this target to prevent "premature done" â€” if your code doesn't meet the quality standard, it triggers **focused remediation** (3 autoforge waves) to close critical gaps.

### Example Maturity Check

```bash
danteforge maturity --preset magic
```

Output:
```
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  DanteForge Maturity Assessment
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

Current Level: Alpha (3/6)
Target Level:  Beta (4/6)
Overall Score: 58/100
Use Case:      Internal team use

Quality Dimensions:
  âœ… Functionality        75/100
  âœ… Testing              82/100
  âš ï¸  Error Handling      65/100
  âš ï¸  Security            70/100
  âš ï¸  UX Polish           60/100
  âŒ Documentation        55/100
  âš ï¸  Performance         70/100
  âš ï¸  Maintainability     68/100

Major Gaps (1):
  - Documentation: 55/100 (need 70+)
    â†’ Improve clarity and update stale documentation

Next Steps:
  1. Improve clarity and update stale documentation

Recommendation: âš ï¸  Refine â€” address gaps before shipping
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
```

### The 8 Quality Dimensions

1. **Functionality** (20% weight) â€” PDSE completeness + integration fitness
2. **Testing** (15% weight) â€” Coverage, test files, E2E tests
3. **Error Handling** (10% weight) â€” Try/catch, custom errors, ratio to functions
4. **Security** (15% weight) â€” Secrets management, npm audit, dangerous patterns
5. **UX Polish** (10% weight) â€” Loading states, accessibility, responsive design (web only)
6. **Documentation** (10% weight) â€” PDSE clarity + freshness
7. **Performance** (10% weight) â€” Nested loops, O(nÂ²) patterns, profiling
8. **Maintainability** (10% weight) â€” PDSE testability + constitution + function size

See [docs/MATURITY-SYSTEM.md](docs/MATURITY-SYSTEM.md) for detailed explanations of each level, the reflection gate, and how to improve your scores.

## Command Reference

| Command | Description |
| --- | --- |
| `danteforge init` | Interactive first-run wizard â€” detect project, check health, show next steps |
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
| `danteforge canvas [goal]` | Design-first frontend preset for visual-first execution |
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
| `danteforge nova [goal]` | Run the very-high-power preset with planning prefix and deep execution |
| `danteforge inferno [goal]` | Run the maximum-power preset with OSS discovery and evolution |
| `danteforge setup figma` | Configure Figma MCP integration |
| `danteforge update-mcp` | Check and apply MCP metadata updates |
| `danteforge tech-decide` | Generate tech-stack guidance |
| `danteforge lessons` | Capture and compact persistent lessons |
| `danteforge maturity` | Analyze code maturity level across 8 quality dimensions (1-6 scale) |
| `danteforge local-harvest [paths...]` | Harvest patterns from local private repos, folders, and zip archives |
| `danteforge autoresearch <goal>` | Autonomous metric-driven optimization loop |
| `danteforge oss` | Autonomous OSS pattern harvesting with license gates |
| `danteforge harvest <system>` | Titan Harvest V2 â€” constitutional pattern harvesting |
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

## Community & Support

### Getting Help
- `danteforge help` - General help
- `danteforge help <command>` - Help for specific commands
- [Documentation](docs/) - Complete guides and API reference
- [GitHub Issues](https://github.com/dantericardo88/danteforge/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/dantericardo88/danteforge/discussions) - Q&A and community support

### Contributing
We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

**Quick contribution start:**
```bash
git clone https://github.com/dantericardo88/danteforge
cd danteforge
npm ci
npm run verify  # Run tests and typecheck
```

### License & Security
- **License**: MIT
- **Security**: See [SECURITY.md](SECURITY.md) for vulnerability reporting
- **Enterprise**: SOC 2 Type II compliant with premium features


