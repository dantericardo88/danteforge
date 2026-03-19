---
name: tasks
description: "Break plan into executable task list — structured for wave execution"
---

# /tasks — Task Breakdown

When the user invokes `/tasks`, follow this workflow:

1. **Check gates**: Verify PLAN.md exists. Load SPEC.md and CONSTITUTION.md for context.
2. **Break down plan**: Convert each plan item into executable tasks with:
   - Clear acceptance criteria
   - Test strategy (what to test, how to verify)
   - File paths to modify
   - Effort estimate (S/M/L)
   - Dependencies on other tasks
3. **Group into phases**: Organize tasks into execution waves respecting dependencies
4. **Save**: Write to `.danteforge/TASKS.md` and update STATE.yaml task registry
5. **Next step**: Suggest `/design` for UI projects or `/forge` to begin execution

Options:
- `--prompt` — Generate a copy-paste prompt instead of auto-generating
- `--light` — Skip hard gates

Use the `writing-plans` skill for structured task breakdown patterns.

CLI fallback: `danteforge tasks`
