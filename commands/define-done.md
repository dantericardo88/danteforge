---
name: define-done
description: "Interactive Q&A to define what 9+ means — sets the completion target used by assess and self-improve"
contract_version: "danteforge.workflow/v1"
stages: [prompt, save]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: not-required
verification_required: false
---

# /define-done - Define Completion Target

When the user invokes `/define-done`, run an interactive prompt to establish what "done" means for this project:

1. Check if a completion target already exists in `.danteforge/completion-target.json`.
2. If it exists (and no `--reset`): show the current target and exit.
3. If not (or `--reset`): prompt the user with 3 options:
   - **Feature Universe** (recommended): Analyze competitors → extract all unique function-level capabilities → build a union of 40-100 feature line items → score against each one. Done = 9+/10 on 90% of features.
   - **Standard Dimensions**: Use the existing 12-dimension quality scoring. Done = all dimensions 9+/10.
   - **Custom**: User defines their own criteria in plain text.
4. Save the definition to `.danteforge/completion-target.json`.

Once set, `danteforge assess` and `danteforge self-improve` use this target automatically.

**This solves the core problem**: LLMs always say "done" — this makes "done" concrete and measurable.

Options:
- `--reset` - Clear existing target and re-prompt

CLI parity: `danteforge define-done [--reset]`
