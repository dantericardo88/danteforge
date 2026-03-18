---
name: ship
description: "Paranoid release guidance - review, version bump plan, changelog draft"
---

# /ship - Release Guidance

When the user invokes `/ship`, follow this workflow:

1. **Paranoid review**: Run all verification checks plus release-specific checks:
   - `npm run verify` passes
   - `npm run build` succeeds
   - `npm run check:cli-smoke` passes
   - `npm run check:repo-hygiene` passes
   - `npm run check:third-party-notices` passes
2. **Version bump plan**: Determine semver bump guidance from the current release delta
3. **CHANGELOG draft**: Generate a changelog entry from commit history
4. **Commit guidance**: Propose bisectable commit groups for the current release delta
5. **Manual next step**: Tell the operator what to do next. Do not claim a PR was opened or a version was changed unless it really happened in this workspace.

Options:
- `--dry-run` - Run all checks and generate guidance without changing the audit intent
- `--skip-review` - Skip pre-landing review (emergency only, logged to audit)

Use the `requesting-code-review` skill for pre-merge quality gate.
Use the `finishing-a-development-branch` skill for merge/PR decisions.

CLI fallback: `danteforge ship`
