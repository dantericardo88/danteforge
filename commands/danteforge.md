---
name: danteforge
description: "Maximum-depth intelligence + execution — local repo harvest + OSS discovery + 10-wave autoforge + party agents + 3x convergence cycles. The single highest-power command."
contract_version: "danteforge.workflow/v1"
stages: [local_harvest, oss_discovery, constitution, plan, tasks, autoforge, party, verify, synthesize, retro, compact, convergence]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: preferred
verification_required: true
---

# /danteforge - Maximum Depth Stack

When the user invokes `/danteforge`, execute the full maximum-depth stack in the workspace:

1. **local-harvest** → deep pattern extraction from local repos/folders (`--local-sources`)
2. **oss** → GitHub discovery, clone, constitutional pattern scan of the best matching OSS projects
3. **constitution** → establish or refresh project principles informed by both intelligence sources
4. **plan** → full architecture plan grounded in local + OSS patterns
5. **tasks** → granular task breakdown (more discrete tasks = more parallel party agents)
6. **autoforge** (10 waves) → iterative building with complexity-routed execution
7. **party** → parallel multi-agent execution with isolated worktrees, one agent per task
8. **verify** → full verification suite
9. **synthesize** → consolidate all artifacts into UPR.md
10. **retro** + **lessons-compact** → self-improvement and memory compaction
11. **3 convergence cycles** → verify → repair (3 focused autoforge waves) → verify loop

This is the highest-power preset. It combines every intelligence source (local private repos, GitHub OSS) with every execution engine (10-wave autoforge, party parallel agents) and every quality loop (verification, convergence, retro, lessons).

## Quick Usage

```bash
danteforge inferno "goal" --local-sources /path/to/repo1,/path/to/repo2 --local-depth full
```

## Maximum Depth Sequence (pre-pipeline for deepest intelligence)

For the deepest possible learning before execution, run the dedicated harvest commands first.
`harvest` uses Titan Harvest V2 — a deeper 5-step constitutional extraction than inferno's built-in oss step:

```bash
# Stage 1: Constitutional OSS harvest (Titan Harvest V2 — deeper than inferno's built-in oss step)
danteforge harvest

# Stage 2: Deep local pattern extraction from private repos on this machine
danteforge local-harvest /path/to/repo1 /path/to/repo2 --depth full

# Stage 3: Full maximum execution — local + OSS intel flows into planning + 10-wave autoforge + party
danteforge inferno "goal" --local-sources /path/to/repo1,/path/to/repo2 --local-depth full
```

## Options

- `--local-sources <paths>` - Comma-separated paths to local repos/folders to learn from
- `--local-depth shallow|medium|full` - Pattern extraction depth (`full` for maximum intelligence)
- `--prompt` - Print the execution plan without running it
- `--worktree` - Use isolated worktrees for heavier parallel execution
- `--isolation` - Enable party isolation mode
- `--max-repos <n>` - Control OSS discovery depth (number of repos to clone and analyze)
- `--profile quality|balanced|budget` - Override the default model routing profile

## Usage Rules

- `/danteforge` — when you want maximum intelligence (local + OSS) + maximum execution in one run
- `/inferno` — same execution depth, but no local repo learning (OSS only)
- `/nova` — deep execution with planning prefix, but no OSS or local harvest (~$3.00)
- `/blaze` — strong execution without planning prefix or OSS (~$1.50)
- `/magic` — after `/danteforge` completes, use magic for targeted follow-up gap closing

CLI parity: `danteforge inferno [goal] --local-sources [paths] --local-depth full`

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
