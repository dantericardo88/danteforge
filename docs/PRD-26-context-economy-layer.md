# PRD-26: Context Economy Layer

**Status:** Planned  
**Constitutional mandate:** Article XIV (Section 14) of `.danteforge/CONSTITUTION.md`  
**Harsh scorer dimension:** `contextEconomy` (weight: 0.03, current ceiling: 3.0/10)  
**OSS inspiration:** RTK (https://github.com/rtk-ai/rtk, Apache-2.0) — 10 patterns harvested  
**Baseline:** DanteForge 0.0/10, DanteCode ~4.0/10, DanteAgents ~4.4/10

---

## Problem

Every token injected into a LLM context window is a direct cost. DanteForge's forge/party/autoforge paths currently dump raw file contents, large state objects, and verbose prompts into context without any filtering. On a typical forge run, 40-60% of injected tokens are boilerplate that provides no signal improvement. This burns budget, slows response time, and increases the probability of context overflow on long runs.

There is no telemetry. Savings are invisible and therefore unscorable.

---

## Success Criteria

1. `contextEconomy` harsh scorer dimension reaches **≥ 3.0/10** (ceiling raised once pipeline ships with evidence)
2. **> 30% token reduction** on a typical `danteforge forge` run without loss of signal (measured via savings ledger)
3. Errors, warnings, stack traces, and test failures pass through **verbatim** (sacred content never compressed)
4. All compression operations write a telemetry record to `.danteforge/evidence/context-economy/`
5. Filter failures **never drop content** — fail-closed: raw content passes through on error

---

## Non-Goals

- Lossless compression (acceptable to summarize prose; never acceptable to summarize errors)
- Replacing the LLM with a cheaper model (this is context filtering, not model routing)
- Removing the token estimator (the estimator continues to operate independently)

---

## Architecture: 8-Stage Filter Pipeline

Inspired by RTK's pipeline architecture. Each stage is independently configurable and injectable for testing.

```
Stage 1: Tokenize & Classify
  ↓  Detect content type: source-code | prose | error-output | test-output | llm-response
Stage 2: Sacred Content Extraction
  ↓  Extract errors/warnings/assertions into a pass-through buffer (never touches further stages)
Stage 3: Deduplication
  ↓  Remove repeated identical blocks (common in multi-wave context accumulation)
Stage 4: Intent Detection
  ↓  LLM micro-call: "what is the essential intent of this block?" → preserve intent sentences
Stage 5: Type-Aware Compression
  ↓  Source code: preserve signatures + doc comments; prose: summarize to 20%; errors: SKIP
Stage 6: Validation
  ↓  Verify compressed output preserves key identifiers and intent; rollback if validation fails
Stage 7: Copy-on-Write Output
  ↓  Original preserved in buffer; filtered copy used for LLM injection
Stage 8: Telemetry Emission
  ↓  Write savings record: {inputTokens, outputTokens, ratio, contentType, timestamp}
     to .danteforge/evidence/context-economy/YYYY-MM-DD.jsonl
```

---

## Implementation Phases

### P0 — Sacred Content Preservation + Fail-Closed (Week 1)
**Unlocks:** `contextEconomy` from 0.0 → 1.5/10

- Implement sacred content extractor: detect errors, warnings, stack traces, test failures
- Wire into `callLLM` as a pre-injection guard: sacred content always bypasses compression
- Implement fail-closed wrapper: any filter error passes raw content through, logs incident
- Write `.danteforge/evidence/context-economy/` telemetry sink
- Tests: injection seam `_filterFn` in `callLLM` options; 10 sacred-detection tests

### P1 — 8-Stage Compression Pipeline (Week 2)
**Unlocks:** `contextEconomy` ceiling raised to 5.0/10, actual score reaches 2.5/10

- Implement all 8 stages as pure functions with injectable seams
- Wire pipeline into forge, party, autoforge context injection paths
- Per-command TOML filter configs in `.danteforge/filters/` (prose.toml, code.toml, errors.toml)
- Copy-on-write stream tee: original content preserved, filtered copy injected
- Tests: 30 pipeline unit tests; integration test verifies >20% token reduction on fixture

### P2 — Savings Telemetry + Ledger (Week 3)
**Unlocks:** `contextEconomy` score reaches 3.0/10 (ceiling enforced until P3)

- SQLite savings ledger at `.danteforge/context-economy.db` (per-session token accounting)
- `danteforge context-economy report` CLI command: sessions, total saved, per-type breakdown
- `danteforge measure` integrates contextEconomy signal from ledger evidence
- Tests: ledger write/read seam, report formatting tests

### P3 — Trust-Gated Project Config + Ceiling Raise (Week 4)
**Unlocks:** `contextEconomy` ceiling raised to 7.0/10; score reachable to 5.0+

- Trust-gated project-local filter config (`.danteforge/filters/project.toml` only activated by user `--trust-project-filters` flag)
- Locale-safe subprocess discipline for filter spawning (UTF-8 enforcement)
- Hook injection points before/after each filter stage (for user customization)
- `contextEconomy` KNOWN_CEILINGS ceiling updated to 7.0 once telemetry evidence >= 30 sessions

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/core/context-filter.ts` | New: 8-stage pipeline implementation |
| `src/core/context-economy-ledger.ts` | New: SQLite savings ledger |
| `src/core/llm.ts` | Modify: add `_filterFn` injection seam + sacred content guard |
| `src/cli/commands/context-economy.ts` | New: `context-economy report` command |
| `src/core/harsh-scorer.ts` | Modify: `computeContextEconomyScore()` reads ledger evidence |
| `.danteforge/filters/prose.toml` | New: prose compression config |
| `.danteforge/filters/code.toml` | New: source code filter config |
| `.danteforge/filters/errors.toml` | New: sacred content passthrough config |
| `tests/context-filter.test.ts` | New: 40+ pipeline tests |
| `tests/context-economy-ledger.test.ts` | New: 15 ledger tests |

---

## Measurement

Token reduction is measured by running a canonical forge fixture before and after filter activation:

```bash
# Baseline (filters disabled)
danteforge forge "add a simple hello world function" --no-filter --dry-run 2>&1 | grep "tokens:"

# With filters
danteforge forge "add a simple hello world function" --dry-run 2>&1 | grep "tokens:"
```

Success: filtered run uses ≤ 70% of the tokens used by the unfiltered run.
