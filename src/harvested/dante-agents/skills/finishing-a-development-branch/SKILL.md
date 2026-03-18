---
name: finishing-a-development-branch
description: "Use when a feature branch is complete and reviewed. Use when deciding whether to merge, PR, keep, or discard a branch. Use when cleaning up after development."
---
# Finishing a Development Branch — Merge, PR, or Discard

> DanteForge skill module.

## Iron Law

**Tests must pass before any merge.** No exceptions.

## Decision Flow

### Option 1: Merge Directly
- All tests pass
- Code review approved
- Branch is up-to-date with base branch
- Action: `git merge --no-ff <branch>` then delete branch

### Option 2: Create Pull Request
- When team review is needed
- When CI/CD pipeline must validate
- Action: Push branch, create PR with summary (see `requesting-code-review`)

### Option 3: Keep Branch
- When work is paused but not abandoned
- When waiting on dependencies from other branches
- Action: Document status in commit message, leave branch active

### Option 4: Discard Branch
- When the approach was abandoned during brainstorming
- When the code is no longer needed
- Action: Requires typed confirmation ("discard <branch-name>")
- WARNING: This permanently deletes uncommitted work

## Cleanup Steps

After merge or discard:
1. Delete the local branch: `git branch -d <branch>`
2. Delete the remote branch: `git push origin --delete <branch>`
3. Remove the worktree: `git worktree remove <path>`
4. Update DanteForge state: log the action in audit trail

## Red Flags
- Merging with failing tests — fix tests first
- Discarding without confirmation — prevent accidental data loss
- Leaving stale branches indefinitely — creates confusion
- Merging without rebasing/updating from base — creates merge conflicts later
