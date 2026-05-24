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
  - Commands (in order):
    1. `danteforge validate <dimId> --force-cold` — write `OutcomeEvidenceEntry` receipts
    2. `node scripts/evidence-rescore.mjs` — compute evidence-derived score from receipts
    3. Fix A gate: run `<capability_test.command>` — if exit ≠ 0 AND score > 5.0, **clamp to 5.0**
    4. Perform outcome triage: distinguish genuine gaps from outcome definition bugs (see below)
    5. Emit Time Machine commit before writing score (Rule 13)
  - Score unlocked: up to 9 (via OutcomeEvidenceEntry passed=true, ≥3 T5+ outcomes for T7)
  - No new production code in depth waves — run things, write receipts

### Depth wave outcome triage (Rule 11)

When an outcome command fails during a depth wave, determine root cause **before reducing the score**:

**(a) Genuine capability gap** — code or integration is missing/broken
→ Reduces dimension score, appears in the priority ranking

**(b) Outcome definition bug** — wrong file path, wrong keyword, wrong expectation
→ Flag in `OUTCOME_BUGS` section, do NOT penalize score, fix the outcome definition, re-run

**(c) Bootstrapping dependency** — outcome checks for artifacts produced by the scoring system itself (e.g., `outcome-evidence/` files exist)
→ Flag in `BOOTSTRAP_DEPS` section, score on all other passing outcomes, fix = run `danteforge validate`, not write new code

### Fix A gate — capability_test (Rule 10, MANDATORY in every depth wave)

For any dimension with a declared `capability_test` field:
- Run the `capability_test.command` shell command
- If exit code ≠ 0 AND evidence-derived score > 5.0 → **clamp reported score to 5.0**
- Outcomes passing does NOT override a failing `capability_test`
- Record: `{ outcome_derived, capped: 5.0, capability_test_command, capability_test_output, reason: "FIX_A" }`
- Do NOT advance to the next cycle or declare the dim at ceiling — fix the capability_test failure first

### Zero-evidence fallback (Rule 9)

Before every depth wave, check evidence count:
```bash
node scripts/evidence-rescore.mjs --dry-run 2>&1 | grep "evidence entries:"
```

If 0 evidence entries: run every outcome command directly, compute tier score from raw pass/fail. Report that the pipeline has never run end-to-end. Scores above 5.0 are not defensible until `danteforge validate` produces at least one receipt per dimension.

### Time Machine (Rule 13, MANDATORY per cycle)

Every depth wave cycle MUST emit a Time Machine causal commit:
```typescript
await createTimeMachineCommit({
  gitSha, dimensionId, scoreBefore, scoreAfter,
  outcomesPassed, capabilityTestResult,
  agentLabel: 'ascend',
});
```
If `createTimeMachineCommit` fails, do NOT write the score — log `PROVENANCE_MISSING` and retry.

**Zero tolerance: No mocks. No stubs. No TODOs in `src/` files.**
The pre-commit hook blocks these patterns. Implement real code or leave it unimplemented.

**Score tiers (structurally enforced, cannot be gamed):**
- ≤5.0: code exists, tests pass
- ≤7.0: production callsite wired (harden orphan check)
- ≤8.0: T5 receipt on disk (`danteforge validate` passed with T5 outcome)
- ≤8.5: T6 telemetry outcome passing
- ≤9.0: T7 — ≥3 T5+ outcomes ALL passing, receipts ≤ 7 days (MIN_T7_HIGH_TIER_OUTCOMES = 3)
- ≤9.5: T8 — all outcomes fresh ≤ 24h

**Fix A overrides all tiers**: a dimension whose `capability_test` exits non-zero is capped at 5.0 regardless of outcome evidence. Fix the code or the test first.

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

## Scoring doctrine reference

All 13 rules from `src/core/scoring-doctrine.ts` apply. Key rules for this loop:
- **Rule 1**: Evidence only — no opinions, gut feel, or hardcoded numbers
- **Rule 4**: No adoption penalty on pre-release tools
- **Rule 8**: Scores above 7.0 require runtime execution evidence (cli-smoke, runtime-exec, e2e-workflow)
- **Rule 9**: Zero-evidence fallback — run outcomes manually if evidence-rescore finds 0 entries
- **Rule 10**: Fix A — capability_test failure caps at 5.0
- **Rule 11**: Outcome triage before scoring — genuine gaps vs. definition bugs
- **Rule 12**: Bootstrapping deps flagged separately, not scored as gaps
- **Rule 13**: Time Machine commit required before every score write

CLI parity: `danteforge ascend [--target N] [--max-cycles N] [--interactive] [--dry-run]`
