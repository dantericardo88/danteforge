# DanteForge v0.7.0 Operational Readiness

This document reflects the current shipped state of DanteForge `0.7.0`, not the historical PRD snapshots.

## Current Status

The CLI and VS Code extension are in GA hardening for offline and fail-closed operation:

- Workflow enforcement is active across the core planning and execution pipeline.
- PDSE scoring and completion tracking are present in source and exercised by tests.
- Browser automation, structured QA, retrospectives, and paranoid ship planning are shipped commands.
- AutoForge supports goal-driven orchestration with deterministic guidance output.
- Repo verification now includes an explicit anti-stub gate for shipped implementation paths.
- Root package, extension package, generated artifact stamps, and harvested-skill manifests are aligned to `0.7.0`.

## Verified Gates

The following are the current release-facing gates:

- `npm run verify`
- `npm run verify:all`
- `npm run check:anti-stub`
- `npm run build`
- `npm --prefix vscode-extension run build`
- `npm run check:repo-hygiene`
- `npm run check:third-party-notices`
- `npm run check:cli-smoke`
- `npm run release:check`
- `npm run release:check:strict`
- `danteforge verify --release`

## Operator Commands

Quality and release commands now surfaced for operators:

- `danteforge browse`
- `danteforge qa --url <url>`
- `danteforge retro`
- `danteforge ship`
- `danteforge verify --release`

## Anti-Stub Doctrine

The `0.7.0` release surface is fail-closed against placeholder implementation markers:

- `npm run check:anti-stub` scans shipped implementation paths.
- `npm run verify` includes that anti-stub scan by default.
- PDSE Clarity scoring still floors artifact quality when stub markers appear in workflow artifacts.

## Known Outstanding Work

These items remain the final release-hardening checks and follow-ups for `0.7.0`:

1. Secret-backed live canary validation with real provider credentials and Figma MCP access.
2. Final GA confirmation that the release gates continue to pass in CI, not just local and simulated-fresh environments.
3. Publish the package to the intended npm or private registry if registry install is part of the GA promise.
4. Ongoing test suite expansion beyond the current release coverage footprint.

## Recommended Next Step

If the goal is GA hardening rather than net-new features:

1. Run `npm run release:check:strict`.
2. Run `danteforge verify --release`.
3. Run `npm audit` and `npm --prefix vscode-extension audit`.
4. Run `npm run verify:live` in CI with real credentials.
