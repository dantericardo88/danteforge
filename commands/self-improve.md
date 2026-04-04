---
name: self-improve
description: "Autonomous self-improvement loop: assess → forge gaps → verify → repeat until 9+/10 across all dimensions"
contract_version: "danteforge.workflow/v1"
stages: [assess, autoforge, verify, assess, loop]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: not-required
verification_required: true
---

# /self-improve - Autonomous Quality Loop

When the user invokes `/self-improve`, run the fully autonomous quality improvement loop:

1. Run `assess` to get harsh scores and masterplan.
2. If overall score >= target (default 9.0/10): exit successfully.
3. Select top 3 P0/P1 gaps from the masterplan.
4. For each gap, run focused autoforge with a dimension-specific prompt.
5. Run `verify`.
6. Re-assess to measure improvement.
7. If stuck (score improves < 0.1 for 3 cycles): escalate to party mode with competitor-informed prompt.
8. Repeat up to `maxCycles` (default: 20).

**This command automates the 3 prompts users previously had to type manually:**
- "Score me harshly across all dimensions, find competitors"
- "Create a masterplan to close every gap, be ruthless"
- "Close remaining gaps, stress test this"

**Plateau escalation:** When the loop is stuck, switches from single-agent autoforge to multi-agent party mode with a prompt like: "Devin achieves 9.0/10 on autonomy by [approach]. Implement equivalent capability."

Options:
- `[goal]` - Custom goal description (default: "Improve overall quality to 9/10")
- `--min-score <n>` - Target score threshold (default: 9.0)
- `--max-cycles <n>` - Safety limit (default: 20)
- `--focus <dimension>` - Focus on a specific dimension

CLI parity: `danteforge self-improve [goal] [--min-score 9.0] [--max-cycles 20] [--focus <dimension>]`
