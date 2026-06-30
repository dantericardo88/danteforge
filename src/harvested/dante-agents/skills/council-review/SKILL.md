---
name: council-review
description: Adversarial multi-lens gap-hunt (builder-never-judges) — convene an independent council that FINDS THE HOLES blocking readiness, returns a READY/NOT_READY verdict + defined gaps recorded to the challenge ledger, and (in --loop mode) iterates review→fix→re-review until the council clears it. Use when the operator wants the work pressure-tested before declaring it done, or a continuous problem-solving loop gated on council readiness.
version: 1.0.0
risk: medium
source: danteforge-native
importDate: 2026-06-29
---

# DanteForge Council-Review Skill (`/council-review`)

The mechanized version of the adversarial loop that hardens real work: instead of self-certifying "done,"
convene an **independent, builder-never-judges panel** whose only job is to **find the holes** — then either
report them or loop until they're gone.

## When to use this skill

- Before declaring a feature/loop "ready" — pressure-test it adversarially first.
- The operator says "ask the council", "what's blocking", "find the gaps", "is this really done?"
- As a continuous problem-solving loop: keep fixing until an independent council says READY.

## The command

```bash
# One-shot gap-hunt — prints READY/NOT_READY + the defined gaps, records blocking gaps to the ledger
danteforge council-review

# Continuous loop — review → record gaps → fix → re-review, until READY (or --rounds)
danteforge council-review --loop --rounds 5

# Machine-readable
danteforge council-review --json
```

## How it works

1. **Multi-lens panel.** Independent reviewers, each with a distinct adversarial lens — by default
   **correctness**, **runtime-reliability**, and **scoring-honesty** — each tasked to find DEFINED gaps
   (title + observable problem + evidence + the opportunity solving it unlocks), not to praise.
2. **Builder-never-judges.** The reviewer is never the agent that built the work — the rule that kills score
   inflation (same principle as Ornith's frozen-judge veto and COMPILOT's "never let the model judge itself").
   **Hard prerequisite:** certifying READY requires a `--reviewer <provider>` that is DISTINCT from the builder
   provider. With only one provider configured, the panel cannot be independent, so it returns NOT_READY with an
   explicit "independence gap" (this is by design, not a silent failure — configure a second provider to clear it).
3. **Fail-closed.** A reviewer that errors or abstains counts as a blocking gap — the panel is never
   "ready by silence". With no LLM provider configured it returns NOT_READY honestly.
4. **Verdict + ledger.** Aggregates to `READY` / `NOT_READY`. Every blocking gap is recorded in the
   self-challenge ledger (`.danteforge/challenges.md`) so it is owned, never lost.
5. **`--loop`.** Records the gaps, runs `autoforge` to address them, and re-convenes the panel — repeating
   until READY or the round budget is spent. Exits non-zero if it can't clear.

## Relationship to the other loops

This is the reusable primitive (`runCouncilGapReview` / `runCouncilGapLoop`) — it is NOT tied to ascend or the
matrix kernel; it is a standalone command and an importable engine the ascend/crusade frontier loops can call
as a readiness gate. Pairs with `/supervise` (auto-reengage) and the Depth-Doctrine measured-receipt firewall:
the supervisor keeps it looping, the firewall proves the build runs, and the council proves nothing important
was missed.
