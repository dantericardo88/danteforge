---
name: build
description: Guided spec-to-ship wizard — runs the full pipeline from goal statement to scored output.
---

# /build — Spec-to-Ship Wizard

Turn a goal statement into a shipped, scored project by running the full DanteForge pipeline.

## Usage

```
danteforge build "create a REST API with auth and rate limiting"
danteforge build "add a plugin system to the CLI" --interactive
```

## Pipeline Stages

| Stage | File Created | Description |
|-------|-------------|-------------|
| constitution | CONSTITUTION.md | Project values and constraints |
| specify | SPEC.md | Structured requirements |
| clarify | CLARIFY.md | Resolved ambiguities |
| plan | PLAN.md | Execution waves |
| tasks | TASKS.md | Concrete task breakdown |
| forge | src/ | Implementation |
| verify | — | Tests and quality gates |
| score | — | Final measurement |

Already-completed stages are auto-detected and skipped.

## Flags

- `--interactive` — confirm before each stage (Y/n)

## Output

```
  Build: "create a REST API with auth"
  Entry score: 6.2/10

  Pipeline:
    [SKIP] constitution — define project values and constraints
    [SKIP] specify — write structured requirements
    [RUN]  clarify — resolve ambiguities
    ...

  Exit score: 7.8/10  (+1.6 from baseline)
```

CLI parity: `danteforge build <spec>`
