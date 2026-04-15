---
name: danteforge-import-patterns
description: "Import an external pattern bundle — runs Bayesian shrinkage and implausibility quarantine before adopting patterns"
---

# /import-patterns — Import External Pattern Bundle

When the user invokes `/import-patterns`, import a pattern bundle from another DanteForge project
with automatic trust scoring and quarantine filtering.

1. **Load bundle**: Read the specified bundle file (`.danteforge/pattern-bundle.json` by default)
2. **Trust scoring**: Apply Bayesian shrinkage — high-delta claims with small sample counts are
   automatically discounted (`shrunk = (observed × n + priorMean × k) / (n + k)`)
3. **Implausibility quarantine**: Flag patterns with `implausible-delta`, `tiny-sample`,
   `low-verify-rate`, or `zero-delta` for quarantine — they are NOT imported
4. **Adopt approved patterns**: Write approved patterns to the local attribution log with
   `source: 'imported'` and the trust score attached
5. **Report**: Show how many patterns were approved vs quarantined, and the quarantine reasons

## When to use this
- After receiving a bundle file from a collaborator's `/share-patterns` export
- When setting up a new project that should inherit patterns from a related codebase
- When onboarding into a team that already has validated patterns

## Output
- Patterns approved and imported: N
- Patterns quarantined: N (with reasons)
- Trust scores applied (Bayesian shrinkage discount)
- Bundle path used

Options:
- `<bundle-file>` — path to the `.json` bundle to import (default: `.danteforge/pattern-bundle.json`)
- `--trust-threshold <score>` — Minimum trust score to accept (default: 0.5)

CLI parity: `danteforge import-patterns [bundle-file] [--trust-threshold 0.5]`
