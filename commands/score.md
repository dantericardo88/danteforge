---
name: score
description: Fast project score — one number + 3 P0 action items in under 5 seconds. No LLM required.
---

# /score — Fast Project Score

Run `danteforge score` to get a single quality score + the 3 highest-priority gaps to fix.

## Usage

```
danteforge score          # quick score + 3 P0 items
danteforge score --full   # all 19 dimensions (same as assess)
```

## Output

```
  7.4/10  — needs-work  (▲ +0.2 today)

  P0 gaps:
  1. security (3.0)       → danteforge forge "add input validation and CSP headers"
  2. performance (2.5)    → danteforge forge "add incremental caching"
  3. communityAdoption (1.5) → npm publish && danteforge showcase

  PRIME.md updated.
```

## Flywheel

Score auto-updates `.danteforge/PRIME.md` so Claude Code picks up the latest state in the next session.

CLI parity: `danteforge score`
