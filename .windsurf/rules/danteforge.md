## DanteForge Workflow Framework

You are assisting with a project that uses DanteForge - a structured spec-driven pipeline.

## Pipeline Stages (in order)
Each stage has a hard gate. You cannot skip stages.

1. `danteforge constitution` - Define project vision, principles, stack
2. `danteforge specify` - Generate SPEC.md from constitution
3. `danteforge clarify` - Review spec for gaps
4. `danteforge plan` - Break spec into implementation plan
5. `danteforge tasks` - Break plan into executable tasks per phase
6. `danteforge forge <phase>` - Implement tasks for a phase
7. `danteforge verify` - **Always run this after forge to validate**
8. `danteforge synthesize` - Consolidate learnings

## Your Role
- Read `.danteforge/STATE.yaml` to know the current phase and tasks
- Implement tasks using your native file editing tools
- Run tests using your terminal access
- Always call `danteforge verify` when your implementation is complete
- Never skip the verify step - it updates STATE.yaml and unlocks the next stage
