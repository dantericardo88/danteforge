---
name: autoforge
description: "Deterministic auto-orchestration — score artifacts, plan next steps, execute pipeline"
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
