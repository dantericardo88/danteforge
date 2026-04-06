# Standalone Assistant Setup

This guide describes the supported standalone DanteForge install surface for local terminals and assistant hosts.

## Core Principle

DanteForge runs as a standalone CLI. Assistant integrations only bootstrap instructions and discovery paths around that CLI.

When a host tool supports native DanteForge workflow commands, those native workflows keep using the host model/session. Direct DanteForge CLI execution uses DanteForge's own shared config and should prefer a local Ollama model first when you want to minimize spend.

Assistant setup is explicit. Installing the package does not modify user-level assistant registries or project-local Cursor files until you run `danteforge setup assistants`.

Secrets are configured once with `danteforge config` and stored in the shared user-level file:

```text
~/.danteforge/config.yaml
```

That means the same configured providers are available when DanteForge is invoked from:

- Codex
- Claude Code
- Gemini / Antigravity
- OpenCode
- Cursor
- a raw terminal session

## Supported Assistant Targets

| Target | Install Mode | DanteForge Path |
| --- | --- | --- |
| Claude Code | global skill registry | `~/.claude/skills` |
| Codex | global skill registry + non-colliding CLI utility aliases + global command files + global Codex bootstrap + project bootstrap | `~/.codex/skills`, `~/.codex/config.toml`, `~/.codex/commands`, `~/.codex/AGENTS.md`, `.codex/config.toml` |
| Gemini / Antigravity | global skill registry | `~/.gemini/antigravity/skills` |
| OpenCode | global skill registry | `~/.config/opencode/skills` |
| Cursor | project bootstrap rule | `.cursor/rules/danteforge.mdc` |

Cursor is intentionally different: it uses a project-local bootstrap rule instead of a user-level skill registry.

## Install Flow

### 1. Install the CLI

From npm, once the package is published to your registry:

```bash
npm install -g danteforge
```

From a packaged tarball before public npm publish:

```bash
npm pack
npm install -g ./danteforge-0.9.2.tgz
```

From source:

```bash
git clone https://github.com/danteforge/danteforge.git
cd danteforge
npm ci
npm run verify:all
npm link
```

### 2. Sync assistant targets

Install or repair the default user-level assistant registries:

```bash
danteforge setup assistants
```

Cursor is intentionally explicit and project-local:

```bash
danteforge setup assistants --assistants cursor
```

Install only one or two targets:

```bash
danteforge setup assistants --assistants claude,codex
danteforge setup assistants --assistants gemini
danteforge setup assistants --assistants opencode
danteforge setup assistants --assistants cursor
```

For Codex specifically, `danteforge setup assistants --assistants codex` refreshes `~/.codex/skills`, the non-colliding DanteForge CLI utility aliases in `~/.codex/config.toml`, the standalone command files in `~/.codex/commands`, and a managed global bootstrap in `~/.codex/AGENTS.md`. Keep the repo-local `.codex/config.toml` file current as well when a project ships one, because this repo bootstrap still carries the latest project-scoped install, verification, anti-stub, and release aliases.

The bundled registries also include the `danteforge-cli` skill. That skill is now the explicit CLI path when the user asks for terminal execution or when native workflow command files are unavailable.

Accepted aliases:

- `gemini` and `gemini-3.1` map to the Gemini / Antigravity registry
- `claude-code` maps to `claude`
- `open-code` maps to `opencode`
- `all` installs every supported target, including the project-local Cursor bootstrap rule

### 3. Configure spend-optimized local execution first

Recommended local-first path:

```bash
danteforge setup ollama --pull
```

If you are already syncing assistants, you can combine setup plus local-model provisioning:

```bash
danteforge setup assistants --pull
```

That keeps native Codex / Claude Code / Cursor workflows on the host model while steering direct DanteForge CLI execution toward a cheaper local Ollama model.

### 4. Configure hosted fallback providers only when you want them

Set whichever hosted providers you actually intend to use:

```bash
danteforge config --set-key "openai:sk-..."
danteforge config --set-key "claude:sk-ant-..."
danteforge config --set-key "gemini:AIza..."
danteforge config --set-key "grok:xai-..."
```

Optional manual local-provider flow:

```bash
danteforge config --provider ollama
danteforge config --model "ollama:qwen2.5-coder"
```

### 5. Validate the local install

Repair local state and user-level assistant paths:

```bash
danteforge doctor --fix
```

Validate a live, secret-backed environment:

```bash
danteforge doctor --live
```

## Provider Secret Reference

Standalone live validation and CI canaries use these environment variables:

- `DANTEFORGE_LIVE_PROVIDERS=openai,claude,gemini,grok,ollama`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `XAI_API_KEY`
- `OLLAMA_MODEL` with the exact installed tag when possible
- `OLLAMA_BASE_URL` optional, defaults to `http://127.0.0.1:11434`
- `DANTEFORGE_LIVE_TIMEOUT_MS` optional global live-check timeout override
- `OLLAMA_TIMEOUT_MS` optional timeout override for slower local Ollama models
- `ANTIGRAVITY_BUNDLES_URL` optional upstream override
- `FIGMA_MCP_URL` optional Figma MCP override

These environment variables are for live verification and CI workflows. Normal CLI execution uses the user-level `~/.danteforge/config.yaml` file.

## Cursor Notes

Cursor support is project-local:

1. Run `danteforge setup assistants --assistants cursor`
2. Confirm `.cursor/rules/danteforge.mdc` exists
3. If you need Figma MCP in Cursor, run `danteforge setup figma`

The Cursor bootstrap rule points the assistant back to `AGENTS.md`, the DanteForge workflow, and the release verification commands.

## Codex Notes

Codex uses a user-level skill registry, a user-level DanteForge workflow bootstrap, and repo-local command aliases:

1. Run `danteforge setup assistants --assistants codex` to refresh `~/.codex/skills`, refresh the non-colliding CLI utility aliases in `~/.codex/config.toml`, sync `~/.codex/commands`, and update `~/.codex/AGENTS.md`
2. Keep `.codex/config.toml` from the repo root in place when the current project ships one, because it can add project-specific install, verification, anti-stub, and release aliases without hijacking native workflow slash commands
3. Confirm `~/.codex/commands/autoforge.md` exists if you want `/autoforge` and the other workflow slash commands to run natively in Codex
4. Confirm `~/.codex/skills/danteforge-cli/SKILL.md` exists if you want an explicit CLI fallback path for terminal-style DanteForge execution
5. Confirm `~/.codex/AGENTS.md` exists if you want Codex-wide DanteForge bootstrap instructions even outside DanteForge repos
6. Use the Codex aliases for the current DanteForge release surface:
   `verify-all`, `anti-stub`, `release-check`, `release-strict`, `verify-release`, and `doctor-live`

Local Codex can honor these synced files and feels closest to the intended DanteForge experience.

Hosted Codex surfaces may not honor `~/.codex/commands`, `~/.codex/skills`, or `~/.codex/AGENTS.md`. When that happens, treat it as a host limitation and fall back to repo instructions plus CLI execution.

Codex troubleshooting path:

1. Confirm `~/.codex/commands` contains workflow files such as `autoforge.md`
2. Confirm `~/.codex/skills` contains `danteforge-cli` and the packaged skills you expect
3. Confirm `~/.codex/AGENTS.md` contains the DanteForge bootstrap block
4. Confirm the current project still ships the intended `.codex/config.toml`

## Recommended Battle-Tested Baseline

For a fully provisioned standalone machine:

```bash
danteforge setup assistants
danteforge setup ollama --pull
danteforge config --set-key "openai:sk-..."
danteforge doctor --fix
danteforge doctor --live
```

Then validate the shipped surface:

```bash
npm run check:anti-stub
npm run check:cli-smoke
npm run release:check
```

## What Is Still Outstanding

The standalone install surface is complete for local use. What remains is environment-level, not code-level:

1. Publish the package to the intended npm or private registry if you want `npm install -g danteforge` to be the primary install path
2. Populate real CI secrets for `.github/workflows/live-canary.yml`
3. Run the first successful secret-backed canary
4. Decide whether live canary success should be a hard gate for GA publish
