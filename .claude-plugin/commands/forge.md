---
name: danteforge-forge
description: "Execute GSD waves — build the specified feature or goal using Dante Agents with TDD, parallel execution, and quality gates"
---

# /danteforge-forge — GSD Wave Execution

When the user invokes `/danteforge-forge [goal]`, implement the specified goal using the full DanteForge wave pipeline.

## Convergence Gate — TypeScript Owns This Decision

After EVERY implementation wave, run:
```
danteforge converge --check-only --target 9.0
```
- Exit **0** → all dimensions pass, you MAY stop
- Exit **1** → one or more below target, run `danteforge converge --target 9.0` to continue the loop automatically

Do NOT self-score. Do NOT estimate. Do NOT make the stop/continue decision yourself.
`converge` reads real filesystem scores with no LLM involvement — it is the only valid termination oracle.

## Code Quality Constraints (enforced — applies to ALL projects)

**File size limit:** Every file you create or modify must stay under **500 non-blank LOC** (ideal) / **750 LOC hard cap**.
- If a module would exceed 500 LOC, split it: `foo.ts` â†’ `foo.ts` + `foo-types.ts` + `foo-utils.ts`
- Never write a single file exceeding 750 LOC — LLMs make structural mistakes (missing imports, wrong scope, stale references) at this size
- This applies to TypeScript, JavaScript, Python, and any other source language

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
