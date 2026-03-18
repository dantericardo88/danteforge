---
name: danteforge-cli
description: "Use when the user explicitly asks to run DanteForge through the terminal CLI, or when native workflow command files are unavailable and CLI parity matters. In Codex repos that ship `commands/*.md`, prefer native workflow slash-command behavior for `/autoforge`, `/party`, `/magic`, and related commands."
---
# DanteForge CLI

> DanteForge skill module.

## When To Use This Skill

- The user explicitly asks to run `danteforge ...` commands in the terminal
- Native workflow command files are unavailable and you need CLI parity
- You are validating CLI behavior, operator docs, packaging, or install/setup flows

## Default Behavior

Prefer running the DanteForge CLI directly only in those cases.

If Codex is operating in a repo or user environment that provides native workflow command files (`commands/*.md` or `~/.codex/commands/*.md`), let `/autoforge`, `/party`, `/magic`, and related workflow commands execute natively in the workspace instead of routing through the CLI.

- `danteforge autoforge [goal]`
- `danteforge party`
- `danteforge magic "<idea>"`
- `danteforge review`
- `danteforge verify`

Do not manually reconstruct the workflow if the user asked for the CLI and the CLI can do it for you.

## Core Workflow

When the user wants the standard DanteForge pipeline, use these commands in order:

1. `danteforge review`
2. `danteforge constitution`
3. `danteforge specify "<idea>"`
4. `danteforge clarify`
5. `danteforge tech-decide`
6. `danteforge plan`
7. `danteforge tasks`
8. `danteforge design "<prompt>"` when the project needs UI design artifacts
9. `danteforge forge`
10. `danteforge ux-refine`
11. `danteforge verify`
12. `danteforge synthesize`

## Automation Commands

- `danteforge autoforge [goal]` for deterministic auto-orchestration
- `danteforge autoforge --dry-run` to inspect the next steps safely
- `danteforge autoforge --score-only` to score current artifacts without execution
- `danteforge autoforge --auto` to run the autonomous loop
- `danteforge party --worktree --isolation` for multi-agent collaboration
- `danteforge magic "<idea>"` for one-click pipeline execution

## Failure Mode

If the CLI fails, report the real command failure, inspect the generated artifacts, and only then fall back to manual help.
