---
name: universe
description: "View the competitive feature universe — all unique capabilities across competitors, scored against the current project"
contract_version: "danteforge.workflow/v1"
stages: [build, score, display]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: not-required
verification_required: false
---

# /universe - Feature Universe Inspector

When the user invokes `/universe`, show the competitive feature universe:

1. Load (or build) the feature universe from competitors discovered via `/oss` or `state.competitors`.
2. Score the project against each feature in the universe (batched LLM evaluation).
3. Display a categorized breakdown: ✓ implemented | △ partial | ✗ missing.
4. Show the overall score, coverage %, and gap count vs. the completion target.

**The universe grows as more competitors are analyzed:**
- 10 tools × 12 features each → ~40-80 unique feature line items (after dedup)
- This IS the grading universe — the definition of what "complete" looks like

Run `/oss` first to populate competitor data, then `/universe` to see what you're being scored against.

Options:
- `--refresh` - Force rebuild of feature universe from competitors
- `--json` - Output machine-readable JSON

CLI parity: `danteforge universe [--refresh] [--json]`
