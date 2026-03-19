---
name: party
description: "Launch Dante Party Mode — multi-agent collaboration with isolated worktrees"
contract_version: "danteforge.workflow/v1"
stages: [spawn_lanes, execute_parallel, merge, verify]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: required
verification_required: true
---

# /party — Dante Party Mode

When the user invokes `/party`, follow this workflow:

1. **Activate agents**: PM, Architect, Dev, UX, Scrum Master
2. **Determine scale**: light / standard / deep based on project complexity
3. **Worktree isolation** (if `--worktree`): Create separate worktree per agent
4. **Orchestrate**: Each agent contributes their expertise:
   - PM: Task prioritization and scope
   - Architect: Technical design and dependencies
   - Dev: Implementation and testing
   - UX: Frontend patterns and accessibility
   - Scrum Master: Process enforcement
5. **Two-stage review**: Spec compliance, then code quality
6. **Merge results**: Combine agent outputs, resolve conflicts

Use the `subagent-driven-development` skill for dispatch and review.
Use the `using-git-worktrees` skill for worktree isolation.

## TOOL SAFETY RULES — All Models Must Follow

**NEVER run** these commands — they destroy all in-progress work:
- `git clean` (any flags) — deletes untracked files
- `git checkout -- .` — discards unstaged changes
- `git reset --hard/--merge` — discards ALL changes
- `git stash --include-untracked` — stashes new files away
- `rm -rf packages/<name>` or `rm -rf src/<name>` — deletes newly-written directories

**DO**: Read → Edit/Write → GitCommit. Always Read before editing. Only GitCommit after real file edits.
**If typecheck fails on a new package you created**: fix the TypeScript errors with Edit — do NOT delete the package.

**SEQUENTIAL VERIFICATION — after every Bash command, verify before proceeding**:
- After `git clone <url> <dir>`: use `ListDir` to confirm `<dir>` exists BEFORE reading files inside it.
- After any Bash that creates directories: verify with `ListDir` before referencing them.
- After `Write <file>`: wait for the SUCCESS result. If you see an error, fix it — do NOT proceed as if it succeeded.
- Tool calls run ONE AT A TIME. Each result is available before the next tool runs. Use this to verify.

**JSON TOOL CALL FORMAT** — malformed JSON causes SILENT DROPS (file never written, command never ran):
- Double quotes inside string values MUST be escaped: `\"`
- Backslashes MUST be escaped: `\\`
- Newlines inside string values MUST be `\n` — never a real newline character inside a JSON string.
