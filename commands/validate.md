---
name: validate
description: "Depth Doctrine receipt runner — run dimension outcomes and prove the code actually works"
---

# /validate — Depth Doctrine Receipt Runner

## Depth Doctrine (MANDATORY)

**This is the DEPTH command.** It produces receipts that lift score ceilings.
Until `danteforge validate <dim>` passes, the dimension is structurally capped at 7.0.

**Code without a receipt is a hypothesis, not a feature.**

When the user invokes `/validate`, run the outcome validation:

1. Load the competitive matrix and find dimensions with declared outcomes
2. Run all outcomes via shell commands (or built-in checks like production-usage-fresh)
3. Write `OutcomeEvidenceEntry` receipts to `.danteforge/outcome-evidence/`
4. Report before/after score changes and which ceilings were lifted
5. Emit a Time Machine commit for audit trail

## Usage

```bash
danteforge validate <dimId>              # Run outcomes for one dimension
danteforge validate --all               # Run outcomes for all dimensions
danteforge validate <dimId> --quick     # Run only T1/T2 outcomes (fast check)
danteforge validate <dimId> --force-cold # Bypass cache, re-execute everything
danteforge validate --all --json        # Machine-readable output for CI
```

## Score Tiers Unlocked by Validation

| Before | After Validation | What Changed |
|---|---|---|
| ≤7.0 (no outcomes) | Still ≤7.0 | Must declare outcomes first |
| ≤7.0 (outcomes declared) | Up to 8.0 | T5 outcomes passing |
| 8.0 | Up to 8.5 | T6 telemetry outcomes passing |
| 8.5 | Up to 9.0 | T7: 3+ T5+ outcomes ALL passing |
| 9.0 | Up to 9.5 | T8: all outcomes fresh (≤24h) |

## CI Gate

This command exits 1 if any outcome fails. Use in CI:

```yaml
- run: danteforge validate --all --json
```

## When to Use

- **After a breadth wave** — validate what was just forged
- **In depth waves** — this IS the depth wave (orchestration loops call it automatically)
- **Before shipping** — prove every dimension's code actually runs
- **In CI** — gate merges on passing outcomes

CLI parity: `danteforge validate [dimId] [--all] [--quick] [--force-cold] [--json]`
