---
name: danteforge-crusade
description: Sustained multi-pass OSS harvest + goal-gated forge loop that runs until a score target is reached. Frontier mode pushes N dimensions simultaneously to 9+ with autoresearch triggered on stall. Does not stop until every dimension hits the target or its natural ceiling.
version: 2.0.0
risk: medium
source: danteforge-native
importDate: 2026-05-15
---

# DanteForge Crusade Skill

Use this skill when a broad goal (security hardening, performance, DX improvement) needs to be driven to completion autonomously — not just attempted once, but pursued until the target score is actually reached.

## When to use this skill

- Security red-team hardening targeting 9.5+
- Any dimension that needs exhaustive OSS learning before forging
- Multi-cycle improvement campaigns that shouldn't stop at one pass
- When `/inferno` alone isn't enough — you need learning + forging + rescoring in a loop

## The Command

```bash
danteforge crusade \
  --goal "Security red-team hardening: OWASP Top 10 coverage, zero critical findings" \
  --domains "security,owasp,semgrep,bearer" \
  --dimension security \
  --target 9.5 \
  --max-cycles 10
```

## How It Works

Each cycle runs three phases in sequence:

### Phase A — Exhaustive OSS Harvest
Runs multiple OSS discovery passes across all `--domains` until the pattern yield plateaus (< 3 new patterns per pass). This ensures the full universe of known patterns is ingested before forging.

### Phase B — Forge Wave
Runs a full forge wave toward `--goal` using all harvested patterns as context. Equivalent to one `/inferno` wave targeted at the goal.

### Phase C — Score Gate
Scores the `--dimension` after the forge wave. If score >= `--target`, the crusade completes. Otherwise, starts the next cycle.

## Progress Tracking

After each cycle, `CRUSADE_REPORT.md` is written to the project root:
- Cycle number, timestamp
- OSS passes run + patterns harvested
- Forge wave result
- Score before/after/delta
- Estimated cycles remaining

## Stopping Conditions

| Condition | Status |
|-----------|--------|
| score >= target | CRUSADE_COMPLETE |
| maxCycles reached | CRUSADE_MAX_CYCLES |
| Fatal forge failure | CRUSADE_FAILED |

## Example: Security Campaign

```bash
# Run the full security hardening crusade
danteforge crusade \
  --goal "Security Red-Team Hardening: OWASP Top 10 coverage across all agent-produced code, zero CRITICAL findings in merge-court, danteforge security-scan exits clean, security dimension >= 9.5" \
  --domains "owasp,semgrep,bearer,eslint-security,snyk,nodejsscan" \
  --dimension security \
  --target 9.5 \
  --max-cycles 10 \
  --max-oss-passes 5
```

## Integration with Other Commands

- After crusade completes: run `danteforge verify` and `danteforge security-scan` to confirm
- CRUSADE_REPORT.md feeds into `danteforge synthesize` as evidence
- Pairs with `danteforge assess` to validate the score improvement is real

## Notes

- Each cycle is idempotent — if interrupted, start a new crusade (it rescores from current state)
- The OSS plateau detection prevents infinite harvesting loops
- `--max-oss-passes` caps passes per cycle (default: 5); `--max-cycles` caps total cycles (default: 10)

---

## Frontier Mode

Frontier mode is the recommended approach when you want ALL dimensions driven to 9+ rather than a single dimension. Instead of the gap-greedy re-ranking that `compete --auto` uses, frontier mode **locks each selected dimension into its own loop** until it reaches the target or its natural ceiling.

### How It Works

1. Selects the top N dimensions with the largest gap-to-frontier (sorted by `computeGapPriority`)
2. Runs all N dimension loops **in parallel** via `Promise.all`
3. Each dimension loop:
   - Runs `/inferno` toward the dimension's goal
   - Rescores the dimension
   - Detects stall: 3 consecutive cycles with delta < 0.1 → triggers `/autoresearch`
   - Stops when: score >= 9.0 (`FRONTIER_REACHED`) OR score >= ceiling (`AT_CEILING`) OR max cycles exhausted

### Stall → Autoresearch

When inferno stops making progress on a dimension, frontier mode automatically triggers a 30-minute `/autoresearch` run (Karpathy-style hypothesis loop) targeted at that dimension. If the research finds a better approach, it applies it and resets the stall counter.

### Command

```bash
# Push top 4 dimensions to 9+ in parallel
danteforge crusade \
  --frontier \
  --parallel 4 \
  --goal "Push all dimensions to the frontier (9+)" \
  --target 9.0

# Tighter per-dimension budget
danteforge crusade \
  --frontier \
  --parallel 2 \
  --max-dim-cycles 8 \
  --goal "Security and testing to 9.0+"
```

### Stopping Conditions (Frontier Mode)

| Condition | Dimension Status | Overall |
|-----------|-----------------|---------|
| score >= target | FRONTIER_REACHED | ALL_DONE if all done |
| score >= ceiling | AT_CEILING | ALL_DONE if all done |
| maxDimCycles reached | MAX_CYCLES | PARTIAL |

### Report

`FRONTIER_CRUSADE_REPORT.md` is written on completion showing per-dimension: initial→final score, cycles run, autoresearch invocations, and final status.
