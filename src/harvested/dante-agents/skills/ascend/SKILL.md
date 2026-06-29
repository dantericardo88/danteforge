---
name: ascend
description: Drive every scoring dimension toward its honest target via repeated build→score cycles, with a frontier mode for pushing multiple dimensions in parallel. Use when the operator wants the whole matrix climbed, not a single feature built.
version: 1.0.0
risk: medium
source: danteforge-native
importDate: 2026-06-29
---

# DanteForge Ascend Skill

`ascend` runs the dimension-ascent engine: it picks the dimensions with the largest gap to their
honest target and loops build→score on each until they reach the target or a natural ceiling.

## When to use this skill

- "Climb the whole matrix", "raise every dimension", "push to the frontier".
- After `autoforge` has built features and you want the scored quality driven up.

## The Command

```bash
# Climb toward the honest per-dimension targets
danteforge ascend --target 8

# Frontier mode — push multiple dimensions in parallel
danteforge ascend --frontier --parallel 4 --target 8
```

## The frontier contract

`ascend` builds to **8.0 — the technological frontier — unattended**. It will pause at real capability
ceilings rather than self-award **9+**, which is the COMPETITIVE frontier and unlocks only after real
usage + feedback from the operator or other users. This is by design, not a limitation to loop past.

## For truly unattended runs

Wrap it so transient stops auto-restart: `danteforge supervise "<goal>" --engine frontier --target 8`.
The Supervisor handles sleep / crash / outage; `ascend` does the climbing.
