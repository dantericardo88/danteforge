# DanteForge v0.6.0 Operational Readiness

This document reflects the shipped state of DanteForge `0.6.0` at the time of that release, not the historical PRD snapshots.

## Current Status

The CLI and VS Code extension are in release-ready shape for offline and fail-closed operation:

- Workflow enforcement is active.
- Persistent memory and context injection are live in runtime LLM paths.
- Party mode supports isolated review with `--isolation`.
- OpenPencil tools auto-load and persist `.danteforge/DESIGN.op`.
- Design rules support project overrides via `.danteforge/design-rules.yaml`.
- AutoForge supports `autoforge [goal]`.
- Root package, extension package, generated artifact stamps, and assistant hook metadata are aligned to `0.6.0`.

## Verified Gates

The following have been exercised successfully:

- `npm run verify`
- `npm run build`
- `npm run verify:all`
- `npm --prefix vscode-extension run build`
- `npm run check:repo-hygiene`
- `npm run check:third-party-notices`
- `npm run check:cli-smoke`
- `node dist/index.js --help`
- `node dist/index.js autoforge --dry-run`
- `node dist/index.js awesome-scan`

## Operator Commands

Release-oriented commands:

- `npm run release:check`
- `npm run release:check:strict`
- `npm run release:check:simulated-fresh`
- `npm run release:ga`

Useful operator smoke paths:

- `danteforge party --help`
- `danteforge party --isolation`
- `danteforge autoforge "stabilize the release candidate" --dry-run`
- `danteforge awesome-scan`

## Known Outstanding Work

These items are not blockers for `0.6.0`, but they are the next highest-value follow-ups:

1. Live-provider canary validation with real credentials.
   The workflow now exists at `.github/workflows/live-canary.yml`, but it still needs real repository secrets and variables to execute against OpenAI/Claude/Gemini/Grok/Ollama environments.

2. Live Figma MCP canary coverage.
   Local OpenPencil flows are covered. The live canary workflow can exercise a real Figma MCP endpoint once `FIGMA_MCP_URL` is configured.

3. Historical PRD cleanup.
   Historical docs intentionally still reference `0.5.0`, especially the OpenPencil PRD snapshots. They are accurate as history, but they are not current-state operator docs.

4. Current-state public docs expansion.
   If maintainer onboarding becomes a priority, the next doc to add should be a concise "how DanteForge actually works in v0.6.0" guide for operators and contributors.

## Recommended Next Step

If the goal is to harden toward GA rather than add new features, the next pass should focus on a secret-backed canary workflow:

1. Run `npm run verify:live` in CI with real provider credentials.
2. Exercise a real Figma MCP endpoint through `.github/workflows/live-canary.yml`.
3. Capture the first successful and failing canary runs in a maintainer-facing runbook.
