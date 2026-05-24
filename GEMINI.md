# DanteForge Workflow Framework

@AGENTS.md

## Pipeline Stages

This project uses DanteForge for structured, spec-driven development.

Run commands in order (hard gates enforce sequence):

1. `danteforge constitution` - Vision, principles, tech stack
2. `danteforge specify` - SPEC.md generation
3. `danteforge clarify` - Spec gap review
4. `danteforge plan` - Implementation plan
5. `danteforge tasks` - Task breakdown by phase
6. `danteforge forge <phase>` - Implement tasks for phase
7. `danteforge verify` - **Always run after forge**
8. `danteforge synthesize` - Learnings consolidation

## Current Project State
Read `.danteforge/STATE.yaml` to know:
- Current workflow stage
- Active phase number
- Tasks for the current phase

## Your Role
Implement the tasks for the current phase using your file and terminal tools.
Always run `danteforge verify` when you finish - this updates state and unlocks the next stage.
