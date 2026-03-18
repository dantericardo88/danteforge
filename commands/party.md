---
name: party
description: "Launch Dante Party Mode — multi-agent collaboration with isolated worktrees"
---

# /party — Dante Party Mode

When the user invokes `/party`, follow this workflow:

1. **Activate agents**: PM, Architect, Dev, UX, Scrum Master
2. **Determine scale**: light / standard / deep based on project complexity
3. **Worktree isolation** (if `--worktree`): Create separate worktree per agent
4. **Orchestrate**: Each agent contributes their expertise:
   - PM: Task prioritization and scope
   - Architect: Technical design and dependencies
   - Dev: Implementation and testing
   - UX: Frontend patterns and accessibility
   - Scrum Master: Process enforcement
5. **Two-stage review**: Spec compliance, then code quality
6. **Merge results**: Combine agent outputs, resolve conflicts

Use the `subagent-driven-development` skill for dispatch and review.
Use the `using-git-worktrees` skill for worktree isolation.
