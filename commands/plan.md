---
name: plan
description: "Generate detailed implementation plan from spec — architecture, phases, and dependencies"
---

# /plan — Implementation Planning

When the user invokes `/plan`, follow this workflow:

1. **Check gates**: Verify SPEC.md exists. Load CONSTITUTION.md, CLARIFY.md, TECH_STACK.md if present.
2. **Analyze scope**: Identify what needs to be built, modified, or integrated
3. **Generate plan**: Create PLAN.md with:
   - Architecture overview (inputs, outputs, execution model)
   - Implementation phases with dependency ordering
   - Technology decisions and constraints
   - Risk mitigations
   - File-level change map
4. **Mark effort**: Tag tasks with S/M/L effort estimates and `[P]` for parallelizable work
5. **Save**: Write to `.danteforge/PLAN.md`
6. **Next step**: Suggest `/tasks` to break the plan into executable units

Options:
- `--prompt` — Generate a copy-paste prompt instead of auto-generating
- `--light` — Skip hard gates
- `--ceo-review` — Apply CEO-level strategic review before writing
- `--refine` — Inject PDSE score for iterative improvement

Use the `writing-plans` skill for structured task breakdown.

CLI fallback: `danteforge plan`
