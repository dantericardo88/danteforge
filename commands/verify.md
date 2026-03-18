---
name: verify
description: "Run verification checks — validate project state, artifacts, tests, and builds"
---

# /verify — Project Verification

When the user invokes `/verify`, follow this workflow:

1. **Run checks**: Execute the verification suite:
   - Typecheck (`tsc --noEmit`)
   - Lint (`eslint`)
   - Tests (`tsx --test`)
   - Artifact completeness (SPEC, PLAN, TASKS present and consistent)
   - Acceptance criteria from TASKS.md are met
2. **Report results**: Show pass/fail for each check with specific failure details
3. **Score**: Calculate verification score and update STATE.yaml
4. **Next step**: If passing, suggest `/synthesize`. If failing, list specific issues to fix.

Options:
- `--release` — Include release/build/package verification checks
- `--live` — Run live browser checks on deployed app
- `--url <url>` — URL to verify against (requires --live)

CLI fallback: `danteforge verify`
