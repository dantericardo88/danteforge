# DanteForge v0.17.0 Operational Readiness

This document reflects the current shipped state of DanteForge `v0.17.0` (Credibility & Guided Path Edition).

Historical readiness guides and planning snapshots are indexed in [Release-History.md](Release-History.md).

## New in v0.17.0

### Wave 1 — Version Bump & CHANGELOG Backfill
- `package.json` + `vscode-extension/package.json` bumped to `0.17.0`
- `CHANGELOG.md` backfilled with v0.15.1 (Sprints 27+28) and v0.17.0 (Sprint 29) entries

### Wave 2 — Delta-Aware `assess` Output
- `src/core/state.ts` — added `sessionBaselineScore` and `sessionBaselineTimestamp` fields
- `src/cli/commands/assess.ts` — baseline is captured on first run; subsequent runs show "▲ +1.4 since session start" delta line
- `--set-baseline` flag resets the baseline to the current score at any time

### Wave 3 — Interactive `danteforge flow`
- `src/cli/commands/flow.ts` — `--interactive` flag now launches a real numbered menu picker instead of a static text printout
- `_prompt` injection seam for testing without TTY
- User picks workflow → gets the exact commands to run, copy-pasteable

### Wave 4 — `danteforge showcase` Command
- `src/cli/commands/showcase.ts` — NEW: scores any project with the full harsh scorer, generates `docs/CASE_STUDY.md`
- `docs/CASE_STUDY.md` — shipped in repo: real 18-dimension scorecard for `examples/todo-app` (2.3/10 overall, with real scores per dimension)
- `--project <path>` to score any project, `--format json` for machine-readable output

### Wave 5 — Improvement Report Auto-Export
- `src/cli/commands/self-improve.ts` — `buildImprovementReport()` pure function exported
- After every `self-improve` run with ≥1 cycle, `docs/IMPROVEMENT_REPORT.md` is auto-written
- Contains: before/after summary, cycle-by-cycle score table, verdict, next steps

## Anti-Stub Compliance

All implementation uses real injection seams — no TODO, FIXME, TBD, or stub markers. Run `npm run check:anti-stub` to verify.

## Verification Gates

```bash
npm run typecheck         # 0 errors
npm run lint              # 0 violations
npm run check:anti-stub   # 0 stubs
npm test                  # >= 4045 pass, 0 fail
npm run build             # dist/index.js emitted
npm run release:check     # EXIT:0
npm run verify:live       # requires DANTEFORGE_LIVE_PROVIDERS set
```

## Test Coverage

4045 tests, 0 failures. 19 new tests in Sprint 29:
- `tests/assess-delta.test.ts` — 5 tests (session baseline, delta rendering, --set-baseline)
- `tests/flow-interactive.test.ts` — 5 tests (numbered picker, non-interactive, out-of-range)
- `tests/showcase.test.ts` — 5 tests (injection seams, JSON format, Markdown output)
- `tests/self-improve-report.test.ts` — 4 tests (pure function, file write, verdict labels)

## Shipped Artifacts

- `docs/CASE_STUDY.md` — real 18-dimension scorecard for examples/todo-app project
- `src/cli/commands/showcase.ts` — 180-line command with full injection seam coverage
- `docs/IMPROVEMENT_REPORT.md` — generated after each self-improve run

## Known Outstanding Work

- `danteforge benchmark-llm` requires a live LLM to generate real A/B evidence — results are meaningful only with an API key configured
- Semantic PDSE scoring (`--semantic`) requires Ollama or a configured LLM provider
- `danteforge showcase` scores the todo-app at 2.3/10 because it lacks a full DanteForge pipeline (CONSTITUTION, SPEC, etc.) — this is accurate and expected for a minimal demo app
- Community adoption metrics require GitHub + npm API access; `fetchCommunityMetrics` returns `{}` in offline/CI environments
- VS Code FileSystemWatcher requires the extension to be rebuilt (`npm --prefix vscode-extension run build`) for changes to take effect
