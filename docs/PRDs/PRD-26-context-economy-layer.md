# PRD-26: Context Economy Layer

**Status:** Draft
**Author:** DanteForge Autoresearch Sprint
**Date:** 2026-04-24
**Constitutional reference:** Article XIV
**Harvest source:** RTK (Apache-2.0) — `.danteforge/OSS_HARVEST/rtk_patterns.md`
**Scorer dimension:** `contextEconomy` (weight 0.03, ceiling 3.0 until this PRD ships)

---

## Problem

Every token injected into an LLM context window is a direct cost. DanteForge's forge, party, and autoforge flows currently inject content without any systematic filtering:

- `party-mode.ts` injects full file contents, state YAML, and task context raw
- `autoforge.ts` builds large guidance prompts that include historical audit log entries
- `forge` waves include wave output from previous waves without compression
- No telemetry tracks what was injected or how much could have been saved

**Measured cost on a typical forge run:**
- ~8,000–12,000 tokens injected per wave
- ~30–40% of injected tokens are redundant (boilerplate, repeated context, stale history)
- No evidence file proves this is happening or improving

**Consequence:** Every cent saved on context is invisible. The harsh scorer has no signal. DanteForge cannot self-improve on token efficiency because it cannot measure it.

---

## Success Criteria

1. `contextEconomy` display score ≥ 3.0/10 (ceiling lifted to allow further progress)
2. `danteforge quality --json` includes `economySummary: { sessionTokensSaved, compressionRatio, agentBreakdown }`
3. >30% token reduction on a typical forge run measured by `.danteforge/evidence/context-economy/savings.jsonl`
4. Sacred content (errors, test failures, warnings) never appears compressed in LLM prompts — verified by test
5. Fail-closed behavior verified by test: filter failure → raw passthrough, never empty string

---

## Non-Goals

- Building a general-purpose context compression library (that's RTK's job)
- Compressing inter-agent communication in party mode (separate PRD)
- Changing the LLM API (tokens are already counted via token-estimator.ts)
- Reducing context windows below minimum needed for task correctness

---

## Solution: 8-Stage Context Filter Pipeline

Inspired by RTK's pipeline architecture. Each stage is a pure function with an injection seam. Stages compose in order; failures fall through to the next stage (never drop content).

```
input
  → [1] detectContentType      — code | prose | errors | history | spec
  → [2] preserveSacredContent  — errors/warnings bypass all compression
  → [3] filterBoilerplate      — remove license headers, import blocks, repeated context
  → [4] compressProse          — summarize prose sections above threshold length
  → [5] applyPerTypeRules      — different compression aggressiveness per content type
  → [6] validateOutput         — ensure output >= 10% of input (fail-closed)
  → [7] emitTelemetry          — write savings record to evidence dir
  → [8] output
```

---

## Implementation Phases

### P0 — Safety Foundation (1 sprint, unlocks ceiling raise to 5.0)

**Files:** `src/core/context-filter-pipeline.ts` (new)

1. `preserveSacredContent(content)` — identifies error/warning/test-failure lines, routes to bypass
2. `copyOnWriteTee(content)` — always preserves original; if output < 10% of original, return original
3. Wire into `autoforge.ts` guidance prompt construction (narrowest path first)
4. Write test: sacred content bypass verified
5. Write test: fail-closed behavior (empty filter output → raw passthrough)

### P1 — Pipeline Foundation (1 sprint)

**Files:** `src/core/context-filter-pipeline.ts`, `src/core/autoforge.ts`, `party-mode.ts`

1. Implement all 8 stages as injectable pure functions
2. Wire into forge wave context construction
3. Wire into party-mode agent dispatch
4. Add `_filterPipeline` injection seam to `HarshScorerOptions` (for testing)
5. Per-command config loading from `.danteforge/filter-configs/<command>.yaml`

### P2 — Savings Telemetry (1 sprint)

**Files:** `src/core/context-filter-pipeline.ts`, `src/cli/commands/quality.ts`

1. Write savings record to `.danteforge/evidence/context-economy/savings.jsonl` after every filter run
2. Tag each record with `agentType` and `command`
3. Add `economySummary` block to `danteforge quality --json` output
4. Wire savings signals into `contextEconomy` sub-metric scoring

### P3 — Configuration (optional sprint)

**Files:** `src/core/config.ts`, `.danteforge/filter-configs/`

1. Per-command filter config files
2. Trust-gated project-local config (`filterTrustProjectConfig` in global config)
3. `danteforge economy report` command showing gain by agent type

---

## Dimension Score Unlocking

| Phase | Score Unlocked | How |
|---|---|---|
| P0 complete | 1.5/10 | filterCoverage partial + failClosedCompression verified |
| P1 complete | 2.5/10 | filterCoverage full + perTypeRules |
| P2 complete | 3.0/10 | telemetryEmission + evidenceCompression |
| Ceiling raised | 5.0+/10 | Update `KNOWN_CEILINGS.contextEconomy.ceiling` in compete-matrix.ts |

To raise the ceiling: update `KNOWN_CEILINGS.contextEconomy` after Phase P2 ships with evidence. Recommend raising to 6.0 after P2, 8.0 after P3, 9.5 when all 5 sub-metrics are fully saturated.

---

## Acceptance Test

```bash
# 1. Sacred content test
npx tsx --test tests/context-filter-pipeline.test.ts
# Expect: "error lines pass through uncompressed" ✓

# 2. Fail-closed test
# Expect: "filter returning empty string falls back to original" ✓

# 3. Token savings evidence
danteforge forge "write a hello world test"
cat .danteforge/evidence/context-economy/savings.jsonl
# Expect: at least 1 record with compressionRatio < 1.0

# 4. Quality JSON includes economy summary
danteforge quality --json | jq '.economySummary'
# Expect: { sessionTokensSaved: N, compressionRatio: 0.xx, agentBreakdown: {...} }

# 5. Scorer recognizes improvement
danteforge measure --full | grep contextEconomy
# Expect: contextEconomy score > 0.0 after P0+P1
```

---

## Related Documents

- `.danteforge/CONSTITUTION.md` — Article XIV: Context Economy
- `.danteforge/OSS_HARVEST/rtk_patterns.md` — 10 harvest patterns from RTK
- `.danteforge/HARSH_SCORER_DIMENSIONS.md` — contextEconomy dimension spec
- `.danteforge/CONTEXT_ECONOMY_BASELINE.md` — trio baseline scores
- `src/core/compete-matrix.ts` — `KNOWN_CEILINGS.contextEconomy` ceiling definition
- `src/core/harsh-scorer.ts` — `computeContextEconomyScore()` function
