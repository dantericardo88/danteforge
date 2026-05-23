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
2. **Zero-evidence check (Rule 9)**: check whether `.danteforge/outcome-evidence/` is empty or absent
   - If empty: report "Evidence pipeline has never run. Scores above 5.0 not defensible."
   - This is a real finding — surface it prominently, then proceed to generate the first receipts
3. Run all outcomes via shell commands (or built-in checks like production-usage-fresh)
4. **Outcome triage (Rule 11)**: for each failing outcome, classify before scoring:
   - **(a) Genuine capability gap** — reduces score, appears in gap list
   - **(b) Outcome definition bug** — wrong path/keyword/expectation → flag in `OUTCOME_BUGS`, no score penalty, fix the definition
   - **(c) Bootstrapping dependency** — outcome checks artifacts produced by validate itself → flag in `BOOTSTRAP_DEPS`, score on all other outcomes
5. Write `OutcomeEvidenceEntry` receipts to `.danteforge/outcome-evidence/`
6. **Run evidence-rescore** to update matrix with evidence-derived scores:
   ```bash
   node scripts/evidence-rescore.mjs
   ```
7. **Fix A gate (Rule 10)**: for every dimension with a `capability_test`:
   - Run the `capability_test.command`
   - If exit ≠ 0 AND evidence-derived score > 5.0 → **clamp to 5.0** (overrides all outcome evidence)
   - Record the capability_test output as a receipt
8. Report before/after score changes, which ceilings were lifted, and Fix A clamps applied
9. **Emit a Time Machine commit (Rule 13, MANDATORY)**:
   ```typescript
   await createTimeMachineCommit({
     gitSha, dimensionId, scoreBefore, scoreAfter,
     outcomesPassed, capabilityTestResult,
     agentLabel: 'validate',
   });
   ```
   If Time Machine commit fails → do NOT write updated scores — log `PROVENANCE_MISSING`

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

## Triage report format

```
OUTCOME_BUGS (not scored as gaps — fix the outcome definition):
  [dim: mcp_integration] "mcp_plugin_manifest" — wrong path: .claude/plugin.json → actual: .claude-plugin/plugin.json

BOOTSTRAP_DEPS (run danteforge validate, not new code):
  [dim: depth_doctrine] "evidence_receipts" — checks outcome-evidence/ which validate itself produces

GENUINE_GAPS (scored, appear in priority ranking):
  [dim: maintainability] capability_test FAIL (hardener.ts 904 LOC > 750) → score clamped 9.0 → 5.0
  [dim: mcp_integration] "mcp_server_module" — mcp-adapter.ts missing Tool registration

FIX_A CLAMPS (capability_test failures):
  maintainability: 9.0 → 5.0 (capability_test exit 1)
```

## Scoring doctrine reference

Key rules from `src/core/scoring-doctrine.ts` that validate enforces:
- **Rule 7**: Receipts required — every score must trace to an artifact
- **Rule 8**: Scores above 7.0 require runtime execution evidence
- **Rule 9**: Zero-evidence fallback — report bootstrap state when evidence-rescore finds 0 entries
- **Rule 10**: Fix A — capability_test failure hard-caps at 5.0
- **Rule 11**: Triage outcome failures before scoring
- **Rule 12**: Flag bootstrapping deps separately from genuine gaps
- **Rule 13**: Time Machine commit MANDATORY before score writes

CLI parity: `danteforge validate [dimId] [--all] [--quick] [--force-cold] [--json]`
