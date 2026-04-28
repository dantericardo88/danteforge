---
name: dante-design-an-interface
description: "Use when designing a new interface, API, UX flow, or written communication that benefits from parallel exploration of distinct approaches. Use when the founder asks 'show me 3 different ways to do this'. Use for the Sean Lippay outreach validation workflow."
based_on: mattpocock/skills/design-an-interface
attribution: |
  Pattern derived from Matt Pocock's skills repository (MIT licensed).
  Original at https://github.com/mattpocock/skills/tree/main/design-an-interface.
  Parallel sub-agent dispatch attributed to obra/superpowers/dispatching-parallel-agents (MIT).
  Two-stage review attributed to obra/superpowers/subagent-driven-development.
  Worktree isolation attributed to obra/superpowers + existing src/utils/worktree.ts.
  Debate mode synthesis attributed to hex/claude-council (MIT).
  Dante-native implementation adds: max-3 parallel agents per laptop hardware ceiling,
  per-agent Artifact emission, claude-council debate synthesis, Verdict + NextAction
  emission matching the truth-loop schema.
license: MIT
constitutional_dependencies:
  - .danteforge/evidence-chain
  - .danteforge/harsh-scorer
  - .danteforge/promotion-gate
  - .danteforge/economy
  - src/utils/worktree.ts
required_dimensions:
  - functionality
  - maintainability
  - developerExperience
sacred_content_types:
  - design_constraints
  - selection_rationale
  - tradeoff_documentation
---

# /dante-design-an-interface — Parallel Design Exploration with Debate Synthesis

> Dante-native skill module. Three parallel sub-agents produce radically different designs; debate-mode synthesis selects the winner.

## Iron Law

**Three radically different designs beat one carefully optimized design.** The point of parallel exploration is not to "average" three designs into one — it's to surface tradeoffs that would have been invisible from a single design.

## Constitutional Iron Law

Maximum 3 parallel sub-agents per the RTX 4060 laptop hardware ceiling (PRD-MASTER §3). Skills that try to spawn more are refused at dispatch. Designs are produced in **isolated git worktrees** so they can't contaminate each other.

## Inputs

- Design brief (free-form: API contract, UX flow, written communication, etc.)
- Optional: `--roles=<list>` overrides default role taxonomy
- Optional: `--budget-usd=<amount>` (default $10) — total cost ceiling across all 3 agents

## Default Role Taxonomy

For each invocation, three sub-agents get distinct roles. Defaults vary by brief type:
- **API design:** `pragmatic-rest`, `purist-graphql`, `event-driven-async`
- **UX flow:** `minimalist`, `power-user`, `accessibility-first`
- **Written communication (e.g., outreach email):** `persuasive`, `concise`, `technically-grounded`
- **Infra change:** `safest-rollout`, `fastest-shipping`, `cheapest-runtime`

The `--roles=` flag accepts a comma-separated override.

## Phase 1 — Brief Parsing + Role Assignment

Read the design brief. Identify:
- **Constraints:** hard requirements that any design must respect
- **Soft preferences:** nice-to-haves that may differ between designs
- **Success criteria:** how the founder will judge "good"

Pick the role taxonomy. Write the per-role system prompt that primes each sub-agent for its role.

**Evidence emitted:** Artifact `phase1_brief_parsed` with constraints, preferences, success criteria; Artifact `phase1_role_prompts` with the per-role system prompts.

## Phase 2 — Parallel Sub-Agent Dispatch (worktree-isolated)

Spawn 3 sub-agents in parallel, each in its own git worktree (`src/utils/worktree.ts`). Each sub-agent:
- Receives only the brief + its role's system prompt + the constraints
- Does NOT see the other roles or their drafts
- Must produce a complete design including: contract/flow/text, acceptance criteria, list of tradeoffs explicitly accepted

Hardware ceiling: max 3 parallel. If `--roles=` specifies more than 3, the skill refuses with an explicit error.

**Per-sub-agent Evidence emitted:** Artifact `subagent_<role>_design` with the design output; Artifact `subagent_<role>_tradeoffs` with the explicit tradeoff list; Evidence `worktree_isolated` confirming no cross-contamination.

**Transition criterion:** all 3 sub-agents complete OR ≥1 fails (re-dispatch with refined prompt vs. proceed with N=2).

## Phase 3 — Two-Stage Review (per design)

For each of the 3 designs, run two-stage review:

**Stage A — Spec compliance:**
- Does the design satisfy all hard constraints from Phase 1?
- Does the design produce all required outputs (contract, criteria, tradeoffs)?
- Stage A is binary: pass or fail. A design that fails Stage A is dropped from synthesis.

**Stage B — Code/communication quality:**
- Maintainability score (for code) or clarity score (for communication)
- Performance/cost score (for systems) or rhetorical effectiveness (for writing)
- Stage B is graded; results feed the synthesis ranking.

**Evidence emitted:** Artifact `phase3_review_<role>` per design; harsh-scorer dimensions per design.

## Phase 4 — Debate Mode Synthesis (claude-council protocol)

Round 1: each design's review summary is presented as if it were a critic position (independent).

Round 2: a synthesizing agent sees all 3 reviews and asks:
- Which tradeoffs are *complementary* (could pieces of two designs be combined)?
- Which tradeoffs are *exclusive* (combining would defeat both)?
- Which design's tradeoffs best match the brief's success criteria?
- What did each design see that the others missed?

The synthesis is itself an Artifact — not a one-line conclusion appended to the reviews.

**Evidence emitted:** Artifact `phase4_synthesis` with the explicit comparison table and selection reasoning.

## Phase 5 — Selection + NextAction

Pick the winner. Selection is **explicit**, not vibe-based:
- The selection rationale names which success criterion drove the choice
- The selection rationale acknowledges what the chosen design loses (no design wins on every axis)
- Designs that lost are preserved in the Evidence chain — they may inform future iterations

If no design passes Stage A (all three failed spec compliance):
- Emit Verdict `evidence_insufficient`, NextAction `targeted_test_request` to refine the brief
- Do not pick a default winner from a failed cohort

If 2-3 designs pass Stage A but synthesis cannot select between them (irreducible disagreement on which success criterion matters most):
- Emit Verdict `escalated_to_human`, NextAction `human_decision_request` with a 1-page comparison
- Do not invent a tiebreak

## Phase 6 — Three-Way Gate

- **Forge policy:** the chosen design respects all constraints from Phase 1
- **Evidence chain integrity:** all 3 designs + reviews + synthesis present and hashed
- **Harsh score:** Functionality + Maintainability + DeveloperExperience each ≥9.0 on the chosen design

If GREEN: emit Verdict `complete`, NextAction `implementation_prompt` to feed chosen design into `/dante-tdd` for implementation (or send-ready output for written communication).

## Anti-stub Defenses

- 3 designs that converge to "essentially the same thing" fail diversity check (the role prompts didn't enforce divergence well enough)
- A synthesis that picks the winner without naming a tradeoff lost is rejected (vibe-based selection)
- A Stage B review that scored all 3 designs identically is suspect (review didn't differentiate)

## Output Format

1. **Human-readable:** the chosen design + a 1-page comparison summary + the rationale
2. **Machine-readable:** 3 design Artifacts + per-design Evidence + synthesis Artifact + Verdict + NextAction
3. **Worktree state:** the 3 worktrees are preserved post-run for audit; cleanup happens on explicit `--cleanup-worktrees`
