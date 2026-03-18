# DanteForge v0.8.0 Operational Readiness

This document reflects the current shipped state of DanteForge `0.8.0`.

## New in v0.8.0

### Commands
- `danteforge init` — Interactive first-run wizard with project detection and health checks
- `danteforge docs` — Auto-generated command reference documentation
- `danteforge autoresearch <goal>` — Autonomous metric-driven optimization loop (Karpathy-inspired)
- `danteforge oss` — Autonomous OSS pattern harvesting with license gates
- `danteforge harvest <system>` — Titan Harvest V2 constitutional pattern harvesting

### Infrastructure
- Version auto-sync via tsup `define` — CLI version reads from package.json at build time
- `--recompute` flag on verify command — force re-detection of project type
- Autoforge always re-detects project type (fixes stale PDSE scores)
- Safe self-edit protocol — protected-path gate with NDJSON audit log
- Party mode lessons injection — agent prompts include self-improving lessons
- Party mode PDSE quality scoring — agent outputs scored on completion
- Meta-evolution trigger — every 5 harvest tracks prompts framework self-improvement

### Onboarding
- Grouped --help output with command categories (Pipeline, Automation, Design, Intelligence, Tools, Meta)
- First-run detection — suggests `danteforge init` when no .danteforge/ directory exists
- Tiered help engine — beginner guidance when at initialized workflow stage
- Context-aware help for all 38 commands

### Documentation
- docs/ARCHITECTURE.md — System architecture reference
- docs/COMMAND_REFERENCE.md — Auto-generated command reference (38 commands)
- "Who This Is For" positioning section in README

## Version Alignment

Root package, VS Code extension, plugin manifests, generated artifact stamps, and harvested-skill manifests are aligned to `0.8.0`.

Version is auto-synced: tsup injects `process.env.DANTEFORGE_VERSION` from package.json at build time.

## Verification Surface

- 790+ tests (node:test with tsx), 0 failures
- TypeScript strict mode, ES2022 target
- ESLint clean
- Anti-stub scan clean (no TODO/FIXME/TBD in shipped implementation)
- tsup build produces single ESM bundle (dist/index.js)
- Release gates: repo hygiene, CLI smoke, plugin manifests, install smoke, dry-run pack, third-party notices

## Known Outstanding Work

- Live canary tests with secret-backed providers (CI workflow exists but requires secrets); run `npm run verify:live` when secrets are configured
- TypeDoc or JSDoc auto-generation for API reference
- Architecture Decision Records (ADRs) for historical design choices
