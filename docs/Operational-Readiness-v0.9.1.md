> **ARCHIVED** — This document reflects the 0.9.1 release. For the current release surface see [Operational-Readiness-v0.9.2.md](Operational-Readiness-v0.9.2.md). Do not treat this file as current release truth.

# DanteForge v0.9.1 Operational Readiness

This document reflects the shipped state of DanteForge `0.9.1` (Swarm Edition).

## New in v0.9.1

### Wave 1 - Token Routing
- `task-router.ts` - 3-tier local/light/heavy routing per task (local=0 tokens, light=Haiku, heavy=Sonnet)
- `local-transforms.ts` - 9 regex/AST transforms applied before any LLM call
- `context-compressor.ts` - 6-strategy pipeline (whitespace, comments, imports, code blocks, test bodies, hard cap)

### Wave 2 - Parallel Engine
- `headless-spawner.ts` - CLI pipe-mode parallel agent spawning with `_spawnFn` injection seam
- `agent-dag.ts` - Kahn's topological sort DAG for dependency-aware parallel agent scheduling

### Wave 3 - Budget Controls
- `complexity-classifier.ts` - weighted scoring -> preset mapping (spark/ember/magic/blaze/inferno)
- `cost.ts` command - session token/cost reporting
- `execution-telemetry.ts` - BudgetFence (warn at 80%, block at 100%) + TokenReport

### Wave 4 - MCP Server
- `mcp-server.ts` - 15 tools exposed via `@modelcontextprotocol/sdk`
- `mcp-server.ts` command - start the MCP server

### v0.9.1 Hardening Passes 1-10
- Circuit breaker (`circuit-breaker.ts`) - 3-state CLOSED/OPEN/HALF_OPEN per-provider
- LLM pipeline decomposition (`llm-pipeline.ts`) - 6-stage orchestrator replacing 130-line god function
- Error hierarchy (`errors.ts`) - DanteError / LLMError / BudgetError
- State cache (`state-cache.ts`) - TTL-based in-memory cache for `persistAudit`
- Verify receipt spine - `.danteforge/evidence/verify/latest.json` emitted on every verify run
- Safe-self-edit enforcement - fail-closed `deny` policy by default for protected paths
- Receipt-based completion tracking - `testsPassing` driven by `lastVerifyStatus === 'pass'`
- Public build isolation - default `npm run build` is public-safe; workstation sync remains opt-in via `npm run build:dev-sync`
- Version truth hardening - README, release docs, tarball examples, manifests, and lockfiles align on `0.9.1`

## Version Alignment

Root package, VS Code extension, plugin manifests, generated artifact stamps, release docs, and lockfiles are aligned to `0.9.1`.

Version is auto-synced: tsup injects `process.env.DANTEFORGE_VERSION` from package.json at build time.

## Verification Surface

- 2038+ tests (node:test with tsx), 0 failures
- 79.26% line coverage / 80.23% branch coverage / 85.86% function coverage (c8)
- TypeScript strict mode, ES2022 target
- ESLint clean
- Anti-stub scan clean (no TODO/FIXME/TBD in shipped implementation)
- tsup build produces single ESM bundle (dist/index.js)
- Release gates: repo hygiene, CLI smoke, plugin manifests, install smoke, dry-run pack, third-party notices
- Verify receipts: durable JSON + Markdown artifacts at `.danteforge/evidence/verify/`

## Preset Commands

| Preset | Budget | Waves | Party | Use case |
|--------|--------|-------|-------|----------|
| `spark` | $0.05 | planning only | No | New project start |
| `ember` | $0.15 | 3 | No | Quick fixes |
| `magic` | $0.50 | 8 | No | Default daily work |
| `blaze` | $1.50 | 10 | Yes | Feature pushes |
| `inferno` | $5.00 | 12 | Yes | Deep OSS + synthesis |

## Remaining External Release Work

1. Run `npm run verify:live` in the target live environment with an exact configured provider or installed Ollama tag.
2. Publish the package to the intended npm or private registry if registry install is part of the GA promise.
3. Golden path E2E tests on clean Windows/macOS/Linux machines (CI matrix - deferred to next sprint).

## Known Outstanding Work

- Golden path E2E tests on clean machines (CI matrix: Windows/macOS/Linux)
- VS Code extension status panel (project health surface)
- Cross-platform CI matrix in GitHub Actions
- Live canary tests with secret-backed providers (CI workflow exists but requires secrets)
