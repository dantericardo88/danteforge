---
name: autoforge
description: "Deterministic auto-orchestration — score artifacts, plan next steps, execute pipeline"
contract_version: "danteforge.workflow/v1"
stages: [score, analyze, plan, execute, report]
execution_mode: staged
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: preferred
verification_required: true
---

# /autoforge — Autonomous Pipeline Orchestration

When the user invokes `/autoforge`, follow this workflow:

Execute the workflow yourself inside Codex and the current workspace. Do not default to `danteforge autoforge` unless the user explicitly asks for the CLI or native execution is blocked.

1. **Score artifacts**: Run PDSE scoring on all existing artifacts (CONSTITUTION, SPEC, CLARIFY, PLAN, TASKS)
2. **Analyze state**: Determine current workflow stage, detect scenario (cold-start, mid-project, stalled, frontend, multi-session-resume)
3. **Plan next steps**: Generate a deterministic execution plan based on scores and gaps
4. **Execute or report**:
   - Default: Execute steps up to `--max-waves` checkpoint
   - `--dry-run`: Show plan without executing
   - `--score-only`: Write AUTOFORGE_GUIDANCE.md with scores and recommendations
   - `--auto`: Run autonomous loop until 95% completion or BLOCKED state
5. **Report**: Show completed steps, failures, and next recommended action

Options:
- `--dry-run` — Show plan without executing
- `--max-waves <n>` — Max steps before checkpoint (default: 3)
- `--score-only` — Score artifacts and write guidance, no execution
- `--auto` — Run autonomous loop until completion or blocked
- `--force` — Override one BLOCKED artifact for one cycle (logged to audit)
- `--light` — Skip hard gates
- `--prompt` — Generate copy-paste prompt describing what autoforge would do

CLI fallback only on explicit request: `danteforge autoforge [goal]`

## TOOL SAFETY RULES — All Models Must Follow

**NEVER run** these commands — they destroy all in-progress work:
- `git clean` (any flags) — deletes untracked files
- `git checkout -- .` — discards unstaged changes
- `git reset --hard/--merge` — discards ALL changes
- `git stash --include-untracked` — stashes new files away
- `rm -rf packages/<name>` or `rm -rf src/<name>` — deletes newly-written directories

**DO**: Read → Edit/Write → GitCommit. Always Read before editing. Only GitCommit after real file edits.
**Bash allowed for**: `npm run typecheck`, `npm test`, `npm run lint`, read-only git status queries.
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
