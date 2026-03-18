---
name: forge
description: "Execute GSD waves — build the specified feature with Dante Agents"
---

# /forge — GSD Wave Execution

When the user invokes `/forge`, follow this workflow:

1. **Check gates**: Verify PLAN.md exists. If TDD is enabled, verify tests exist.
2. **Load tasks**: Read tasks from `.danteforge/TASKS.md` or STATE.yaml
3. **Execute wave**: For each task in the current phase:
   - Follow TDD if enabled (write test first, then implementation)
   - Make atomic commits with `[DanteForge]` prefix
   - Verify each task output matches acceptance criteria
4. **Quality profile**: If `--profile quality`, trigger Dante Party Mode after execution
5. **Next step**: Suggest running `danteforge verify` to check results

Options:
- `--parallel` — Run tasks in parallel
- `--profile quality|balanced|budget` — Execution depth
- `--light` — Skip hard gates
- `--worktree` — Execute in isolated git worktree

Use the `test-driven-development` skill for all code changes.
Use the `using-git-worktrees` skill when `--worktree` is specified.
