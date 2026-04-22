---
name: danteforge-dossier
description: "Competitor dossier management — build, inspect, diff, and assemble the competitive landscape from source-backed, rubric-locked evidence"
---

# /danteforge:dossier — Competitor Dossier Management

When the user invokes `/danteforge:dossier [args]`, execute the requested dossier operation or
show the menu of available actions.

## What It Does

The dossier system replaces vibes-based matrix scoring with source-backed, rubric-locked
competitor intelligence. Each dossier fetches real source content (changelogs, docs, GitHub),
extracts verbatim evidence quotes per dimension, and LLM-scores each of 28 rubric dimensions.

## Quick Actions

```bash
# Build / refresh
danteforge dossier build cursor               # fetch + score one competitor
danteforge dossier build --all --since 7d     # refresh all stale competitors
danteforge dossier build aider --sources "https://aider.chat/changelog"

# Inspect
danteforge dossier show cursor                # full dossier with all 28 dims
danteforge dossier show cursor --dim 4        # single dimension with evidence quotes
danteforge dossier list                       # table of all dossiers + composite scores

# Diff
danteforge dossier diff cursor                # what changed vs previous build

# Landscape (assembled matrix from all dossiers)
danteforge landscape                          # rebuild full matrix
danteforge landscape ranking                  # sorted table by composite score
danteforge landscape gap                      # where DanteCode trails the leader per dim
danteforge landscape diff                     # what changed since last landscape build

# Rubric
danteforge rubric show                        # all 28 dimensions
danteforge rubric show --dim 4                # single dimension with score criteria
danteforge rubric validate                    # check for unverified dimensions
```

## Standard Refresh Workflow

```bash
# Start of any competitive sprint:
danteforge dossier build --all --since 7d     # refresh stale, skip fresh
danteforge landscape                          # assemble matrix
danteforge landscape gap                      # see where to focus

# After improvements land:
danteforge landscape                          # update DanteCode position
danteforge landscape gap                      # remaining gaps
```

## 28-Dimension Rubric

Scores are 1–10, locked to the rubric at `.danteforge/rubric.json`. Each score requires
verbatim source evidence — dimensions with no non-empty quotes are marked `unverified`.

Score tiers: 9 = leader-level (Cursor-quality), 7 = solid, 5 = functional, 3 = prototype, 1 = absent.

## Competitors Tracked

11 competitors in `.danteforge/competitor-registry.json`:
Cursor, OpenAI Codex, Claude Code, GitHub Copilot, Windsurf, Devin,
Aider, OpenHands, Cline, Continue.dev, Tabby — plus `dantescode` (self).

## MCP Tools (usable from any Claude Code session)

- `danteforge_dossier_build` — build or refresh a competitor dossier
- `danteforge_dossier_get` — get dossier (optionally single dim)
- `danteforge_dossier_list` — list all built dossiers
- `danteforge_landscape_build` — rebuild full landscape
- `danteforge_landscape_diff` — show what changed
- `danteforge_rubric_get` — get rubric (optionally single dim)
- `danteforge_score_competitor` — composite score for a competitor

## Auto-Invocation

The dossier system is automatically invoked by:
- `/danteforge:inferno` — pre-flight before autoforge, landscape rebuild after retro
- `/danteforge:ascend` — intelligence refresh before loop, landscape update after each cycle
- `/danteforge:compete` — dossier refresh in Phase 1 INVENTORY
- `/danteforge:assess` — self-dossier refresh (best-effort, never blocks)
- `/danteforge:score` — staleness warning when landscape >7 days old

CLI parity: `danteforge dossier <build|show|list|diff> [options]`
