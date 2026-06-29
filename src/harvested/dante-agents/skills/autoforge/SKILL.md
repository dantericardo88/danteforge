---
name: autoforge
description: Deterministic auto-orchestration of the full DanteForge pipeline (constitution → spec → plan → tasks → forge → verify), with an autonomous loop mode that drives a project toward a score target. Use when the operator wants the whole pipeline run for them, or an unattended build loop toward 8.0.
version: 1.0.0
risk: medium
source: danteforge-native
importDate: 2026-06-29
---

# DanteForge Autoforge Skill

`autoforge` runs the full DanteForge build pipeline deterministically. With `--auto` it becomes an
autonomous loop that scores artifacts each cycle and keeps forging until the completion threshold or a
BLOCKED state. It is the default inner engine for the `supervise` auto-reengage loop.

## When to use this skill

- "Run the whole pipeline for me", "auto-build this", "loop toward done".
- As the engine under `danteforge supervise` for unattended building.

## The Command

```bash
# One pass through the pipeline
danteforge autoforge "build a CLI todo app"

# Autonomous loop toward a target (8.0 = the technological frontier)
danteforge autoforge "harden security" --auto --target 8

# Resume a paused loop from the last checkpoint
danteforge resume
```

Key flags: `--auto` (loop until ~complete or BLOCKED), `--target <score>`, `--max-waves <n>`,
`--profile quality|balanced|budget`, `--parallel`, `--worktree`, `--resume`, `--dry-run`, `--light`
(skip hard gates), `--adversarial` (adversarial score gate between cycles).

## Stopping conditions

| Condition | Status |
|-----------|--------|
| completion threshold reached | COMPLETE |
| circuit breaker (repeated failures) | BLOCKED |
| max waves reached | checkpointed |

## For unattended building, prefer `supervise`

`autoforge --auto` stops on a clean exit / crash / outage. To keep it looping through those WITHOUT a
human, wrap it: `danteforge supervise "<goal>" --engine autoforge --target 8`. Build to **8.0**
unattended, then pause for your usage + feedback (9+ is feedback-gated).
