---
name: danteforge-retro
description: "Run a sprint retrospective — what worked, what failed, score delta, lessons captured, and the next sprint focus"
---

# /danteforge-retro — Sprint Retrospective

When the user invokes `/danteforge-retro`, analyze the completed sprint and generate a retrospective.

## Execution

```
danteforge retro              # full retrospective for current sprint
danteforge retro --sprint 5   # retrospective for a specific sprint number
danteforge retro --compact    # brief version (key wins/losses only)
```

## What It Produces

1. **Score delta**: `score before → score after` with per-dimension breakdown
2. **What worked**: Patterns, approaches, and commands that produced measurable gains
3. **What failed**: Approaches that didn't move the score or caused regressions
4. **Lessons captured**: New entries added to `.danteforge/lessons.md`
5. **Next sprint focus**: Top 3 recommended targets based on current `score --full` output
6. **Refused patterns**: Any approaches that were tried and rejected (feeds `/danteforge-refused-patterns`)

## Output Written

- `.danteforge/retro/sprint-N.md` — full retrospective
- `.danteforge/lessons.md` — updated with new lessons
- `STATE.yaml` — sprint counter incremented

## When to Use

After completing a sprint (a focused block of forge/verify cycles). Retro compounds learning — the lessons feed into the next forge session's context.

CLI parity: `danteforge retro [--sprint N] [--compact]`
