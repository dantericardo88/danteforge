# DanteForge v0.15.0 Operational Readiness

This document reflects the current shipped state of DanteForge `v0.15.0` (Evidence Ready Edition).

Historical readiness guides and planning snapshots are indexed in [Release-History.md](Release-History.md).

## New in v0.15.0

### Wave 1 — upstreamArtifacts Bug Fix
- `src/core/proof-engine.ts` — `runProof()` now passes the full artifact map as `upstreamArtifacts` instead of `{}`
- Integration fitness scoring now correctly rewards multi-artifact projects (5-15 point increase for full pipelines)

### Wave 2 — Semantic PDSE Scoring
- `src/core/pdse-semantic.ts` — opt-in LLM semantic layer for PDSE scoring
- Blending formula: `0.4 × regexScore + 0.6 × semanticScore`
- Graceful degradation: falls back to pure regex when LLM unavailable
- `danteforge proof --semantic` activates semantic scoring
- `scoreAllArtifacts()` accepts `semanticOpts` for drop-in enhancement

### Wave 3 — Git Workflow Integration
- `src/core/git-integration.ts` — `generateCommitMessage`, `generateBranchName`, `generatePRBody`, `stageAndCommit`, `createTaskBranch`, `openPullRequest`
- `danteforge commit` — stages changed files, commits with task-derived conventional commit message
- `danteforge branch` — creates `danteforge/{project}/{phase}-{task-slug}` branch
- `danteforge pr` — generates PR body from SPEC.md + PLAN.md, calls `gh pr create`

### Wave 4 — Live IDE Sync
- `src/core/autoforge-loop.ts` — auto-syncs Cursor context after each wave when `.cursor/` exists
- `vscode-extension/src/runtime.ts` — replaced 5s polling with FileSystemWatcher on STATE.yaml and latest-pdse.json
- Fallback interval reduced from 5000ms to 30000ms

### Wave 5 — Real LLM Benchmark Validation
- `src/core/llm-benchmark.ts` — `measureOutputMetrics` (pure), `runLLMBenchmark` (A/B test), `formatBenchmarkReport`, `loadBenchmarkHistory`
- `danteforge benchmark-llm "task description"` — calls LLM twice and reports improvement delta
- 5 metrics: testLinesRatio, errorHandlingRatio, typeSafetyScore, completenessScore, docCoverageRatio
- Results saved to `.danteforge/benchmark-results.json`

### Wave 6 — Semantic Pack Compression
- `src/core/workspace-packer.ts` — `prioritizeFiles`, `compressFileContent`, `buildProjectIndex` exported
- `danteforge pack --max-tokens 50000` — auto-excludes lowest-priority files when over budget
- `danteforge pack --generate-index` — prepends project index block
- Smart priority tiers: src/ > tests/ > docs/ > config files

### Wave 7 — --simple Mode Overhaul
- `src/cli/commands/quickstart.ts` — `SIMPLE_CONSTITUTION_TEMPLATE` + 0-LLM simple path
- `danteforge quickstart --simple "My App"` — writes template constitution, scores it, prints 3 next-step commands in <90 seconds
- `danteforge init --simple` — skips automation wizard, asks only 2 questions

## Anti-Stub Compliance

All implementation uses real injection seams — no TODO, FIXME, TBD, or stub markers. Run `npm run check:anti-stub` to verify.

## Verification Gates

```bash
npm run typecheck    # 0 errors
npm run lint         # 0 violations
npm run check:anti-stub   # 0 stubs
npm test             # >= 3800 pass, 0 fail
npm run build        # dist/index.js emitted
npm --prefix vscode-extension run verify
npm run verify:live  # requires DANTEFORGE_LIVE_PROVIDERS set
```

## Known Outstanding Work

- `danteforge benchmark-llm` requires a live LLM to generate real A/B evidence — results are meaningful only with an API key configured
- Semantic PDSE scoring (`--semantic`) requires Ollama or a configured LLM provider
- VS Code FileSystemWatcher requires the extension to be rebuilt (`npm --prefix vscode-extension run build`) for changes to take effect
- `danteforge pr` requires `gh` CLI to be installed and authenticated for actual PR creation
