# AutoResearch Report: reduce large function count

**Goal:** Eliminate all functions >100 LOC (AST-accurate measurement)
**Metric:** `90 - current_count` (higher = better; max = 90)
**Branch:** `autoresearch/reduce-large-fn-count`

---

## Metric Progress
- **Baseline:** 90 large functions (metric = 0)
- **Final:** 0 large functions (metric = **90** — maximum possible)
- **Total improvement:** 90 points (100% elimination)

---

## Winning Experiments (in order applied)

| Session | Experiments | Description | Fn Count | Metric |
|---------|-------------|-------------|----------|--------|
| 1 | exp01–exp09 | dag, dossier, batch helpers, perf, config, proof, pdse, design, oss | 90→68 | 22 |
| 1 | exp10–exp19 | help, go, magic, import, completion, lessons, assess, compete, harvest | 68→55 | 35 |
| 1 | exp20–exp29 | localHarvest, harvestPattern, autoforge-cmd, qa, doctor, quickstart, mutate, oss-exec, cost, mcp | 55→40 | 50 |
| 1 | exp30–exp33 | selfImprove, cofl, ossIntel, score/review | 40→35 | 55 |
| 1 | exp34–39 | completion-oracle, compete-matrix, ux-refine, installer, enterprise, benchmarks, pattern-scanner | 35→23 | 67 |
| 1 | exp40–46 | token-extractor, tool-registry, community-adoption, autoforge.ts, pdse, harsh-scorer, executor | 23→9 | 81 |
| 2 | exp47 | harvest-forge.ts: harvestForge 375L→50L (7 helpers) | 9→4 | 86 |
| 2 | exp48 | verify.ts: verify 380L→65L (6 helpers) | 4→3 | 87 |
| 2 | exp49 | magic.ts: runMagicPreset 372L→70L (5 helpers) | 3→2 | 88 |
| 2 | exp50 | autoforge-loop.ts: runAutoforgeLoop 408L→<100L (7 helpers) | 2→1 | 89 |
| 2 | exp51 | ascend-engine.ts: runAscend 513L→<100L (10 helpers) | 1→0 | **90** |

---

## Key Insights

- **Pure structural extraction wins every time** — 51/51 experiments kept, 0 discarded, 0 failed.
- **The 5 largest functions** (runAscend 513L, runAutoforgeLoop 408L, verify 380L, harvestForge 375L, runMagicPreset 372L) required multi-layer extraction: first split the outer function, then sometimes split the extracted helpers if they still exceeded 100L.
- **Mutable context objects** (e.g. `AscendCycleState`) solve the parameter explosion problem when multiple helpers need to mutate the same variables — pass by reference, mutate in place.
- **TypeScript strict mode** caught real type bugs in every large extraction: return type widening (`Promise<unknown>` vs `Promise<GoalConfig | null>`), enum type mismatches, interface incompatibilities.
- **100% keep rate** is achievable when the only change is structural (rename + extract, no logic changes). The AST-accurate metric never lied.

---

## Full Results Log

See `results.tsv` for complete experiment history.
