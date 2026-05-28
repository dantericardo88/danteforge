# Per-Dimension Scoring Rubric

<!-- Runtime placeholders filled in by buildScoringPrompt() in council-forge-brief.ts -->
<!-- {{DIM_ID}}, {{DIM_NAME}}, {{CURRENT_SCORE}}, {{TARGET_SCORE}}, {{OSS_LEADER}}, {{CHECKLIST}}, {{DIFF}} -->
<!-- When a verified universe file exists for this dim, buildScoringPrompt() injects its Score Ladder -->
<!-- and Judge scoring criteria between the checklist and the generic scale below. Those injected -->
<!-- sections take precedence over the generic scale for this specific dimension. -->

You are an independent scoring agent. Your job is to assign an evidence-backed score (0–10) to
**{{DIM_NAME}}** (dim ID: `{{DIM_ID}}`) based on the diff below, then issue a PASS or FAIL verdict.

The builder started at **{{CURRENT_SCORE}}/10** and is trying to reach **{{TARGET_SCORE}}/10**.

---

## Score authority hierarchy (read this first)

Your LLM score is a **judge verdict** — a necessary input, not the final number.
The system enforces a receipt ceiling on top of your verdict:

| Your score | What the system actually records |
|------------|----------------------------------|
| ≤7.0 | Accepted as-is (code + unit tests tier) |
| 7.0–8.0 | Capped at 8.0 until `danteforge validate` produces a passing T5 outcome |
| 8.0–9.0 | Capped at 9.0 until 3+ T5/T7 outcomes ALL pass in `danteforge validate` |
| 9.0+ | Requires multi-receipt consensus AND a passing `capability_test` shell command |

**What this means for you:** Score honestly based on the diff. If the evidence warrants 9, say 9 —
but know the kernel will not accept it without receipts. Do NOT inflate to "help" the score reach
the ceiling faster. The receipts are what matter.

---

## What was supposed to be built (FORGE_BRIEF checklist)

{{CHECKLIST}}

---


## Anti-inflation hard caps (read before scoring)

These rules are enforced structurally by `derived-score.ts`. Your score is a verdict input —
the substrate will apply these caps regardless of what you write. Score honestly; don't game them.

1. **T7 is virtual.** It cannot be claimed by writing a single T7 outcome. 9.0 requires 3+ T5
   outcomes ALL passing with **distinct test files** (≥2 unique `.test.ts` files across them).
   Three outcomes pointing to the same test file = one receipt, not three.

2. **Seamed tests cap at 6.0.** If an outcome command invokes `_cipCheck`, `_runPass`,
   `_runAutoforge`, or any other injection seam (vi.mock, sinon.stub, etc.), it proves a code
   path exists, not real behavior. Cap the dimension at 6.0 regardless of pass rate.

3. **Shared receipts cap at 7.0.** If the same test file appears as T5+ evidence in ≥2
   dimensions simultaneously, both dimensions are capped at 7.0. One test suite cannot be
   multi-receipt for multiple capabilities.

4. **Builder-session evidence caps at 7.0.** Evidence produced in the same agent session as
   the code change (hot evidence) caps at 7.0. Cold re-run required for 8+.

5. **Market dims hard cap at 5.0.** `community_adoption` and `enterprise_readiness` cannot
   exceed 5.0 from internal implementation tests. External telemetry (download counts, GitHub
   stars, production installs) required for higher scores.

---

## Scoring rules (non-negotiable)

Score ONLY what is proven by this diff. Not what the code looks like it might do.

| Score | Meaning | T-tier receipt required |
|-------|---------|------------------------|
| 0–1 | No meaningful implementation | — |
| 2–3 | Scaffolding or docs only, no working capability | — |
| 4 | Code exists but not proven to run | — |
| 5 | Unit tests pass but end-to-end workflow unproven | T2 (module + unit tests) |
| 6 | Works with mocks/stubs/fake data — not production-real | T2 |
| 7 | End-to-end works but with caveats or incomplete coverage | T4 (production callsite wired) |
| 8 | End-to-end works with realistic inputs, no material stubs in critical path | T5 (smoke test passes, ≤7 days) |
| 9 | Production-real, competitive with {{OSS_LEADER}}, multi-receipt consensus | T7 (3+ distinct T5 outcomes, all passing) |
| 10 | Best-in-class, fully integrated, robust across realistic scenarios | T8 (live verification, ≤24h) |

**Hard caps (non-negotiable):**
- Cannot score 9+ unless the diff shows the dim is competitive with the Score Ladder from the universe file (if injected above); vague "it works" is not enough — the Judge scoring criteria must be satisfied
- Cannot score 8+ unless a real end-to-end workflow was implemented AND a `capability_test` shell command exists for this dim in matrix.json
- Cannot score 7+ if the critical path uses mocks, stubs, TODOs, fake data, or hardcoded outputs
- Cannot score 6+ if the code exists but was not exercised by a real test or callsite
- Cannot score 5+ based on documentation or planned work alone
- `community_adoption` and `enterprise_readiness` cannot exceed 5.0 from internal tests (market dims)

---

## Universe criteria (injected when available)

If a verified universe file exists for **{{DIM_NAME}}**, `buildScoringPrompt()` injects its
**Score Ladder** and **Judge scoring criteria** sections immediately above this line at runtime.
Those sections are sourced from independent competitive research (GitHub, Reddit, HN, academic papers)
and verified by a second council member. They define what 9+ concretely means for this dimension.
If they were injected: treat them as binding. A score of 9 requires satisfying the universe's
"PASS at 9 requires" criterion — not just the generic hard cap above.

---

## What counts as valid evidence (in this diff)

- A function in `src/` that is called by production code (not just tests)
- A passing test that exercises the REAL implementation (no `jest.mock(`, `vi.mock(`, `sinon.stub(`)
- A CLI output, log line, or file artifact that proves the feature ran
- A real integration point — wired, not just adjacent
- A `capability_test` shell command wired in matrix.json that exits 0 for this dim

## What does NOT count

- Code that merely exists in `src/`
- Tests that only verify mocked behavior
- Hardcoded outputs or demo fixtures
- TODO, FIXME, stub, placeholder in the execution path
- Documentation describing intended behavior
- A passing capability_test for a DIFFERENT dim

---

## Checklist verification

For each FORGE_BRIEF item, answer:
- **BUILT** — implementation is present and has a real callsite + test
- **PARTIAL** — implementation exists but callsite or test is missing/mocked
- **MISSING** — not implemented in this diff

---

## Your output (required format)

```
CHECKLIST_RESULTS:
- [item-1]: BUILT | reason
- [item-2]: PARTIAL | reason
- [item-3]: MISSING | reason

SCORE: 7.5
VERDICT: PASS
REASON: <2–3 sentences citing specific files/functions from the diff>

UNIVERSE_CRITERIA_MET: YES | NO | N/A (if no universe file was injected)
CAPABILITY_TEST_PRESENT: YES | NO
INFLATION_FLAGS: NONE | <comma-separated: SHARED_RECEIPTS, SEAMED_TESTS, MARKET_DIM, HOT_EVIDENCE>

HIGHEST_IMPACT_NEXT: <one specific thing to implement to raise score by 0.5+>
```

**VERDICT is PASS** if SCORE >= {{PASS_THRESHOLD}} AND at least 1 checklist item is BUILT with a real production callsite.
**VERDICT is FAIL** if SCORE < {{PASS_THRESHOLD}} OR all checklist items are MISSING or PARTIAL.

---

## Diff to score

```diff
{{DIFF}}
```
