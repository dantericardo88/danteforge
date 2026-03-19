---
name: inferno
description: "Maximum-power preset - OSS discovery plus full implementation and evolution"
contract_version: "danteforge.workflow/v1"
stages: [oss_discovery, autoforge, party, verify, compact]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: preferred
verification_required: true
---

# /inferno - Maximum-Power Preset

When the user invokes `/inferno`, execute the maximum preset in the workspace:

1. Run fresh OSS discovery first
2. Run maximum-depth autoforge with parallel execution lanes
3. Escalate into full party mode
4. Verify, synthesize, and retro the outcome
5. Compact lessons as self-improvement cleanup

Use this for the first big attack on a new matrix dimension.

Options:
- `--prompt` - Show the preset plan without executing it
- `--worktree` - Use isolated worktrees for heavier execution
- `--isolation` - Enable party isolation
- `--max-repos <n>` - Control OSS discovery depth
- `--profile quality|balanced|budget` - Override the default budget profile

Usage rule:
- First-time new matrix dimension + fresh OSS discovery -> `/inferno`
- All follow-up PRD gap closing -> `/magic`

CLI parity: `danteforge inferno [goal]`

## TOOL SAFETY RULES — All Models Must Follow

**NEVER run these commands** — they destroy all in-progress work:
- `git clean` — deletes untracked files (new code you just wrote)
- `git checkout -- .` — discards all unstaged changes
- `git reset --hard` or `--merge` — discards ALL changes
- `git stash --include-untracked` — stashes new files out of existence
- `rm -rf packages/<name>` or `rm -rf src/<name>` — deletes newly-written package/source directories

**Instead**: Use `Read` → `Edit`/`Write` → `GitCommit` workflow only.
- Read a file BEFORE editing it. Every Edit/Write must be preceded by a Read.
- Only use `GitCommit` after a real `Edit` or `Write` tool result.
- Use `Bash` only for: `npm run typecheck`, `npm test`, `npm run lint`, `gh` CLI, or safe read-only operations.
- If `npm run typecheck` fails on a new package you created, **fix the TypeScript errors** — do NOT delete the package.

**SEQUENTIAL VERIFICATION — after every Bash command, verify before proceeding**:
- After `git clone <url> <dir>`: use `ListDir` to confirm `<dir>` exists BEFORE reading files inside it.
- After any Bash that creates directories: verify with `ListDir` before referencing them.
- After `Write <file>`: wait for the SUCCESS result. If you see an error, fix it — do NOT proceed as if it succeeded.
- Tool calls run ONE AT A TIME. Each result is available before the next tool runs. Use this to verify.

**JSON TOOL CALL FORMAT** — malformed JSON causes SILENT DROPS (file never written, command never ran):
- Double quotes inside string values MUST be escaped: `\"`
- Backslashes MUST be escaped: `\\`
- Newlines inside string values MUST be `\n` — never a real newline character inside a JSON string.
