---
name: magic
description: "Balanced default preset - token-efficient follow-up work with autoforge reliability and lessons"
contract_version: "danteforge.workflow/v1"
stages: [autoforge, lessons]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: preferred
verification_required: true
---

# /magic - Balanced Default Preset

When the user invokes `/magic`, follow this workflow:

1. Treat `/magic` as the default balanced combo command for daily work
2. Route through the magic preset runner with level `magic`
3. Use budget-profile autoforge with parallel execution lanes by default
4. Keep hard gates, PDSE scoring, and lessons cleanup enabled
5. Report which preset steps ran and what should happen next

Options:

- `--level spark|ember|magic|blaze|inferno` - Route through a specific preset level
- `--profile quality|balanced|budget` - Override the default budget profile
- `--prompt` - Show the preset plan without executing it
- `--worktree` - Use an isolated worktree for heavier presets
- `--isolation` - Enable isolation when party mode is used

## CRITICAL — Pipeline Completion Rules

These rules override all other behavior and MUST be followed exactly:

1. **NEVER stop mid-pipeline.** Do NOT emit a text-only response (summary, status update, or recap) until EVERY step in the pipeline is complete. A "Summary" before all steps are done is a critical failure.
2. **Every response MUST contain tool calls** until the final step is verified complete. If you have no tool to call, you are wrong — re-read the pipeline steps and continue.
3. **Track progress explicitly.** After completing each step, emit: `[Pipeline: X/Y steps complete — next: <step_kind>]`. This keeps you on track.
4. **If context is getting large**, compact intermediate results (replace verbose tool output with short summaries) but CONTINUE executing. Never stop to "save context".
5. **If you hit an error**, retry the current step up to 2 times with a different approach. Only after 2 retries should you skip a step and continue to the next one.
6. **On round budget warning** ("context: X% — approaching limit"), aggressively compact old tool results and continue. Do NOT treat this as a signal to stop.
7. **The pipeline is only complete when you have explicitly verified:** all code changes compile (typecheck), tests pass, and the final step has been executed.

Usage rule:

- First-time new matrix dimension + fresh OSS discovery -> `/inferno`
- All follow-up PRD gap closing -> `/magic`

CLI parity: `danteforge magic [goal]`

## TOOL SAFETY RULES — All Models Must Follow

**NEVER run** these commands — they destroy all in-progress work:
- `git clean` (any flags) — deletes untracked files
- `git checkout -- .` — discards unstaged changes
- `git reset --hard/--merge` — discards ALL changes
- `git stash --include-untracked` — stashes new files away
- `rm -rf packages/<name>` or `rm -rf src/<name>` — deletes newly-written directories

**DO**: Read → Edit/Write → GitCommit. Always Read before editing. Only GitCommit after real file edits.
**If typecheck fails on a new package you created**: fix the TypeScript errors with Edit — do NOT delete the package.
