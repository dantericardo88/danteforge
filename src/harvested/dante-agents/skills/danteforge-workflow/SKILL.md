---
name: danteforge-workflow
description: DanteForge spec-driven agentic pipeline — teaches any AI agent how to use DanteForge commands to build software systematically
version: 1.0.0
risk: low
source: danteforge-native
importDate: 2026-04-05
---

# DanteForge Workflow Skill

Use this skill when you need to build, improve, or assess software projects systematically using the DanteForge pipeline.

## When to use this skill

- Starting a new project or feature
- Running autonomous improvement cycles
- Assessing code quality against competitors
- Enforcing spec-driven discipline on a codebase

## Prerequisites

DanteForge must be installed:
```bash
npm install -g danteforge
danteforge --version
```

## The Pipeline

DanteForge enforces a strict pipeline with hard gates at each stage:

```
constitution → specify → clarify → plan → tasks → forge → verify → synthesize
```

**You cannot skip stages.** Each gate checks that the previous artifact exists before proceeding.

## Core Commands

### Start a project
```bash
danteforge constitution   # Define project vision, principles, stack
danteforge specify        # Generate SPEC.md from constitution  
danteforge clarify        # Review spec for gaps (LLM-powered QA)
danteforge plan           # Break spec into implementation plan
danteforge tasks          # Break plan into executable tasks
```

### Execute and verify
```bash
danteforge forge          # Execute current task wave
danteforge verify         # Run tests, build, lint — emit receipt
danteforge synthesize     # Generate handoff summary
```

### Assess quality
```bash
danteforge assess         # 18-dimension scoring vs 27 competitors
danteforge maturity       # Maturity level (Sketch→Enterprise-Grade)
danteforge universe       # Feature coverage vs competitor universe
```

### Autonomous improvement
```bash
danteforge self-improve   # Loop: assess → masterplan → forge until target score
danteforge nova           # 9-step full cycle (~$3 budget)
danteforge inferno        # 15-wave maximum power cycle (~$5 budget)
```

## Preset Levels (Budget Guide)

| Preset | Waves | Budget | Use case |
|--------|-------|--------|----------|
| spark  | 1     | ~$0.10 | Quick fix |
| ember  | 3     | ~$0.25 | Small feature |
| canvas | 6     | ~$0.75 | Design-first |
| magic  | 6     | ~$1.00 | Standard sprint |
| blaze  | 8     | ~$2.00 | Complex feature |
| nova   | 10    | ~$3.00 | Full cycle |
| inferno| 15    | ~$5.00 | Major sprint |

```bash
danteforge spark "fix the login bug"
danteforge nova "implement payment flow"
danteforge inferno "build the entire auth system"
```

## Hard Gates — Do Not Bypass

DanteForge enforces gates that prevent premature execution:
- `requireConstitution` — CONSTITUTION.md must exist
- `requireSpec` — SPEC.md must exist  
- `requirePlan` — PLAN.md must exist
- `requireTests` — test files must exist

Use `--light` flag to bypass gates (only for prototyping):
```bash
danteforge forge --light   # skip gates
```

## Lessons and Self-Improvement

DanteForge learns from failures:
```bash
danteforge lessons add "Always check for null before accessing .id"
danteforge lessons compact   # summarize and compact lessons file
danteforge retro             # sprint retrospective generation
```

## MCP Integration

If DanteForge is configured as an MCP server, you can call these tools directly without the CLI:
- `danteforge_forge`, `danteforge_verify`, `danteforge_assess`
- `danteforge_plan`, `danteforge_tasks`, `danteforge_state_read`
- (15 tools total — see docs/INTEGRATION-GUIDE.md)

## State and Progress

```bash
danteforge workflow    # show current pipeline position
danteforge dashboard   # full project dashboard
```

State is stored in `.danteforge/STATE.yaml` — do not edit manually.
