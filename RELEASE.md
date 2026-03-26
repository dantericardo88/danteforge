# Release Guide

This project ships a Node CLI package (`danteforge` / `dforge`) and a first-class VS Code extension client.

Current operator status and non-blocking follow-ups are tracked in [docs/Operational-Readiness-v0.9.2.md](docs/Operational-Readiness-v0.9.2.md). Archived readiness guides and older planning context are indexed in [docs/Release-History.md](docs/Release-History.md).

## Prerequisites

- npm publish access for the `danteforge` package
- `NPM_TOKEN` configured in GitHub Actions (for automated publish)
- `VSCE_PAT` configured in GitHub Actions if you want automated VS Code Marketplace publish
- `OVSX_PAT` configured in GitHub Actions if you want automated Open VSX publish
- Ability to stage an isolated sandbox copy for strict hygiene verification

## Local Release (Manual)

1. Install dependencies

```bash
npm ci
npm --prefix vscode-extension ci
```

2. Run the strict staged release gate

```bash
npm run release:check:strict
```

3. Run the local maintainer release checks and proof gates

```bash
npm run check:anti-stub
danteforge verify --release
npm run release:proof
npm run verify:live
npm run release:ga
```

Notes:
- `check:anti-stub` fails fast if shipped implementation files still contain `TODO`, `FIXME`, `TBD`, or placeholder/stub markers.
- `check:plugin-manifests` verifies the packaged `.claude-plugin/` manifests stay aligned with the npm package metadata.
- `release:check:install-smoke` packs the CLI, installs it into a temp project, and proves the installed binary can run a real command.
- `check:cli-smoke` runs operator-facing checks against the built CLI, including `--help`, `party --help`, `autoforge --dry-run`, and `awesome-scan`.
- The install smoke gate verifies that package installation is non-mutating for assistant registries, then proves that explicit assistant setup can populate the Claude, Codex, Gemini/Antigravity, and OpenCode registries and generate the Cursor bootstrap rule.
- Standalone assistant install and secret setup details are documented in `docs/Standalone-Assistant-Setup.md`.
- `release:check` includes tracked-path hygiene, root verification, CLI build, VS Code extension verification, plugin manifest validation, packed CLI install smoke verification, package dry-run, and third-party notices validation.
- `release:proof` is the CI-facing ship authority. It starts with `check:repo-hygiene:strict`, then runs `release:check`, `npm audit --omit=dev`, `npm --prefix vscode-extension audit`, packages the VS Code extension, and writes `.danteforge/evidence/release/latest.json` plus `.md` with packaged npm metadata, artifact hashes, and publish-provenance summary details.
- `release:check:strict` stages an isolated temp sandbox copy, runs the strict presence gate there, then executes the strict release chain with isolated home/config state.
- `release:check:simulated-fresh` creates an isolated temp sandbox copy of the repo, runs the strict hygiene gate before installs, then runs the normal release gate there.
- `verify:live` runs real provider prompt checks plus live upstream and Figma endpoint checks, then writes `.danteforge/evidence/live/latest.json` plus `.md`.
- `danteforge verify --release` exposes the project-state release gate from the CLI surface and remains a useful maintainer-local check, but it is not the CI publish authority.
- `release:ga` runs the release proof gate followed by `verify:live`.

Live verification environment:
- `DANTEFORGE_LIVE_PROVIDERS=openai,claude,gemini,grok,ollama`
- `OPENAI_API_KEY` for OpenAI checks
- `ANTHROPIC_API_KEY` for Claude checks
- `GEMINI_API_KEY` for Gemini checks
- `XAI_API_KEY` for Grok checks
- `OLLAMA_MODEL` for Ollama checks. Prefer an exact installed tag such as `qwen2.5-coder:latest`.
- `OLLAMA_BASE_URL` if Ollama is not running on `http://127.0.0.1:11434`
- `DANTEFORGE_LIVE_TIMEOUT_MS` to raise live-check timeouts for all providers
- `OLLAMA_TIMEOUT_MS` to raise timeouts for slower local Ollama models
- `ANTIGRAVITY_BUNDLES_URL` only if you need a non-default upstream bundle manifest
- `FIGMA_MCP_URL` only if you need a non-default Figma MCP endpoint

GitHub Actions live canary:
- `.github/workflows/live-canary.yml` runs `npm run build`, `npm run check:cli-smoke`, `npm run verify:live`, and uploads the live receipt artifact.
- Configure `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY` as repository secrets as needed.
- Configure `DANTEFORGE_LIVE_PROVIDERS`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, `DANTEFORGE_LIVE_TIMEOUT_MS`, `OLLAMA_TIMEOUT_MS`, `ANTIGRAVITY_BUNDLES_URL`, and `FIGMA_MCP_URL` as repository variables when needed.

GA checklist:

1. `npm run verify`
2. `npm run verify:all`
3. `npm run check:cli-smoke`
4. `npm run release:proof`
5. `npm run release:check:strict`
6. `npm run release:check:simulated-fresh`
7. `npm audit --omit=dev`
8. `npm --prefix vscode-extension audit`
9. successful `npm run verify:live` canary

4. Package the VS Code extension

```bash
npm --prefix vscode-extension run package:vsix
```

This produces `vscode-extension/.artifacts/danteforge.vsix`.

If you publish extensions manually:

```bash
npm --prefix vscode-extension run publish:vsce
npm --prefix vscode-extension run publish:ovsx
```

5. Bump version

```bash
npm version patch   # or minor / major
```

6. Publish

```bash
npm publish
```

7. Push commit + tag

```bash
git push origin main --follow-tags
```

## Automated Release (GitHub Actions)

- Push a tag like `v0.9.2` to trigger `.github/workflows/release.yml`
- Or run the workflow manually via `workflow_dispatch`
- Use `.github/workflows/live-canary.yml` for scheduled or manual secret-backed live verification outside the publish path

The workflow will:

1. Run `release-proof` to execute `npm run release:proof`, write `.danteforge/evidence/release/latest.json`, and upload the release receipt plus the `.vsix`
2. Run `live-proof` to execute `npm run verify:live` and upload `.danteforge/evidence/live/latest.json`
3. Block publish unless both proof jobs pass
4. Publish to npm (requires `NPM_TOKEN`)
5. Publish the VS Code extension to VS Code Marketplace when `VSCE_PAT` is available
6. Publish the VS Code extension to Open VSX when `OVSX_PAT` is available

## Extension Notes

- The VS Code extension is verified as part of `npm run verify:all` and `npm run release:check`.
- If extension packaging or marketplace publishing is added later, extend this guide and the release workflow so the CLI and extension remain aligned.

## Packaging Notes

- Published package contents are controlled by `package.json` `files`
- Verify package contents before release:

```bash
npm run pack:dry-run
```
