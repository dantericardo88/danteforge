---
name: dante-tdd
description: "Use when implementing a feature or fixing a bug under the test-driven discipline. Use when the project's CLAUDE.md or AGENTS.md specifies TDD as the default workflow. Use after /dante-to-prd has emitted tasks.md."
based_on: mattpocock/skills/tdd
attribution: |
  Pattern derived from Matt Pocock's skills repository (MIT licensed).
  Original at https://github.com/mattpocock/skills/tree/main/tdd.
  6-step verify-cycle attributed to obra/superpowers/test-driven-development (MIT).
  Verification-before-completion attributed to obra/superpowers/verification-before-completion (MIT).
  Dante-native implementation adds: KiloCode discipline enforcement during refactor,
  harsh-scorer Testing dimension check per cycle, sacred-content preservation rule
  on test names and assertion messages, three-way promotion gate before commit.
license: MIT
constitutional_dependencies:
  - .danteforge/evidence-chain
  - .danteforge/harsh-scorer
  - .danteforge/promotion-gate
  - .danteforge/economy
required_dimensions:
  - testing
  - errorHandling
  - maintainability
sacred_content_types:
  - test_names
  - assertion_messages
  - failing_test_diff
---

# /dante-tdd — Red-Verify-Green-Verify-Refactor-Verify Loop

> Dante-native skill module. Adopts Superpowers' 6-step verify-cycle wholesale and adds KiloCode discipline + harsh-scorer per-cycle gate + sacred content preservation rule.

## Iron Law

**No production code without a failing test that proves it's needed.** **No commit without all three verify steps passing.**

The 3-step red-green-refactor cycle is too easy to falsify (a test that fails for the wrong reason, an implementation that passes for the wrong reason, a refactor that silently changes behavior). The 6-step verify cycle is harder to fake.

## Constitutional Iron Law

Test names and assertion messages are **sacred content** — they are never compressed by Article XIV Context Economy filters. The harsh-scorer Testing dimension verifies sacred-content preservation as a hard gate.

## Inputs

- A task from `tasks.md` (or a free-form bug report)
- Optional: target file (default: inferred from task)
- Optional: `--commit-each-cycle` (default: true) — emit one commit per red-green-refactor cycle

## The 6-Step Cycle (one task, repeated until done)

### Step 1 — Red: Author the Failing Test

Write a test that captures the new behavior or reproduces the bug. The test must:
- Have a descriptive name that names the behavior, not the implementation
- Use an assertion message that explains *why* this assertion matters
- Be runnable in isolation (no order-dependent fixtures)

### Step 2 — Verify Red: Confirm Test Fails for the Right Reason

Run the test. It must:
- **Fail** (not error out due to syntax mistakes)
- Fail with the message you expected (not an unrelated assertion failing first)
- Fail because the production code is missing/wrong, not because the test is malformed

If the test errors instead of fails, fix the test, re-run. If the test fails for a different reason than expected, the test is wrong; rewrite it. Anti-stub: a test that fails because of a typo is not a red test.

**Evidence emitted:** Artifact `step1_test_authored` + Artifact `step2_red_verified` with the failing-test diff and observed failure message.

### Step 3 — Green: Minimal Implementation

Write the *minimum* code that makes the test pass. No anticipatory features. No "while I'm here" cleanup. YAGNI is enforced: if it isn't proven necessary by the test, don't write it.

### Step 4 — Verify Green: Confirm Test Passes for the Right Reason

Run the full test suite (not just the touched test). The new test must:
- **Pass**
- Pass because the production code now does the right thing (not because the assertion was loosened)
- All previously-passing tests must still pass (no regression)

Read the diff of the production code change and confirm: would this code, in isolation, produce the behavior the test name claims? If you can't answer yes with confidence, the implementation is too clever or too magical.

**Evidence emitted:** Artifact `step3_implementation` + Artifact `step4_green_verified` with the production diff and the suite pass state.

### Step 5 — Refactor: Extract / Simplify (KiloCode-disciplined)

Now that the test passes, look for refactoring opportunities:
- Any file that grew past 500 LOC during this cycle: **extract** before commit
- Any function that grew past 50 LOC: extract
- Any duplicated logic from a recent change: factor out
- Naming improvements: rename now while the change is small

If no refactor is appropriate (early in a feature; KiloCode size still small), explicitly note "no refactor this cycle" — do not invent refactors.

### Step 6 — Verify Refactor: Confirm Behavior Unchanged

Run the full test suite again. Every test that was passing before refactor must still pass. If any test newly fails, the refactor changed behavior — back it out, do it differently, or accept that this is now a behavior-change cycle and add a new test for the new behavior.

**Evidence emitted:** Artifact `step5_refactor` + Artifact `step6_refactor_verified`.

## Per-Cycle Three-Way Gate (before commit)

After Step 6:
- **Forge policy:** does the change comply with the constitution (no `as any`, no `process.chdir` in tests, no security regressions)?
- **Evidence chain integrity:** are all 6 artifact records present and hashed?
- **Harsh score:** Testing + ErrorHandling + Maintainability each ≥9.0?

If all GREEN: commit. The commit message includes the cycle's runId so the evidence chain is queryable post-commit.

If any RED: do not commit. Emit Verdict `progress_real_but_not_done` with specific blocking reasons. Block the next cycle until resolved.

## Sacred Content Preservation Test

Before commit, verify that test names and assertion messages have not been:
- Compressed by Article XIV filters (sacred_content_types check)
- Truncated by token-economy heuristics
- Auto-rewritten by linters into unrecognizable forms

If the sacred content was modified, restore it from the artifact chain.

## Stopping Criteria

The skill exits the loop when:
- All tasks in `tasks.md` have been driven through ≥1 successful cycle, or
- Budget exhausted (emit `budget_stopped`), or
- A cycle's three-way gate fails twice in a row (escalate)

## Anti-stub Defenses

- A test that asserts only `assert.ok(true)` fails the harsh-scorer Testing dimension (vacuous assertion)
- A green-verify step that didn't observe the test name in the runner output is rejected (was the test even loaded?)
- A refactor that touches files unrelated to the cycle's task fails Spec-Driven Pipeline (scope creep)
- A cycle with no `step2_red_verified` Artifact is treated as untested (skipped step → not a TDD cycle)

## Output Format

Per cycle:
1. **Human-readable:** the commit (with cycle metadata in the trailer)
2. **Machine-readable:** 6 Artifacts + per-step Evidence + Verdict + (if blocked) NextAction
