# Autonomy Boundaries — What the Substrate Does Alone and What Requires the Operator

> This document is the answer to Opus's review of the autonomous-crusade design: "Don't pretend autonomy where genuine human judgment is needed." The substrate is autonomous up to the boundaries listed here. Past them, it stops, surfaces the decision, and waits.

## The substrate is fully autonomous for

- **Running outcomes against current code.** `danteforge outcomes` cold-runs every declared outcome and writes evidence files. No operator approval.
- **Computing derived scores from evidence.** `loadMatrix` replaces `scores.self` with `computeDerivedScore` on every read. No operator approval.
- **Gating new outcome declarations.** The harden checks (orphan-audit, claim-auditor, hardcoded-fallback, import-resolves, functional-diff) refuse outcomes that fail. No operator approval.
- **Reporting terminal state.** `danteforge frontier` returns one of {frontier-reached, stuck-on-dims, blocked-by-dispensations, progressing}. No operator approval.
- **Time Machine commits for outcomes / harden verdicts / frontier transitions.** Best-effort, no operator approval. Failures swallowed.
- **Halting itself when stuck (Rule R1).** After 3 waves on the same dim without a new passing outcome, the crusade stops the dim. No operator approval to halt; the operator must intervene to resume.
- **Refusing to expand the matrix when existing dims aren't at frontier (Rule R3).** No operator approval to refuse.

## The substrate REQUIRES the operator for

### Dispensations
**What the operator decides:** "this dim has an architectural reason it can't reach its declared_ceiling right now; pause autonomy on it until the reason changes."

**Why operator-only:** dispensations create a parallel inflation channel if granted by anything other than a human. They are the escape hatch from frontier-rigor; an LLM granting itself one would defeat the purpose.

**How:**
```
danteforge dispensation create <dim-id> "<reason>"   # operator opens it
danteforge dispensation clear <id>                    # operator closes it
```
While any dispensation is active, **autonomy is paused globally** (Rule R2). All Dante projects are blocked. The operator must clear all active dispensations to resume.

### Tier-cap decisions
**What the operator decides:** "this dim genuinely cannot reach T5 because [structural reason]. Update `declared_ceiling` to T4 and document why."

**Why operator-only:** tier caps are architectural claims about the project's value model. "This capability requires telemetry from real users" is a business statement, not a technical one. The substrate can detect that T6 requires telemetry, but it cannot decide whether the project should pursue telemetry or accept the cap.

**How:** edit `matrix.json` directly with the new `declared_ceiling`. Add a `ceilingReason` field if the reason isn't obvious. Document in `lessons.md` so future operator sessions inherit the context.

### Outcome design (the spec for what "frontier" means for a dim)
**What the operator decides:** "for security, frontier means the SOC2 audit passes — that's the outcome command at T6."

**Why operator-only:** outcomes are commitments to users. The substrate enforces that an outcome at T5+ references a recognized benchmark, but it cannot decide which benchmark is the right one for this project's positioning. Wrong outcome = wrong target.

**How:** operator edits `matrix.json` to add a new entry to a dim's `outcomes[]` array. The harden gate then validates the declaration. The substrate runs the outcome and reports pass/fail.

### Stuck-dim resolution
**What the operator decides:** when Rule R1 fires, the operator decides whether (a) the outcome is wrong, (b) the capability is genuinely hard, or (c) the dim should be capped.

**Why operator-only:** the substrate has no model for "is this hard for good reasons." A human operator does. The substrate's job is to surface the stuck dim quickly, not to guess at the root cause.

**How:** when crusade halts with `R1.halt-stuck-dim`, the operator inspects the failing outcome, decides, and either:
- Rewrites the outcome (and resets the counter via direct state edit OR by passing — the success-path of `runOneOutcome` triggers `clearOutcomeRefinement` automatically),
- Caps the dim by updating `declared_ceiling`,
- Or opens a dispensation if the dim is blocked on something orthogonal (e.g., a third-party API outage).

### Conflict resolution (future, Phase P)
**What the operator decides:** when the synthesis agent in research-mode crusade produces a "conflict" verdict (multiple proposals have merit but represent different architectural directions), the operator picks one.

**Why operator-only:** architectural direction decisions are operator territory. The substrate can present trade-offs; it cannot weigh them.

**How:** when `crusade --research` returns `terminal: conflict`, the operator reads `.danteforge/research/<wave-id>/conflict-review.md` and writes `operator-resolution.md`. The substrate resumes based on that resolution.

### Infinite-refinement halts (Rule R4)
**What the operator decides:** when an outcome has been rewritten 3+ times without passing, the operator decides whether the outcome is wrong or the capability is genuinely hard.

**Why operator-only:** same logic as stuck-dim resolution. The substrate can detect "you've tried this 3 times" but cannot decide whether to try a 4th, fundamentally redesign the outcome, or accept the limitation.

## Why these boundaries exist

The substrate is built on the principle that **scoring as a proxy for shipping is the wrong shape**. Outcome-derived scoring fixes the technical layer of that problem. But the deeper problem — what to ship, when to ship it, what trade-offs to accept — is operator territory by definition. No amount of substrate work can eliminate the operator's role in setting direction.

Where past versions of this substrate pretended to be more autonomous than they were (by chasing numerical targets unguided), the current version is honest: it runs autonomously on the WORK once the operator has decided WHAT THE WORK IS, and halts cleanly when it hits a decision boundary.

## Decision tree (for crusade halts)

When `danteforge crusade` halts:

```
Was the halt R5.report-end-state with kind=frontier-reached?
  YES → done. Operator decides if a new tier or new dim is worth pursuing.
  NO ↓

Was the halt R2.refuse-on-dispensation?
  YES → operator clears active dispensations with `danteforge dispensation clear <id>`.
  NO ↓

Was the halt R1.halt-stuck-dim or R4.halt-infinite-refinement?
  YES → operator inspects the failing outcome. Rewrites it, caps the dim, or opens a dispensation.
  NO ↓

Was the halt R3.refuse-new-dims?
  YES → operator decides whether to finish existing dims or override (no auto-override yet — manual matrix edit required).
```

## What the substrate does NOT decide

- Which OSS projects to harvest from (per dim)
- Which benchmarks count as "external" for T5
- Which dispensations are reasonable
- Which `declared_ceiling` is honest
- Which `outcomes[]` definitions reflect real frontier
- When the project is ready to ship to users (separate from frontier-reached)

These remain operator decisions and will remain so for the foreseeable future. The substrate exists to make those decisions visible, scoped, and auditable — not to make them.
