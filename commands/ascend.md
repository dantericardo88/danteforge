---
name: ascend
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

## Depth Doctrine — Wave Rhythm (MANDATORY)

Ascend cycles MUST alternate breadth and depth waves:

- **Odd cycles (1, 3, 5…): BREADTH WAVE**
  - Goal: write new modules + unit tests
  - Score ceiling for this wave: **6**
  - Every new module MUST answer before completing:
    1. What production `src/` function calls this? (not a test)
    2. What is the observable output artifact?
    3. What breaks silently if this fails?
  - If answer 1 is "nothing yet" → `orphan-pending`, ceiling 5

- **Even cycles (2, 4, 6…): DEPTH WAVE**
  - Goal: run outcomes to produce receipts, lift score ceiling
  - Command: `danteforge validate <dimId>` (or `--all`)
  - Score unlocked: up to 9 (via OutcomeEvidenceEntry passed=true)
  - No new production code in depth waves — run things, write receipts

**Zero tolerance: No mocks. No stubs. No TODOs in `src/` files.**
The pre-commit hook blocks these patterns. Implement real code or leave it unimplemented.

**Score tiers (structurally enforced, cannot be gamed):**
- ≤5.0: code exists, tests pass
- ≤7.0: production callsite wired (harden orphan check)
- ≤8.5: receipt on disk (`danteforge validate` passed)
- ≤9.5: receipt fresh ≤ 7 days

## Ceiling Behavior

Some dimensions cannot reach 9+ via automation:

| Dimension | Ceiling | Why |
|-----------|---------|-----|
| `communityAdoption` | 4.0/10 | Requires npm downloads, GitHub stars, external contributors |
| `enterpriseReadiness` | 6.0/10 | Requires real production deployments and customer validation |

The command announces these upfront, skips them in the loop, and prints specific manual actions at the end.

## Agent Anti-Bloat Guard

Every autonomous cycle must target one workstream from
`.danteforge/agent-ownership.json`. Before score updates or code changes, create
an ephemeral claim under `.danteforge/agent-claims/`. Before accepting a cycle,
run:

```bash
node scripts/check-agent-guard.mjs --staged --workstream <workstream>
```

Score movement must satisfy the atomic groups in `.danteforge/agent-guard.json`.
If the guard blocks a frozen file, create a separate platform-kernel cycle that
adds an extension point, then retry the dimension cycle through that extension.

For concurrent score updates, `ascend` must queue a proposal instead of rewriting
the matrix directly:

```bash
npm run dimension:ascent -- propose --dimension <id-or-number> --score <n> --agent ascend --rationale "<evidence>"
npm run dimension:ascent -- merge --policy harsh-min --agent ascend
```

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
