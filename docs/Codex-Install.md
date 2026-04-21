# Codex Install

This is the canonical DanteForge install path for local Codex environments and for setting up local Codex on other machines.

## Supported Contract

A local Codex install is considered healthy when all four surfaces are present:

1. Native workflow commands: `~/.codex/commands/*.md`
2. CLI fallback skill: `~/.codex/skills/danteforge-cli/SKILL.md`
3. Global Codex bootstrap: `~/.codex/AGENTS.md`
4. Non-colliding utility aliases: `~/.codex/config.toml`

The current repo can also add project-local Codex aliases in `.codex/config.toml` without hijacking native workflow slash commands.

## Install Paths

### 1. npm install

```bash
npm install -g danteforge
danteforge setup assistants --assistants codex
```

### 2. Tarball install

```bash
npm pack
npm install -g ./danteforge-0.17.0.tgz
danteforge setup assistants --assistants codex
```

### 3. Source install

```bash
git clone https://github.com/dantericardo88/danteforge.git
cd danteforge
npm ci
npm run verify:all
npm link
danteforge setup assistants --assistants codex
```

## What Setup Installs

`danteforge setup assistants --assistants codex` refreshes:

- `~/.codex/commands` for native workflow slash commands such as `/spark`, `/magic`, `/autoforge`, `/party`, and `/verify`
- `~/.codex/skills` for the bundled DanteForge skills, including `danteforge-cli`
- `~/.codex/AGENTS.md` for a managed Codex-wide DanteForge bootstrap
- `~/.codex/config.toml` for non-colliding utility aliases such as `setup-assistants`, `doctor-live`, and `df-verify`

It does not replace native workflow slash commands with shell aliases.

## Validation

Run:

```bash
danteforge doctor
```

Healthy Codex output should confirm:

- `Codex bootstrap`
- `Codex native commands`
- `Codex CLI fallback`
- `Codex utility aliases`

You can also validate the exact files directly:

```bash
dir ~/.codex/commands
dir ~/.codex/skills/danteforge-cli
type ~/.codex/AGENTS.md
type ~/.codex/config.toml
```

On Unix-like systems, use:

```bash
ls ~/.codex/commands
ls ~/.codex/skills/danteforge-cli
cat ~/.codex/AGENTS.md
cat ~/.codex/config.toml
```

## Native vs CLI Fallback

Use native slash commands in local Codex when `~/.codex/commands` is available.

Use the bundled `danteforge-cli` skill or direct terminal execution when:

- the user explicitly wants terminal/CLI execution
- you are validating CLI behavior
- native command files are unavailable in the host

## Other Machines

For another Codex machine, the shortest reliable path is:

1. Install DanteForge with npm, tarball, or source.
2. Run `danteforge setup assistants --assistants codex`.
3. Run `danteforge doctor`.
4. Configure shared secrets with `danteforge config`.
5. Run `danteforge doctor --live` when you want live provider validation.

If you are setting up a machine for release validation, also run:

```bash
npm run release:check:install-smoke
```

## Hosted Codex Limits

Hosted Codex/chat surfaces may not honor `~/.codex/commands`, `~/.codex/skills`, or `~/.codex/AGENTS.md`, so DanteForge does not treat those hosts as guaranteed-native Codex installs.

When that happens:

- treat it as a host limitation, not a DanteForge install failure
- use repo `AGENTS.md` plus explicit CLI execution
- fall back to the bundled `danteforge-cli` skill where the host supports skills but not native command files

## Related Docs

- `docs/Standalone-Assistant-Setup.md`
- `README.md`
- `RELEASE.md`
