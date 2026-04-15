---
name: danteforge-score
description: "Fast project quality score — one number + 3 P0 action items in under 5 seconds. No LLM required. Pure filesystem analysis."
---

# /danteforge-score — Fast Project Score

When the user invokes `/danteforge-score`, run a deterministic quality score of the current project.

## Execution

Run the score command via the MCP tool `danteforge_score` or CLI:

```
danteforge score           # quick score + top 3 P0 gaps
danteforge score --full    # all 18 dimensions with weights, sorted worst-first
```

## What It Does

1. **Analyzes 18 quality dimensions** across the codebase (no LLM calls — pure filesystem)
2. **Shows a composite 0.0–10.0 score** with today's session delta (▲/▼)
3. **Lists the 3 highest-priority gaps** (P0 items) with exact forge commands to close them
4. **Updates `.danteforge/PRIME.md`** so the next session loads fresh context automatically

## Output Format

```
  8.7/10  — needs-work  (▲ +0.2 today)

  P0 gaps:
  1. communityAdoption  (1.5)  → npm publish && danteforge showcase
  2. performance        (6.5)  → danteforge forge "add incremental caching"
  3. tokenEconomy       (7.5)  → danteforge forge "add token routing"

  Run with --full for all 18 dimensions.
  PRIME.md updated.
```

## Score Contract

- **Deterministic**: Same codebase → same score, every run (no plateau penalty, no history dependency)
- **Session delta**: Baseline resets after 4 hours so `+0.2 today` stays meaningful
- **`--full`**: Shows all 18 dimensions sorted worst-first with weight percentages

## When to Use

- Before starting a sprint (know your baseline)
- After a sprint (confirm the score moved)
- Anytime you want a quick pulse check without waiting for an LLM assessment

CLI parity: `danteforge score [--full]`
