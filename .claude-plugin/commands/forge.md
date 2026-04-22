---
name: danteforge-forge
description: "Execute GSD waves — build the specified feature or goal using Dante Agents with TDD, parallel execution, and quality gates"
---

# /danteforge-forge — GSD Wave Execution

When the user invokes `/danteforge-forge [goal]`, implement the specified goal using the full DanteForge wave pipeline.

## Execution

```
danteforge forge "your goal here"
danteforge forge "add rate limiting to the API"  --profile quality
danteforge forge "fix the auth bug"              --light   # skip hard gates
danteforge forge "implement search feature"      --worktree  # isolated git worktree
```

## Workflow

1. **Gate check**: Verify PLAN.md or SPEC.md exists (skip with `--light`)
2. **TDD first**: Write failing tests before implementation (if `--profile quality`)
3. **Wave execution**: Implement in phases, making atomic commits with `[DanteForge]` prefix
4. **Verify each task**: Check outputs match acceptance criteria
5. **Score delta**: Run `danteforge score` after to confirm improvement

## Options

- `--profile quality|balanced|budget` — Execution depth (quality = TDD + party mode review)
- `--light` — Skip hard gates (SPEC, PLAN, TESTS not required)
- `--worktree` — Execute in isolated git worktree (safe for large changes)
- `--parallel` — Run tasks in parallel where dependencies allow

## What to Do After

If the goal involves quality improvements, run `/danteforge-verify` to confirm all checks pass, then `/danteforge-score` to measure the delta.

CLI parity: `danteforge forge [goal] [options]`
