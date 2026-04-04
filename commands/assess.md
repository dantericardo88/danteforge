---
name: assess
description: "Harsh self-assessment: score all 12 dimensions, benchmark against competitors, generate gap-closing masterplan"
contract_version: "danteforge.workflow/v1"
stages: [score, competitors, masterplan]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: not-required
verification_required: false
---

# /assess - Harsh Self-Assessment

When the user invokes `/assess`, run a comprehensive self-evaluation of the current project:

1. Score the project harshly across all 12 dimensions (0-10 scale, with penalties for stubs and fake completion).
2. Benchmark against known AI coding tool competitors (Devin, Copilot Workspace, Cursor, Aider, SWE-Agent, MetaGPT, GPT-Engineer, Claude Code).
3. Identify gaps: dimensions below 9.0/10 and where competitors lead.
4. Generate a prioritized masterplan (P0/P1/P2 items) with specific forge commands and verify conditions.
5. Save `MASTERPLAN.md` and `masterplan.json` to `.danteforge/`.

This command answers the question: "Is this really done, or are we at 50-60% and just claiming 100%?"

**Harsh penalties applied:**
- Stub/TODO patterns in source files: -10 per file (max -30)
- Fake completion (high % but low maturity): -20
- Test coverage < 70%: -15
- Plateau (score unchanged ±2 for 3+ cycles): -5
- Missing error handling: up to -15

Options:
- `--no-harsh` - Use normal PDSE thresholds instead of harsh mode
- `--no-competitors` - Skip competitor benchmarking (faster)
- `--min-score <n>` - Threshold for "passing" (default: 9.0)
- `--json` - Output machine-readable JSON

After running, use `danteforge self-improve` to execute the masterplan autonomously.

CLI parity: `danteforge assess [--no-harsh] [--no-competitors] [--min-score 9.0] [--json]`
