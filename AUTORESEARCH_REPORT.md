# AutoResearch Report: add injection seams to zero-seam CLI command files

**Duration**: ~2 hours
**Experiments run**: 10
**Kept**: 10 | **Discarded**: 0 | **Crashed**: 0
**Keep rate**: 100%

## Metric Progress
- Baseline: 80/124 files with at least one `_param?:` injection seam
- Final: 115/124 files seamed
- Total improvement: +35 files (+43.75%)
- Maximum achievable: 115/124 (9 remaining files are un-injectable: 6 re-export stubs, 2 empty files, 1 barrel index)

## Winning Experiments (all kept)

| # | Description | Files Added | Metric |
|---|-------------|-------------|--------|
| 1 | enterprise-readiness, constitution, audit, party | +4 | 84 |
| 2 | policy, compact, audit-export | +3 | 87 |
| 3 | setup-ollama, browse, oss-clean | +3 | 90 |
| 4 | awesome-scan, setup-figma, specify | +3 | 93 |
| 5 | tasks, tech-decide, feedback-prompt | +3 | 96 |
| 6 | design, review, synthesize | +3 | 99 |
| 7 | qa, oss, lessons | +3 | 102 |
| 8 | docs, cost, completion, dashboard, premium | +5 | 107 |
| 9 | profile, import, help, update-mcp | +4 | 111 |
| 10 | config, setup-assistants, ux-refine, doctor | +4 | 115 |

## Seam Patterns Applied

All seams follow the DanteForge injection seam pattern:
- Optional `_`-prefixed parameters in function options objects
- Resolver pattern: `const fn = options._fn ?? realFn`
- All seams default to the real implementation when not provided
- TypeScript strict mode compliant — no `as any` casts

### Common seam types added:
- `_loadState?: typeof loadState` / `_saveState?: typeof saveState` — state I/O
- `_llmCaller?: typeof callLLM` / `_isLLMAvailable?: typeof isLLMAvailable` — LLM deps
- `_stdout?: (line: string) => void` — output capture for testing
- Domain-specific: `_buildRegistry`, `_scanExternal`, `_detectBinary`, `_runQAPass`, etc.

## Files Still Without Seams (9 — structural, not fixable)

| File | Reason |
|------|--------|
| blaze.ts | Pure re-export: `export { blaze } from './magic.js'` |
| canvas.ts | Pure re-export: `export { canvas } from './magic.js'` |
| ember.ts | Pure re-export: `export { ember } from './magic.js'` |
| inferno.ts | Pure re-export: `export { inferno } from './magic.js'` |
| nova.ts | Pure re-export: `export { nova } from './magic.js'` |
| spark.ts | Pure re-export: `export { spark } from './magic.js'` |
| benchmark-run.ts | Empty file (0 bytes) |
| performance.ts | Empty file (0 bytes) |
| index.ts | Barrel re-export only |

## Key Insights

1. **100% keep rate** — Every seam addition improved the metric. No rollbacks needed.
2. **Uniform pattern** — The resolver pattern (`const fn = options._fn ?? realFn`) works cleanly across all command types.
3. **Typecheck gate** — `npx tsc --noEmit` after every batch caught zero regressions across 10 experiments.
4. **Batch sizing** — 3-5 files per commit was optimal: enough to amortize the commit overhead, small enough to stay focused.
5. **Re-export ceiling** — 6 magic preset files (blaze/canvas/ember/inferno/nova/spark) are structural re-exports — cannot be seamed without changing magic.ts itself.

## Next Steps for Stage 2

These seams are now ready for test coverage. The recommended next autoresearch goal:
> "write unit tests for CLI commands that have injection seams but zero test coverage"

Target files: `awesome-scan.ts`, `setup-figma.ts`, `specify.ts`, `tasks.ts`, `tech-decide.ts`, `feedback-prompt.ts`, `design.ts`, `review.ts`, `synthesize.ts`, `qa.ts`, `oss.ts`, `docs.ts`, `cost.ts`, `completion.ts`, `dashboard.ts`, `premium.ts`, `profile.ts`, `import.ts`, `help.ts`, `update-mcp.ts`, `config.ts`, `setup-assistants.ts`, `ux-refine.ts`, `doctor.ts`

## Full Results Log

```
experiment	metric_value	status	description
baseline	80	keep	unmodified baseline — 80/124 files with seams, 44 without
exp-1	84	keep	add seams: enterprise-readiness, constitution, audit, party (+4 files)
exp-2	87	keep	add seams: policy, compact, audit-export (+3 files)
exp-3	90	keep	add seams: setup-ollama, browse, oss-clean (+3 files)
exp-4	93	keep	add seams: awesome-scan, setup-figma, specify (+3 files)
exp-5	96	keep	add seams: tasks, tech-decide, feedback-prompt (+3 files)
exp-6	99	keep	add seams: design, review, synthesize (+3 files)
exp-7	102	keep	add seams: qa, oss, lessons (+3 files)
exp-8	107	keep	add seams: docs, cost, completion, dashboard, premium (+5 files)
exp-9	111	keep	add seams: profile, import, help, update-mcp (+4 files)
exp-10	115	keep	add seams: config, setup-assistants, ux-refine, doctor (+4 files — maximum achievable)
```
