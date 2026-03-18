---
name: subagent-driven-development
description: "Use when dispatching work to sub-agents. Use when breaking a large task into independent units that different agents can execute. Use when orchestrating parallel development."
---
# Subagent-Driven Development — Task Dispatch + Review

> DanteForge skill module.

## Iron Law

**Every sub-agent task gets a two-stage review**: spec compliance, then code quality.

## Dispatch Process

### 1. Task Definition
Each sub-agent receives:
- **Clear scope** — exactly what to build/change (file paths, function signatures)
- **Acceptance criteria** — how to know it's done
- **Constraints** — what NOT to change, dependencies to respect
- **Worktree assignment** — isolated workspace (see `using-git-worktrees` skill)

### 2. Agent Execution
- Agent works in its assigned worktree
- Agent follows TDD (see `test-driven-development` skill)
- Agent commits with descriptive messages prefixed `[DanteForge:<agent>]`

### 3. Two-Stage Review

**Stage 1: Spec Compliance**
- Does the output match the task definition?
- Are all acceptance criteria met?
- Were constraints respected?

**Stage 2: Code Quality**
- Are tests passing?
- Is the code clean and consistent with project patterns?
- Are there any security or performance concerns?

### 4. Merge or Reject
- If both stages pass: merge agent branch
- If stage 1 fails: return to agent with specific feedback
- If stage 2 fails: return for refactoring (don't merge messy code)

## Agent Roles (DanteForge Dante Agents)
- **PM** — Task prioritization and scope definition
- **Architect** — Technical design and dependency mapping
- **Dev** — Implementation and testing
- **UX** — Frontend patterns and accessibility
- **Scrum Master** — Process enforcement and blockers removal

## Red Flags
- Dispatching without clear scope — agent will build the wrong thing
- Skipping review stages — bugs and inconsistencies will accumulate
- Multiple agents in the same worktree — conflicts guaranteed
- Agent modifying files outside its scope — scope creep
