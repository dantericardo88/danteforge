# Anticipated Objections — Hostile-Reviewer Playbook

**Companion to:** [time-machine-empirical-validation-v1.md](time-machine-empirical-validation-v1.md)
**Builds on:** [Pass 23 adversarial review](.danteforge/PASS_23_ADVERSARIAL_REVIEW.md)
**Audience:** Founder + Microsoft Research peer reviewers

Pass 23 caught 3 CRITICAL findings before publication. They're fixed. But peer review will surface other objections we haven't seen yet. This document anticipates 10 specific reviewer claims with our prepared responses + supporting evidence.

Each entry:
- **Reviewer claim** — verbatim how the objection would be phrased
- **Why it's compelling** — surface plausibility (why a reviewer would write this)
- **Our response** — specific counter-argument
- **Evidence** — file path / test / metric

---

## OBJ-1 — "Your substrate is a thin retry loop with extra steps"

**Reviewer claim:** *"You claim cryptographic guarantees, but stripping the proof layer, what you've built is: detect divergence, restore from snapshot, re-prompt LLM. That's a basic retry pattern. Your contribution is overstated."*

**Why compelling:** the retry-loop description IS accurate at one level of abstraction. Surface readers may stop there.

**Our response:** the substrate's contribution is not the retry — it's the *invariant*: user-observed state is *always* either (a) a clean baseline OR (b) a state the LLM successfully round-tripped. There is no exposed-corruption window. Pass 40's strategy comparison demonstrates this: prompt-only-retry achieves the same retry count but allows cascaded corruption to leak into the workspace; substrate-restore-retry guarantees clean state. The retry mechanism is necessary but not sufficient.

**Evidence:**
- [tests/time-machine-delegate52-strategy-comparison.test.ts](../tests/time-machine-delegate52-strategy-comparison.test.ts) — sticky-corruption simulator: substrate keeps `[more-corruption]` out of workspace; prompt-only-retry lets it cascade
- [src/core/time-machine-validation.ts](../src/core/time-machine-validation.ts) `runDelegate52DomainRoundTrip` shows the dispatch on `mitigation.strategy`
- Pre-registration prediction (Pass 41): substrate ≥ 50% lower D4-user than prompt-only-retry

---

## OBJ-2 — "The 48 public domains are easier than the full DELEGATE-52 because Microsoft only released the easy ones"

**Reviewer claim:** *"DELEGATE-52's 25% baseline came from 124 environments. The 76 withheld are enterprise-license-restricted — likely the hardest cases (real customer data, complex schemas). The 48 you tested are publicly releasable, which selects for cleanness. Your D4-raw on those will look better than 25% just from selection bias, and your substrate's apparent improvement will be inflated."*

**Why compelling:** plausible selection-bias argument; common methodological critique.

**Our response:** acknowledge the bias upfront in §7 limitation 2. Pre-register the prediction that D4-raw lands in 20–30% (not 25% precisely) to account for it. We do NOT claim our D4-user vs Microsoft-baseline comparison is apples-to-apples; we claim our D4-user vs *our own measured D4-raw on the same 48 domains* is rigorous. The substrate's contribution is computed against the substrate-passive baseline on the same set — selection bias affects both numerator and denominator equally and cancels.

**Evidence:**
- [docs/papers/preregistration.md](preregistration.md) D4-raw prediction interval 10–35%
- [docs/papers/time-machine-empirical-validation-v1.md](time-machine-empirical-validation-v1.md) §4 + §5.4.2 explicitly compute "raw vs user-observed on same domains"
- Pass 40 strategy comparison runs all three strategies on the *same* 48 domains; selection bias cancels in within-set comparison

---

## OBJ-3 — "Mitigation tests use deterministic simulators; real LLM behavior may differ"

**Reviewer claim:** *"Your mitigation loop tests pass against a deterministic always-corrupt simulator. Real Sonnet has stochastic outputs — temperature, sampling, tool-call retries. Your retry loop might converge in synthetic but oscillate or fail under genuine LLM behavior."*

**Why compelling:** simulator-vs-reality gap is a real concern.

**Our response:** Pass 36 added the noisy-non-oscillating simulator that uses a seeded counter to model non-determinism. Pass 36's oscillation detector + Pass 40's strategy comparison both run against this realistic adversary. The pre-registered D4-user prediction (0–15% interval) explicitly acknowledges the simulator-vs-reality risk: we predict the substrate works under realistic LLM behavior with confidence "medium-high", not "high". The live GATE-1 run is the falsification step.

**Evidence:**
- [tests/time-machine-delegate52-oscillation.test.ts](../tests/time-machine-delegate52-oscillation.test.ts) noisy-non-oscillating simulator
- [docs/papers/preregistration.md](preregistration.md) D4-user confidence: medium-high; falsification criterion: > 15%
- Pre-registration explicitly says "live run is the falsification instrument"

---

## OBJ-4 — "Causal-source identification just tells you when corruption happened, not what was wrong"

**Reviewer claim:** *"Your D3 metric reports the round-trip index where divergence first occurred. That's not 'causal-source identification' — it's a timestamp. Real causal attribution would tell you which token / which structural element caused the divergence and why."*

**Why compelling:** older versions of the paper said exactly that (round-trip index). Reviewer would be reading a version that didn't have Pass 39.

**Our response:** Pass 39 added per-divergence diff descriptors: line-range + char-offset + region count + clean-attribution boolean. The D3 metric now reports the *fraction of divergences that map to a single contiguous changed region*. This is "causal-source" in the structural sense (where the corruption is) not the semantic sense (why the LLM made that choice). We're explicit about which sense we mean.

**Evidence:**
- [src/core/time-machine-validation.ts](../src/core/time-machine-validation.ts) `computeDiffLocations` + `corruptionLocations` schema field
- [tests/time-machine-delegate52-diff-attribution.test.ts](../tests/time-machine-delegate52-diff-attribution.test.ts) demonstrates single-line vs multi-region detection
- §5.4.2 of paper explicitly distinguishes structural-source (D3) from semantic-source (out of scope)

---

## OBJ-5 — "The 25% baseline is from older models; new Sonnet might be 5%; your substrate gain shrinks"

**Reviewer claim:** *"Microsoft's 25% finding was on Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro circa 2025. Models have improved. If Sonnet 4.5 corrupts at 5%, then the substrate's 'reduction from 25% to 0%' shrinks to 'reduction from 5% to 0%' — much less impressive."*

**Why compelling:** model improvement is real. The headline claim is sensitive to baseline rate.

**Our response:** the paper's primary contribution is the substrate-on/substrate-off contrast measured *on the same model* at run time, not against Microsoft's historical baseline. If raw rate is 5%, then user-observed near 0% via substrate is a 5× reduction — still meaningful. If raw rate is 25%, the reduction is 25×. Either way, the substrate's mechanism (detect + restore + retry) is what's being demonstrated. The Microsoft baseline is the framing reference, not the comparison.

**Evidence:**
- [docs/papers/preregistration.md](preregistration.md) D4-raw prediction explicitly anticipates 10–35%, including the "much lower" case
- §4 of paper explicitly says "raw corruption rate is the substrate-passive measurement"; substrate contribution is the *delta*, not the absolute reduction

---

## OBJ-6 — "Why not just use prompt engineering with output validators?"

**Reviewer claim:** *"You could achieve similar reduction in user-observed corruption by adding a JSON-schema validator to the LLM output and re-prompting on validation failure. That's a few hundred lines of code, no Merkle trees, no Time Machine. What does the substrate add over a validator?"*

**Why compelling:** validators ARE simpler. The simplicity argument is strong.

**Our response:** validators check *output shape*, not *round-trip integrity*. A JSON validator catches malformed JSON but not "the LLM rephrased the second-to-last item in a way that's still valid JSON but means something different." The substrate's byte-equality check catches *any* divergence, structural or semantic, because it's hash-based. Pass 40's strategy comparison effectively measures this: prompt-only-retry IS a "validator + retry" approximation; it cascades corruption because validators can't distinguish "different valid output" from "same valid output". Substrate-restore-retry's clean-state guarantee is what validators can't provide.

Additionally: the substrate provides reversibility (D2) and causal attribution (D3) as side benefits validators don't. A validator tells you *something is wrong*; the substrate tells you *what changed* and lets you go back.

**Evidence:**
- Pass 40 strategy comparison: prompt-only-retry is functionally a validator-style retry on the corrupted input; cascades corruption
- Class B Pass 20 results: 6/6 byte-identical restore — a property no validator provides
- Class C Pass 20 results: 7/7 causal queries with 0 gaps — validators don't provide attribution

---

## OBJ-7 — "Cost overhead at 1.3-3× LLM budget is too high for production"

**Reviewer claim:** *"You report substrate-on costs 1.3-3× of substrate-off because of retries. That's 30-200% more LLM spend. For high-throughput systems, that kills the value proposition."*

**Why compelling:** for cost-sensitive deployments, this is a real consideration.

**Our response:** the cost multiplier applies *per divergence*, not per round-trip. If the LLM round-trips cleanly (preserveProbability ~ 1.0), cost overhead is ~0% (no retries fire). The 1.3-3× ceiling applies in the worst case where every round-trip diverges. In practice, with Sonnet's typical clean-round-trip rate (we'd estimate 70-95% on DELEGATE-52 from D4-raw), cost overhead is 0.3-1.0× — 30-100%. For workflows where document integrity matters (legal, medical, accounting — exactly the DELEGATE-52 domains), this overhead is acceptable.

Plus: the substrate's retry budget is configurable. `--retries-on-divergence 0` runs substrate-passive (no overhead, just recording). `--retries-on-divergence 10` is a maximum-safety mode. Operators tune to their tolerance.

**Evidence:**
- [src/core/time-machine-validation.ts](../src/core/time-machine-validation.ts) `mitigation.retriesOnDivergence` configurable per run
- §5.4.2 of paper notes "1.3-3× higher when mitigation is on"; the multiplier scales with raw corruption rate

---

## OBJ-8 — "Concurrent commits produce fan-out; that's a substrate bug"

**Reviewer claim:** *"You documented in Pass 31 that 8-parallel commits produce non-linear history. That's a race condition; you've shipped a substrate that loses commits under concurrency."*

**Why compelling:** "shipped a race condition" sounds bad even if technically wrong.

**Our response:** Pass 31's observation is correct: unsynchronized concurrent commits produce fan-out. But no commits are *lost* — all N commits exist on disk, all N reflog entries land. The fan-out is a *property* of unsynchronized concurrency, not a bug; git itself behaves the same way. If callers need linearization (typical for a single agent doing sequential work), they need their own coordination. The DELEGATE-52 round-trip code doesn't do parallel commits per domain, so the property doesn't affect any paper claim.

**Evidence:**
- [tests/time-machine-concurrent-commits.test.ts](../tests/time-machine-concurrent-commits.test.ts) — 8 parallel commits → 8 commits on disk, 8 reflog entries, HEAD points to a real commit
- §7 limitation 7 documents this honestly
- Class D round-trip code is sequential per-domain (one forward + one backward at a time)

---

## OBJ-9 — "This is a Git wrapper; what's novel?"

**Reviewer claim:** *"Strip the language: you have a content-addressed blob store, snapshot commits, and a commit log. That's git. Your 'Time Machine' rebrands git internals. The 'cryptographic substrate' is the same SHA-256 git uses."*

**Why compelling:** at primitive level, yes — same SHA, same commits, same reflog.

**Our response:** §2 of the paper explicitly cites Git as the snapshot-reversibility primitive. We don't claim novel primitives; we claim novel *composition*: a single substrate that wraps LLM document edits in three guarantees (Merkle tamper-evidence, snapshot reversibility, causal completeness) simultaneously, with a programmable interface that LLM-driven systems can call as part of their normal flow. Plain git doesn't have causal-link metadata (`causalLinks.verdictEvidence`, etc.). Plain git doesn't have a three-way promotion gate that integrates with LLM workflow. The contribution is the operationalization for an LLM-edit context, not the primitives.

**Evidence:**
- §2 of paper credits Git for snapshot-reversibility, Bitcoin for Merkle, provenance/lineage tracking literature for causal completeness
- §3 explicitly states "These are not novel primitives. The contribution is the *composition*"
- `TimeMachineCommit.causalLinks` schema (verdictEvidence, evidenceArtifacts, fileHistory, sourceCommitIds, alternativesConsidered, rejectedClaims, counterfactualTraces) — git has none of these

---

## OBJ-10 — "If the LLM can't converge, retries don't help; you're hiding the failure"

**Reviewer claim:** *"For permanently-corrupting LLM behavior (test 4 in your mitigation suite), the substrate runs out of retries and 'gracefully degrades' to the last clean state. From the user's perspective, the round-trip didn't happen — they asked for an edit, got nothing back. That's not a fix; that's masking a failure."*

**Why compelling:** the failure-mode is real; gracefully-degraded ≠ work-completed.

**Our response:** correct — graceful degradation is "the user gets clean data, but the requested edit didn't happen." The substrate's contribution is *not* magically fixing the LLM; it's giving the user a failure signal (`unmitigatedDivergences > 0`) instead of silently corrupted data. From the user's perspective, the round-trip *should* fail visibly when the LLM can't do it correctly — exactly so the human can intervene. Silent corruption is the failure mode the paper is trying to prevent. The substrate succeeds when it makes the failure visible while preserving the user's data.

We're explicit about this in §5.4.2: "D4-user is the rate of unmitigated divergence after substrate-mediated recovery" — unmitigated means the substrate didn't fix it, but the user still got clean data. That's the contract.

**Evidence:**
- [tests/time-machine-delegate52-mitigation.test.ts](../tests/time-machine-delegate52-mitigation.test.ts) test 4: permanent corruption → unmitigated count > 0 (failure signal preserved)
- [tests/time-machine-delegate52-oscillation.test.ts](../tests/time-machine-delegate52-oscillation.test.ts): graceful-degradation test verifies on-disk document is clean baseline, NOT corruption
- §5.4.2 of paper explicitly distinguishes "user-observed corruption" (D4-user) from "the LLM completed the edit successfully" — separate signals

---

## What this playbook does NOT do

- Does not anticipate every possible objection. Real peer review surfaces things no one predicts.
- Does not provide "winning" arguments — for some objections (OBJ-2, OBJ-7), the honest response is partial agreement + scope clarification.
- Does not let us skip live data. Every response that depends on live numbers (D4-raw, D4-user, D1) only becomes load-bearing AFTER GATE-1 fires and the live result file exists.

## How to use this document

When peer feedback arrives:
1. Find the closest objection in this list (or note it's a new one)
2. Use the prepared response as a starting point, not a final answer
3. If a reviewer point causes us to update the substrate or the paper, update this playbook with the new framing

When a reviewer's point is genuinely correct: agree, retract the affected claim in the paper, update the limitations section. Do NOT defend an indefensible position. Pre-registration discipline applies here too.
