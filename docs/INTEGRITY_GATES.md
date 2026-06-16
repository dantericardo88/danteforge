# Integrity Gates — the standing recurrence-stopper

DanteForge is self-grading, so internal-consistency holes are an *infinite* surface — new self-certification
holes keep appearing, and for months they were found only by ad-hoc adversarial audits (55–57 agents each).
This is the **standing** answer (master-plan shape-move #3): a two-tier gate so a self-certification hole is
caught **structurally**, not discovered.

## Tier 1 — fast deterministic regression gate: `npm run test:integrity`
Locks every self-certification hole we've already found (15+) as invariants. Runs in seconds; the same pins
also run in `npm run verify` (via `test:smoke` + `test:laws`), so the gate is already enforced on every
verify. Run `test:integrity` directly when touching the grading / court / score-write surface.

| Invariant (must hold) | Pinned by |
|---|---|
| Verdict parser is FAIL-dominant (a trailing/planted PASS can't launder a FAIL) | `council-verdict-parser.test.ts` |
| grok + gemini are JUDGE-ONLY; judge-only members bypass the builder filter | `council-grok-judge.test.ts`, `council-judge-fix.test.ts` |
| Builder-never-judges on every path; min-judges floored at 2; artifact text defanged | `frontier-review-court.test.ts` |
| `validated` requires a verifiable court receipt (`validated_by`); >8 needs a Score Ladder | `frontier-spec.test.ts`, `ladder-coverage.test.ts` |
| Every dimension has a competitor-grounded Score Ladder | `ladder-coverage.test.ts` |
| Provenance backstop + unverified-`validated` stripped at the save boundary | `score-provenance-backstop.test.ts` |
| Interrupt-before-score-write gate + auto-resume (CH-022) | `score-interrupt.test.ts` |
| Evidence staleness vs HEAD is surfaced (#10) | `evidence-staleness.test.ts` |
| Unverified self>8 is badged (trusts the receipt, not the bare string) | `compete-display-nullsafe.test.ts` |
| Read-time frontier gate caps unvalidated >8 at 8.0 | `compete-matrix-read-gates.test.ts` |
| The full Pillar-2 pre-commit enforcement is installed (CH-024) | `install-git-hooks.test.ts` |
| Laws L1–L8 (isolation, score-writes, durability, hygiene, evidence, clock, flag-wiring, routing) | `tests/laws/*` |

A NEW commit that regresses any of these FAILS `test:integrity` (and `verify`) — that is the structural
recurrence-stopper for *known* classes.

## Tier 2 — on-demand deep audit: `scripts/integrity-audit.workflow.js`
Finds NEW hole classes the deterministic pins can't anticipate. Fans adversarial finders across every
self-certification attack surface, then verifies each finding twice (one agent writes a concrete exploit,
one checks whether another guard already catches it), so only real, reachable holes reach the worklist.

```
Workflow({ scriptPath: "scripts/integrity-audit.workflow.js" })
```

Run it **before a release** and **after any change to the court / grading / score-write surface**. A clean
run (0 confirmed) is a PASS; any confirmed hole becomes a Tier-1 pin once fixed (so it can never recur).
It is multi-agent + LLM-heavy (≈30–60 agents) — on-demand, not per-commit.

## The discipline
1. Touching the grading/court/score surface → run `test:integrity` (fast) before committing.
2. Before a release, or after a structural change → run the Tier-2 deep audit.
3. Every confirmed Tier-2 finding, once fixed, gets a Tier-1 pin in `test:integrity`. **Holes graduate from
   "discovered" to "structurally impossible to reintroduce."** That is how the whack-a-mole ends.

> This gate locks INTERNAL self-consistency. It does NOT make a score world-consistent — that is external
> grounding (master-plan Phase 1: a benchmark receipt + `weightedGroundingRatio > 0` as the hard
> precondition for any score > 7). Tier-1/Tier-2 keep the loop from self-deceiving; external grounding is
> what makes the number true.
