# Project Conventions

## DanteForge Workflow Framework

This project uses DanteForge for structured development.

### Pipeline Stages
1. **constitution** - Vision, principles, stack (`danteforge constitution`)
2. **specify** - SPEC.md generation (`danteforge specify`)
3. **clarify** - Gap review (`danteforge clarify`)
4. **plan** - Implementation plan (`danteforge plan`)
5. **tasks** - Executable task breakdown (`danteforge tasks`)
6. **forge** - Implementation (`danteforge forge <phase>`)
7. **verify** - **Always run after forge**: `danteforge verify`
8. **synthesize** - Learnings (`danteforge synthesize`)

### Your Role
- Read `.danteforge/STATE.yaml` to know the current phase and tasks
- Implement code changes for the current phase's tasks
- After completing work, run: `danteforge verify`
- The verify step updates state and gates progression to the next stage
