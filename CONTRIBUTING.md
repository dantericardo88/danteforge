# Contributing

## Local Setup

```bash
npm ci
npm run verify:all
```

If you change the VS Code extension:

```bash
npm --prefix vscode-extension ci
npm --prefix vscode-extension run verify
npm --prefix vscode-extension run package:vsix
```

## Quality Gates

- `npm run verify` (fail-closed): `typecheck + lint + tests`
- `npm run verify:all`: root verify + CLI build + VS Code extension verification
- `npm run check:repo-hygiene`: fails if generated/vendor paths are tracked by git
- `npm run check:repo-hygiene:strict`: also fails if generated/vendor paths merely exist in the checkout (use in fresh CI clones)
- `npm run check:third-party-notices`: fails if `THIRD_PARTY_NOTICES.md` still has TODO placeholders
- `npm run release:check:simulated-fresh`: copies the repo to a temp directory and runs the fresh-checkout release flow there

## Repo Hygiene

Do not commit generated or vendor directories:

- `node_modules/`
- `dist/`
- `coverage/`
- `.danteforge/`
- `vscode-extension/node_modules/`
- `vscode-extension/dist/`

## Agent Instructions

- `AGENTS.md` is the canonical repo instruction file for coding agents (Codex, Claude Code, etc.)
- `CLAUDE.md` provides Claude-oriented context/adapter notes
- `.codex/config.toml` defines the current Codex workflow, verification, and release aliases
- Assistant setup is explicit: run `danteforge setup assistants` after install when you want local Codex/Claude/Gemini/OpenCode integration, and `danteforge setup assistants --assistants cursor` for project-local Cursor files

## Release Checklist (Minimum)

1. `npm run check:repo-hygiene:strict` in a fresh checkout
2. `npm run verify:all`
3. `npm run pack:dry-run` and inspect package contents
4. `npm run check:third-party-notices`
5. Complete `THIRD_PARTY_NOTICES.md` if the check fails (required before public release)

See `RELEASE.md` for the full publish sequence and GitHub Actions automation.
