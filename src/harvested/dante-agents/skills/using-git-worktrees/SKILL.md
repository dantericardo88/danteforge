---
name: using-git-worktrees
description: "Use when running parallel agents. Use when isolating work on a feature branch. Use when party mode dispatches multiple agents. Use when you need to work on something without affecting the main branch."
---
# Using Git Worktrees — Isolated Parallel Workspaces

> DanteForge skill module.

## Iron Law

**Parallel agents MUST work in separate worktrees.** Never let multiple agents modify the same working directory.

## What Are Worktrees?

Git worktrees create isolated copies of a repository that share the same `.git` directory. Each worktree has its own branch and working directory, so agents can work in parallel without conflicts.

## Setup Workflow

### 1. Choose Location
- Preferred: `.danteforge-worktrees/` in the parent directory
- Alternative: `worktrees/` in the project root
- MUST be git-ignored to prevent accidental commits

### 2. Create Worktree
```bash
git worktree add ../.danteforge-worktrees/<agent-name> -b danteforge/<agent-name>
```

### 3. Verify Clean State
- Install dependencies in the worktree (npm ci / pip install / etc.)
- Run baseline tests to confirm clean state
- Report location and readiness

### 4. Work in Isolation
- Each agent operates only in its assigned worktree
- Changes are committed to the agent's branch
- No cross-worktree file access

### 5. Merge Back
- After agent completes, review changes
- Merge agent branch back to the base branch
- Remove the worktree when done

## Safety Requirements
- Worktree directories MUST be in `.gitignore`
- If not already ignored, add and commit the `.gitignore` change first
- Never commit worktree artifacts to the main repo

## Integration with DanteForge
- `danteforge party` auto-creates worktrees for each Dante Agent
- `danteforge forge --worktree` runs execution in an isolated worktree
- Worktrees are cleaned up automatically after successful merge

## Red Flags
- Working in main directory during parallel execution — use worktrees
- Forgetting to gitignore worktree directories — artifacts will pollute the repo
- Skipping dependency install in worktree — tests will fail with missing deps
- Not running baseline tests before starting work — can't distinguish new bugs from existing ones
