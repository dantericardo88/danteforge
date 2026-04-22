---
name: danteforge-plan
description: "Generate a structured PLAN.md from the project spec — phased implementation plan with wave breakdown, success criteria, and task ordering"
---

# /danteforge-plan — Generate Implementation Plan

When the user invokes `/danteforge-plan`, generate a structured `PLAN.md` in `.danteforge/`.

## Execution

```
danteforge plan              # generate plan from SPEC.md
danteforge plan --phases 3   # force 3 implementation phases
danteforge plan --light      # skip spec gate requirement
```

## What It Generates

A `PLAN.md` file with:

1. **Implementation phases** — logical groupings of work (Foundation → Core → Polish)
2. **Wave breakdown** — specific tasks per phase with dependencies
3. **Success criteria** — measurable acceptance conditions per task
4. **Tech stack decisions** — if `tech-decide` hasn't run, surfaces key decisions
5. **Risk flags** — identifies tasks with high complexity or external dependencies

## Prerequisites

- `SPEC.md` must exist in `.danteforge/` (run `/danteforge-specify` first if not)
- Constitution (`.danteforge/CONSTITUTION.md`) is optional but recommended

## Workflow Context

```
/danteforge-specify → /danteforge-plan → /danteforge-tasks → /danteforge-forge
```

## After Planning

Run `/danteforge-tasks` to convert the plan into a tracked task list with assignable statuses.

CLI parity: `danteforge plan [--phases N] [--light]`
