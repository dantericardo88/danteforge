---
name: gap
description: "Gap analyzer — shows exactly what's needed to reach the next score tier per dimension"
---

# /gap — Depth Doctrine Gap Analyzer

## Depth Doctrine (MANDATORY)

This is a **read-only diagnostic command**. It does not modify scores or run outcomes.
It tells the operator exactly what to do next to reach the next tier.

When the user invokes `/gap`, run the gap analysis:

1. Load the competitive matrix and outcome evidence
2. For each dimension, compute current score, tier, and blockers
3. Show the single most impactful next action per dimension

## Usage

```bash
danteforge gap <dimId>     # Analyze one dimension
danteforge gap --all       # Analyze all dimensions
danteforge gap --json      # Machine-readable output
```

## Output Format

```
testing (score: 7.0, tier: legacy, next: T5 → 8.0)
  BLOCKER [no-outcomes]: No outcomes declared — score capped at 7.0
    → Add outcomes[] to this dim in matrix.json
  NEXT ACTION: Declare a T5 shell outcome with a real smoke test
```

## Score Tier Reference

| Score | Tier | What it means | How to unlock |
|---|---|---|---|
| ≤5.0 | T2 | Code + tests pass | Module + tests |
| ≤7.0 | T4 | Production callsite wired | Orphan check passes |
| ≤8.0 | T5 | Smoke test passes, ≤7 days | `danteforge validate <dim>` |
| ≤8.5 | T6 | Live telemetry, ≤24h | T6 telemetry outcome |
| ≤9.0 | T7 | Multi-receipt consensus | 3+ outcomes at T5+, ALL passing |
| ≤9.5 | T8 | Live verification, ≤24h | All outcomes fresh + live verify |

## When to Use

- After running `danteforge score` and seeing a dim stuck below target
- Before starting a depth wave — know what outcomes to declare
- After `danteforge validate` to understand what to do next
- In CI to generate a gap report for the team

CLI parity: `danteforge gap [dimId] [--all] [--json]`
