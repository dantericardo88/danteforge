---
name: forge
description: "Execute GSD waves — build the specified feature with Dante Agents"
---
# /forge — GSD Wave Execution

## Depth Doctrine (MANDATORY — read before executing any task)

**Wave type for this execution: BREADTH** — write modules + unit tests. Score ceiling: 6.

Before marking any module as complete, answer:
1. **Callsite**: What production `src/` function calls this? (not a test)
2. **Artifact**: What is the observable output? (file, log line, CLI output)
3. **Silent failure**: What breaks if this fails silently?

If answer 1 is "nothing yet" → mark `orphan-pending`, ceiling 5. Do NOT claim 6+.

**Zero tolerance: No mocks. No stubs. No TODOs.** Implement the real thing.
The merge court will BLOCK any commit with `jest.mock(`, `vi.mock(`, `sinon.stub(`, `// TODO`, or `throw new Error('not implemented')` in `src/` files.

After this forge wave, run a **DEPTH wave**: `danteforge validate <dim>` to produce receipts and unlock scores 7-9.

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
