---
name: danteforge-ascend
description: "Fully autonomous scoring and self-improving loop — drives all achievable competitive dimensions to 9.0/10 and explains what can't be automated"
---

# /danteforge-ascend — Autonomous Quality Ascent

When the user invokes `/danteforge-ascend [args]`, run the full autonomous improvement loop.

## What It Does

1. **Universe definition** — if no competitive matrix exists, asks 5 questions (or auto-detects) and bootstraps one using WebSearch + competitor analysis
2. **Ceiling classification** — identifies dimensions that cannot be automated past a threshold (e.g. `communityAdoption` can't be pushed past 4/10 via code alone) and announces them upfront
3. **Autonomous improvement loop** — picks the highest-priority achievable dimension, runs a targeted improvement cycle, re-scores, and repeats until all achievable dimensions hit the target
4. **Ceiling report** — when done, explains every ceiling dimension with the specific manual action required to go further

## Execution

```bash
danteforge ascend                      # drive all achievable dims to 9.0/10
danteforge ascend --target 8.5         # custom target score
danteforge ascend --max-cycles 50      # allow more cycles for large gaps
danteforge ascend --interactive        # ask 5 questions to define universe first (TTY required)
danteforge ascend --dry-run            # show plan and ceiling report without executing
```

## When to Use

- **New project after `danteforge init`** — run to define the competitive universe and begin autonomous improvement from day 1
- **Existing project with matrix** — run to resume autonomous improvement toward target from current state
- **After a sprint** — run to continue until all achievable dimensions hit target, then stop
- **Cross-project** — run on DanteAgents, DanteCode, or any project that has a `.danteforge/compete/matrix.json`

## Ceiling Behavior

Some dimensions cannot reach 9+ via automation:

| Dimension | Ceiling | Why |
|-----------|---------|-----|
| `communityAdoption` | 4.0/10 | Requires npm downloads, GitHub stars, external contributors |
| `enterpriseReadiness` | 6.0/10 | Requires real production deployments and customer validation |

The command announces these upfront, skips them in the loop, and prints specific manual actions at the end.

## Output

```
[Ascend] Ceiling dimensions (skipped):
  Community Adoption: 2.0/10 (ceiling: 4.0/10) — requires npm downloads, GitHub stars...

[Ascend] Cycle 1/30 — targeting: Developer Experience
  Goal: Improve Developer Experience from 5.5/10 toward 9.0/10 (harvest from Aider)
  Result: Developer Experience 5.5 → 6.8 (+1.3)

...

[Ascend] SUCCESS — all achievable dimensions at 9.0/10 or above.

[Ascend] Ceiling dimensions require manual action:
  Community Adoption: Publish to npm, promote the project, attract contributors via README + examples.

Report saved: .danteforge/ASCEND_REPORT.md
```

CLI parity: `danteforge ascend [--target N] [--max-cycles N] [--interactive] [--dry-run]`
