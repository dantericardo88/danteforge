---
name: blaze
description: "High-power preset - full party plus strong autoforge and self-improvement cleanup"
contract_version: "danteforge.workflow/v1"
stages: [party, autoforge, compact]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: preferred
verification_required: true
---

# /blaze - High-Power Preset

When the user invokes `/blaze`, execute the high-power preset in the workspace:

1. Run strong autoforge with parallel execution lanes
2. Escalate into full party mode for bigger feature pushes
3. Re-run verification
4. Compact lessons as self-improvement cleanup

Use this for big features that need more power than the default `/magic` preset.

Options:
- `--prompt` - Show the preset plan without executing it
- `--worktree` - Use isolated worktrees for heavier execution
- `--isolation` - Enable party isolation
- `--profile quality|balanced|budget` - Override the default budget profile

CLI parity: `danteforge blaze [goal]`

Matrix development note: high-power lanes may work in parallel, but score changes must go through `danteforge matrix propose` and `danteforge matrix merge --policy harsh-min`.
