# Capability Tiers — User-Observable Contracts

> Each tier is a **commitment to a user-observable outcome**, not just a score cap. Below each tier's contract is the design brief any outcome declared at that tier must satisfy. The harden gate enforces tier-appropriate constraints automatically; the contracts below tell you what to write.

## Why this document exists

Before this document, "T2" was a score cap of 5.0. After this document, T2 is a promise: **"this capability has at least one behavioral test that exits 0."** The score is derived from whether the promise holds. The substrate enforces the structural shape of the outcome; the contract tells you what shape to write.

When in doubt about what tier an outcome belongs to, find the lowest tier whose contract this outcome can credibly prove. Don't claim higher.

---

## The Ladder

| Tier | Score cap | One-line user-observable contract |
|------|-----------|-----------------------------------|
| T0 | 1.0 | Source for the capability exists in the tree at the declared `capability_callsite.file`. |
| T1 | 4.0 | The code compiles cold (clean `tsc --noEmit` or `pnpm build --force` from a wiped cache) without errors on `main`. |
| T2 | 5.0 | The capability has at least one behavioral test that exits 0 and asserts on the capability's actual behavior (not just import + null check). |
| T3 | 6.0 | The capability is invoked from at least one production code path (non-test, non-script) — verifiable by grep of `from '<callsite>'` or `import('<callsite>')` against `src/`. |
| T4 | 7.0 | The capability is invoked from a user-facing entry point AND has a snapshot test asserting observable output that a human user would see. |
| T5 | 8.0 | The capability passes a declared external benchmark suite (SWE-bench, HumanEval, custom suite committed to the repo). |
| T6 | 8.5 | The capability has been exercised by N distinct production users in the last 30 days, verifiable from telemetry. |
| T7 | 9.0 | Multi-receipt consensus: 3+ outcomes at T5+ all passing with ≤7 day freshness. |
| T8 | 9.5 | Live verification: all outcomes fresh ≤24h with telemetry-kind evidence. |

> 10.0 is human-curated. No tier unlocks it. T7/T8 require sustained multi-angle validation — they're earned, not declared.

---

## Tier T0 — Source exists

**Contract**: A file at `capability_callsite.file` exists on disk.

**What proves it**: trivial existence check. The substrate runs this automatically; you don't write a T0 outcome unless you have something exotic to assert.

**What an agent can fake**: nothing. The check is deterministic.

**Practical use**: T0 is the default fallback. A dim that declares no outcomes scores at most T0 (cap 1.0). Operators see "T0" in the substrate's status report and know: "this dim has not even claimed source-exists yet."

---

## Tier T1 — Compiles cold

**Contract**: `tsc --noEmit` (or the equivalent for the project's language) exits 0 on a clean cache against `main`.

**Why "cold"**: Turbo and similar build caches return "clean" status from cached results. The DanteForge probe ran into this exact failure mode on DanteAgents (Phase A): 17 packages reported as compiling were actually broken, but `pnpm build --filter` hit the cache. The T1 outcome MUST run from the repo root with cache disabled.

**What proves it**: a shell command of the form `pnpm build --force --no-cache --continue` (turbo), `pnpm -r --no-bail run build` (pnpm workspaces), `tsc --noEmit` (single-package), with `expected_exit: 0`. The substrate's `danteforge probe` command produces evidence at this tier.

**What an agent can fake**: nothing once the outcome runs cold. An agent could try to write a T1 outcome whose command is `echo done` — the harden gate's `claim-auditor` check rejects this because the command doesn't reference compilation tooling.

**Practical use**: every dim should declare a T1 outcome. It's the floor of "does this code build at all." A project with even one T1 failure cannot honestly claim any tier above T1 on the affected dim.

---

## Tier T2 — Behavioral test exists and passes

**Contract**: at least one test (in `tests/`, `__tests__/`, or equivalent) executes the capability with actual inputs and asserts on actual outputs. Not just `expect(myFunction).toBeDefined()`.

**What proves it**: a shell command running the test runner, with `expected_exit: 0`. Plus a `required_callsite` pointing to the source file the test exercises. The substrate's harden gate enforces that `required_callsite` is present at T2+.

**What an agent can fake**: an agent could write `it('exists', () => expect(thing).toBeDefined())` and call it a T2 outcome. The harden gate's `claim-auditor` is a partial defense (looks at the file's content for behavioral patterns). The stronger defense is operator review at outcome-declaration time.

**Practical use**: the bulk of useful test coverage lives here. Don't claim T3+ unless you can also claim T2 with a real behavioral test.

---

## Tier T3 — Invoked from production code

**Contract**: `capability_callsite.file` is imported by at least one production file (non-test, non-script) under `src/` or equivalent.

**Why this matters**: this is the orphan/parallel-implementation defense. DanteDojo found 22 of 28 modules in one session that had passing tests but zero production importers. Tests pass, the code does nothing in the actual product. T3 closes that gap.

**What proves it**: the substrate's built-in `production-usage-fresh` outcome (with `freshnessDays: null` or omitted) counts production imports of the callsite. Pass if ≥1.

**What an agent can fake**: an agent could add an import-only-for-show statement in some production file. The harden gate's `primary-not-parallel` check (Phase H Slice 3, deferred) catches the variant where the new callsite is parallel to a legacy implementation that's still primary.

**Practical use**: the threshold between "we built something" and "we shipped something." A dim plateauing at T2 means the work is real but inert.

---

## Tier T4 — Reached from user-facing entry point with snapshot test

**Contract**: a production code path that begins at a user-facing entry point (`bin/`, `cli/`, public API surface, etc.) reaches the capability AND a snapshot test exists that asserts what the user sees.

**What proves it**: two outcomes together — (a) `production-usage-fresh` passing AND (b) a snapshot/golden-path test passing. The substrate's `danteforge snapshot` command (existing primitive) is the natural T4 evidence producer.

**What an agent can fake**: very hard at this point. The snapshot test asserts on actual stdout/stderr from a user-visible CLI invocation. The output is grep-checkable. The harden gate's `claim-auditor` catches mismatches between the outcome's `description` and what the snapshot asserts.

**Practical use**: this is where "the user can see it" starts to apply. T3 says "production reaches the code"; T4 says "the user sees the result."

---

## Tier T5 — External benchmark passes

**Contract**: the capability passes a benchmark suite that is NOT part of this project's own tests. Examples: SWE-bench Lite, HumanEval, MMLU-Code, a custom user-acceptance suite that lives in a separate repository.

**Why external**: internal tests can be designed to match the implementation. External benchmarks are designed by someone else and can't be tuned to the code.

**What proves it**: an outcome whose `command` invokes an external benchmark runner with a declared minimum pass rate (e.g. `expected_output_pattern: "pass rate: [89][0-9]%"`).

**What an agent can fake**: extremely difficult. The substrate's harden gate (Phase H Slice 1) enforces that T5+ outcomes reference a benchmark name from a recognized registry. Agents can't invent benchmarks.

**Practical use**: the cap for most projects. Most dims won't have a credible T5 outcome because most capabilities don't have public benchmarks. That's fine — declaring `declared_ceiling: 'T4'` on a dim is honest.

---

## Tier T6 — Real production telemetry

**Contract**: telemetry shows N distinct production users exercised this capability in the last 30 days, where N is project-defined.

**What proves it**: an outcome with `kind: 'telemetry'` (Phase H follow-up — not yet implemented in the substrate) that queries a declared telemetry source. The runner caches by gitSha but the underlying telemetry is queried fresh.

**What an agent can fake**: nothing, if the telemetry source is external (not maintained by the agent's project).

**Practical use**: production-grade. A T6 outcome means "users are actually using this." Most dims will never reach T6. That's the point — T6 is rare and meaningful.

---

## Tier T7 — Multi-receipt consensus

**Contract**: the dimension has 3 or more outcomes at T5 or higher, and ALL of them currently pass with evidence fresher than 7 days.

**What proves it**: the derived-score engine walks the tier ladder. At T7, it checks that the perTier counts show 3+ outcomes at T5+ with `allPassing: true`. A single T7 outcome declaration is necessary but not sufficient — the breadth of depth evidence must exist.

**What an agent can fake**: nothing. The outcomes must execute and produce real evidence files. The 3-outcome minimum prevents gaming with one trivial test.

**Practical use**: this is the "9.0" tier. A dim at T7 has been proven from multiple angles — smoke tests, benchmarks, and integration tests all pass, all fresh. Most well-maintained dims should be able to reach T7 with sustained effort.

**Score cap**: 9.0. **Freshness window**: 7 days.

---

## Tier T8 — Live verification

**Contract**: all outcomes are fresh (≤24 hours) AND the outcome uses `kind: 'telemetry'` with live production evidence. This is the "ran it today" tier.

**What proves it**: T8 outcomes must use `kind: 'telemetry'`. The evidence freshness window is 24 hours — if you didn't run validation today, T8 evidence is stale and the score decays.

**What an agent can fake**: nothing, if the telemetry source is external.

**Practical use**: this is the "9.5" tier. Reserved for dims with genuine live production verification. Most dims will cap at T7. T8 is for mission-critical capabilities where same-day validation matters.

**Score cap**: 9.5. **Freshness window**: 24 hours.

> **10.0** remains human-curated. No tier unlocks it. It represents sustained excellence across multi-receipt + live verification + external benchmark success, confirmed by the project owner.

---

## What the substrate enforces automatically (the gates)

The substrate does not trust outcome declarations. It runs harden checks on every outcome at declaration time:

1. **T2+ outcomes** must have `required_callsite` declared. (`validateOutcomeForTier` — Slice 1b)
2. **T3+ outcomes** must have a callsite that's production-reachable (orphan-audit must pass for the dim).
3. **T4+ outcomes** must coexist with at least one snapshot-test outcome on the same dim.
4. **T5+ outcomes** must use `kind: 'shell'` with a command that invokes a recognized external benchmark, OR `kind: 'external-benchmark'` (registered).
5. **T6 outcomes** must use `kind: 'telemetry'` with a registered telemetry source.
6. **T7 outcomes** require 3+ sibling outcomes at T5+ declared on the same dim (`validateOutcomeForTier`).
7. **T8 outcomes** must use `kind: 'telemetry'` (live verification requires real production evidence).

These gates are deterministic. An agent cannot game them by writing words; only by writing code that satisfies them.

---

## Practical guidance — how to declare outcomes per dim

When migrating a dim from legacy score to outcome-derived:

1. **Start at T1.** Add a `compiles-cold` outcome. Score floor is 4.0 once it passes.
2. **Add T2.** Find or write a behavioral test for the dim's capability. `required_callsite` points to the file.
3. **Add T3 only if true.** If production code doesn't reach the capability, don't claim T3. Declare `declared_ceiling: 'T2'` and stop.
4. **T4 is a real claim.** Don't declare it without a snapshot test that asserts on user-visible output.
5. **T5+ is rare.** Most projects don't have external benchmarks. That's honesty, not a failure.

The substrate's `danteforge outcomes migrate` (Phase G follow-up) infers T1+T2 outcomes from existing `capability_test` commands. You manually author T3+ when the dim merits it.

---

## What "frontier reached" means in this substrate

A dim is at frontier iff THREE conditions hold:

1. **All outcomes at its `declared_ceiling` pass.** The dim is delivering on every contract it claims.
2. **No active dispensation against the dim.** Operators sometimes grant exemptions; while one is open, the dim is not at frontier.
3. **The `production-usage-fresh` outcome passes** (or the dim's `declared_ceiling` is < T3, where production usage isn't claimed).

These conditions are computed by `src/core/frontier-state.ts` and surfaced by `danteforge frontier`. The crusade's win condition is "every eligible dim is at frontier," not a numerical score.

---

## When a dim genuinely can't reach a tier

Some capabilities have architectural ceilings. `community_adoption` cannot reach T6 without real product users; `code_signing` cannot reach T3 without an EV certificate purchase. Declare `declared_ceiling` honestly. The substrate's `KNOWN_CEILINGS` map (in `compete-matrix.ts`) documents these per dim; the harden gate refuses to declare an outcome above a dim's known ceiling.

A dim at its declared ceiling with all outcomes passing is at frontier. It does not need to reach T6 to be "done."
