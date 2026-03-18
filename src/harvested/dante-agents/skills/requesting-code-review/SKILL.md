---
name: requesting-code-review
description: "Use when code is ready for review before merging. Use when a development task is complete and needs quality verification. Use when preparing a PR or merge request."
---
# Requesting Code Review — Pre-Merge Quality Gate

> DanteForge skill module.

## Iron Law

**No merge without review.** All code must pass review before reaching the main branch.

## Review Request Checklist

Before requesting review, confirm:
- [ ] All tests pass (run full test suite, not just new tests)
- [ ] Code builds without warnings
- [ ] Linter passes with no new warnings
- [ ] Commit messages are descriptive and follow project conventions
- [ ] No temporary debug code left (console.log, TODO hacks, commented-out code)
- [ ] New code has appropriate test coverage

## Review Request Format

Provide the reviewer with:
1. **Summary** — What changed and why (2-3 sentences)
2. **Files changed** — List of modified/added/deleted files
3. **Testing** — How the changes were tested
4. **Risks** — Known risks or areas of concern
5. **Screenshots** — If UI changes are involved

## Review Response Handling
- **Approved** — Proceed to merge (see `finishing-a-development-branch`)
- **Changes requested** — Address all feedback, re-request review
- **Questions** — Answer before proceeding

## Red Flags
- "It works on my machine" — ensure CI passes
- Requesting review on untested code — test first
- Ignoring review feedback — address every comment
- Self-approving without external review — get another pair of eyes
