---
name: dante-grill-me
description: "Use when a plan needs adversarial pressure-testing before implementation. Use when the user has produced a draft plan and wants hidden assumptions surfaced. Use with --roles=balanced for multi-perspective grilling."
based_on: mattpocock/skills/grill-me
attribution: |
  Pattern derived from Matt Pocock's skills repository (MIT licensed).
  Original at https://github.com/mattpocock/skills/tree/main/grill-me.
  Debate mode protocol attributed to hex/claude-council (MIT).
  Role taxonomy attributed to hex/claude-council role assignment.
  Dante-native implementation adds: evidence chain emission, harsh-scorer
  pre-flight on Planning Quality, three-way promotion gate, truth-loop
  disagreement protocol integration.
license: MIT
constitutional_dependencies:
  - .danteforge/evidence-chain
  - .danteforge/harsh-scorer
  - .danteforge/promotion-gate
  - .danteforge/economy
required_dimensions:
  - planningQuality
  - specDrivenPipeline
sacred_content_types:
  - assumptions_surfaced
  - disagreement_records
  - blocking_questions
---

# /dante-grill-me — Interview-Driven Plan Refinement

> Dante-native skill module. Combines Matt Pocock's grill-me workflow with claude-council's debate mode protocol. Emits each interview turn as Evidence; integrates with the truth-loop disagreement policy.

## Iron Law

**Every plan has hidden assumptions; the goal is to surface them before implementation, not after.** A plan that survives grilling unchanged was either already excellent or wasn't grilled hard enough.

## Constitutional Iron Law

The grilling session must score ≥9.0 on the harsh-scorer Planning Quality dimension before declaring complete. The dimension explicitly checks: were ≥3 hidden assumptions surfaced? are they documented? did each disagreement reach a resolution (evidence-backed) or escalation (acknowledged)?

## Inputs

- Draft plan (markdown, free-form)
- Optional: `--roles=balanced` activates multi-perspective grilling using the role taxonomy: `security`, `performance`, `simplicity`, `devils-advocate`, `scalability`, `developer-experience`, `compliance`
- Optional: `--budget-turns=N` (default 12) — hard limit on interview length

## Phase 1 — Plan Ingestion

Read the draft plan. Identify:
- **Stated goal:** what the plan claims to accomplish
- **Stated approach:** how the plan claims to do it
- **Stated success criteria:** how the plan claims to know it's done

Emit Artifact `phase1_ingestion` summarizing the three above.

**Transition criterion:** all three identified, even if the plan was vague (in which case the vagueness itself is an Assumption to surface).

## Phase 2 — Question Depth Escalation (Round 1)

Generate questions in order of increasing depth:
- **Surface:** what does each acronym mean, who are the named stakeholders, what's the deadline
- **Mechanism:** how does the proposed approach handle failure mode X, Y, Z
- **Assumption:** what does the plan implicitly assume about (latency, budget, hardware, team availability, prior art, regulatory environment)
- **Counterfactual:** what would have to be true for the plan to fail; is any of that true now

Each question is one Evidence record. Each user answer is one Evidence record. Pair them by claimId.

If `--roles=balanced` is set, generate one question batch per role. Round 1 questions are produced **independently** per role (no cross-role coordination yet — this is the claude-council Round 1 rule).

**Transition criterion:** ≥3 questions per depth level produced; user has answered each (or the answer "I don't know" is itself recorded as Evidence with status `unsupported`).

## Phase 3 — Debate Mode Round 2

Show each role its peers' Round 1 questions and answers. Ask: "what did you miss?", "where do you disagree?", "where did the user's answer reveal an assumption you hadn't anticipated?"

Round 2 inputs are NOT cached (claude-council Round-2-Not-Cached rule) because the disagreement signal lives in the Round 2 output.

**Transition criterion:** each role has produced a Round 2 response; disagreements between roles are explicitly logged.

## Phase 4 — Disagreement Resolution (truth-loop integration)

For each disagreement between roles or between role and plan:
- **Evidence settles it:** one position is provable, the other is wrong → accept the proven position
- **Evidence partially settles it:** split the claim into atomic claims; mark each
- **Evidence does not settle it:** generate a targeted test that *would* settle it; if no test possible, escalate
- **Opinion-only disagreement:** log as opinion; request founder decision if blocking
- **High-risk disagreement:** fail closed and escalate immediately (security, money, legal, production risk)

This phase reuses the disagreement policy from `src/spine/truth_loop/reconciler.ts`. Each resolution is one Evidence record.

## Phase 5 — Surfaced Assumptions Catalog

Write `assumptions_surfaced.md`. Each assumption has:
- **Statement:** what the plan was implicitly assuming
- **How surfaced:** which question revealed it
- **Verification status:** confirmed by founder | refuted by founder | requires test | requires research
- **Risk if wrong:** what breaks if this assumption is false

**Transition criterion:** ≥3 assumptions catalogued (per Iron Law).

## Phase 6 — Refined Plan Output

Produce the refined plan as a markdown file: original plan with assumptions made explicit, disagreements resolved or escalated, success criteria sharpened.

**Three-way gate:**
- **Forge policy:** all role outputs respect the constitution (no security violations, no policy bypasses)
- **Evidence chain integrity:** Phase 1-5 artifacts present and hashed
- **Harsh score:** Planning Quality + Spec-Driven Pipeline each ≥9.0

If GREEN: emit Verdict `complete`, NextAction `implementation_prompt` to feed refined plan into `/dante-to-prd` or directly to `/dante-tdd`.

If RED: emit Verdict `evidence_insufficient`, NextAction with specific blocking questions (`actionType: human_decision_request`).

## Stopping Criteria

The grill stops when:
- Budget turns exhausted (emit `budget_stopped` verdict + NextAction `budget_extension_request`), or
- All Phase 5 assumptions resolved (refined plan ready), or
- A high-risk disagreement triggers fail-closed escalation

## Anti-stub Defenses

- A grill session with <3 surfaced assumptions fails Planning Quality and is treated as "didn't dig deep enough"
- A grill session with all assumptions marked "confirmed by founder" with no founder turn record fails evidence chain integrity
- A grill session that produces a refined plan identical to the input plan fails (the skill claims a delta but produced none)

## Output Format

Two outputs:
1. **Human-readable:** refined plan markdown + `assumptions_surfaced.md`
2. **Machine-readable:** Artifact chain + Evidence per question/answer + Verdict + NextAction
