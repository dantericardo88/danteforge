---
name: danteforge-specify
description: "Generate a structured SPEC.md from a project idea — clarifies requirements, defines acceptance criteria, and produces a machine-readable spec"
---

# /danteforge-specify — Generate Project Spec

When the user invokes `/danteforge-specify [idea]`, generate a structured `SPEC.md` in `.danteforge/`.

## Execution

```
danteforge specify "a CLI tool that manages project todos"
danteforge specify "improve the authentication module"  # can specify subsystem
danteforge specify                                      # interactive clarification mode
```

## What It Generates

A `SPEC.md` file with:

1. **Problem statement** — what the system does and why
2. **User stories** — concrete use cases with acceptance criteria
3. **Functional requirements** — numbered, testable requirements
4. **Out of scope** — explicit exclusions (prevents scope creep)
5. **Tech constraints** — language, framework, compatibility requirements
6. **Success metrics** — measurable outcomes (coverage %, response time, etc.)

## Clarification Process

If the idea is ambiguous, `specify` runs an interactive clarification loop asking targeted questions before generating the spec. Use `--no-clarify` to skip this.

## Workflow Context

```
/danteforge-specify → /danteforge-plan → /danteforge-tasks → /danteforge-forge
```

The spec is the contract. Every subsequent step (plan, forge, verify) checks back against it.

CLI parity: `danteforge specify [idea] [--no-clarify]`
