---
name: frontier
description: Frontier mode — lock the top-gap scoring dimensions each into their own build→score loop and push them in parallel toward the target, triggering autoresearch on stall. Use when the operator wants ALL dimensions driven to the frontier rather than one.
version: 1.0.0
risk: medium
source: danteforge-native
importDate: 2026-06-29
---

# DanteForge Frontier Skill

Frontier mode drives every selected dimension to the target in parallel, each in its own locked loop,
with `autoresearch` triggered when a dimension stalls. It is `crusade --frontier` / `ascend --frontier`.

## When to use this skill

- "Push everything to the frontier", "all dimensions to target, in parallel".
- A campaign where breadth (many dimensions) matters more than one deep feature.

## The Command

```bash
danteforge crusade --frontier --parallel 4 --goal "Push all dimensions to the frontier" --target 8
```

Each dimension loop: forge toward the goal → rescore → on 3 stalled cycles trigger a focused
`autoresearch` run → stop at `FRONTIER_REACHED` (target), `AT_CEILING`, or max cycles.
`FRONTIER_CRUSADE_REPORT.md` is written on completion.

## The frontier contract (8 vs 9+)

The **technological frontier is 8.0** — that is what this loop drives to unattended. **9+ is the
COMPETITIVE frontier and is feedback-gated**: it unlocks only after the operator (or other users)
actually use the tool at 8.0 and give feedback. The loop pauses at honest ceilings instead of
self-awarding 9+.

## For unattended runs

`danteforge supervise "<goal>" --engine frontier --target 8` keeps the frontier loop re-engaging
through sleep / crash / provider outage without a human.
