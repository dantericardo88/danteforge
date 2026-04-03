---
name: nova
description: "Very-high-power preset - planning prefix (constitution + plan + tasks) plus blaze execution plus inferno polish without OSS overhead"
contract_version: "danteforge.workflow/v1"
stages: [constitution, plan, tasks, autoforge, party, verify, synthesize, retro, compact]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: preferred
verification_required: true
---

# /nova - Very-High-Power Preset

When the user invokes `/nova`, execute the nova preset in the workspace:

1. Run constitution to establish or refresh project principles.
2. Generate or refresh the implementation plan.
3. Break the plan into executable tasks.
4. Run strong autoforge with 10 waves and parallel execution lanes.
5. Escalate into full party mode with isolation.
6. Re-run verification.
7. Synthesize all artifacts into `UPR.md`.
8. Run retro for quality review.
9. Compact lessons as self-improvement cleanup.

Use this for feature sprints that need planning plus deep execution without OSS discovery overhead.

Options:
- `--prompt` - Show the preset plan without executing it
- `--worktree` - Use isolated worktrees for heavier execution
- `--isolation` - Enable party isolation
- `--profile quality|balanced|budget` - Override the default budget profile

CLI parity: `danteforge nova [goal]`
