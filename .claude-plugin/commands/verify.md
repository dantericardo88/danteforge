---
name: danteforge-verify
description: "Run the full verification suite — typecheck, lint, tests, artifact completeness, and acceptance criteria. The hard gate before synthesis."
---

# /danteforge-verify — Project Verification

When the user invokes `/danteforge-verify`, run the complete verification pipeline.

## Execution

```
danteforge verify            # full verification suite
danteforge verify --release  # + build/pack/install smoke tests
danteforge verify --light    # skip artifact completeness gates
```

## What It Checks

1. **TypeScript**: `tsc --noEmit` — zero type errors required
2. **Lint**: ESLint — zero errors (warnings allowed)
3. **Tests**: Full test suite — zero failures
4. **Artifacts**: SPEC, PLAN, TASKS present and internally consistent
5. **Acceptance criteria**: Tasks in TASKS.md marked done have evidence
6. **Release gates** (with `--release`): build, pack, install smoke test

## Output

Writes a verification receipt to `.danteforge/evidence/verify/latest.json` with:
- Pass/fail per check
- SHA of the verified commit
- Timestamp

## Workflow Context

```
/danteforge-forge → /danteforge-verify → /danteforge-synthesize
```

Verification is the gate between "I think it works" and "it's confirmed working."

## On Failure

If any check fails, verify lists the specific issues. Fix them, then re-run. Do not proceed to `/danteforge-synthesize` until verify passes.

CLI parity: `danteforge verify [--release] [--light]`
