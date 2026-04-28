---
name: dante-to-prd
description: "Use when starting a new feature, project, or significant change that needs a written PRD. Use when the user has a conversation-style brief and you need to convert it into a constitutional PRD with full evidence chain. Use when the founder asks 'turn this into a PRD'."
based_on: mattpocock/skills/to-prd
attribution: |
  Pattern derived from Matt Pocock's skills repository (MIT licensed).
  Original at https://github.com/mattpocock/skills/tree/main/to-prd.
  Per-change folder convention attributed to Fission-AI/OpenSpec (MIT).
  Brainstorming sub-step attributed to obra/superpowers (MIT).
  Dante-native implementation adds: evidence chain emission, harsh-scorer
  pre-flight, three-way promotion gate, constitutional checklist, surfaced
  assumptions section.
license: MIT
constitutional_dependencies:
  - .danteforge/evidence-chain
  - .danteforge/harsh-scorer
  - .danteforge/promotion-gate
  - .danteforge/economy
required_dimensions:
  - specDrivenPipeline
  - planningQuality
  - documentation
sacred_content_types:
  - acceptance_criteria
  - constitutional_checklist
  - surfaced_assumptions
---

# /dante-to-prd — Conversation → PRD with Evidence Chain

> Dante-native skill module. Builds on Matt Pocock's to-prd structural pattern with constitutional substrate (evidence chain, harsh-scorer pre-flight, three-way gate).

## Iron Law

**No PRD without explicit tradeoffs documented.** **No PRD lands without a three-way gate sign-off.**

A PRD that buries assumptions, skips alternatives, or leaves acceptance criteria fuzzy is a PRD the implementation will silently drift from. Dante refuses to emit such PRDs.

## Constitutional Iron Law

The PRD must include a **Constitutional Checklist** section confirming: KiloCode discipline (every file ≤500 LOC), fail-closed semantics specification, evidence emission specification, sacred content type identification, expected context footprint. The harsh-scorer Spec-Driven Pipeline dimension verifies this section exists and is non-empty before the skill can declare complete.

## Output Layout (per-change folder, OpenSpec convention)

The skill emits a folder under `docs/PRDs/<change-name>/`:

```
docs/PRDs/<change-name>/
  proposal.md         # what's changing and why
  specs/<spec>.md     # the formal spec(s) introduced or modified
  design.md           # design notes, alternatives considered
  tasks.md            # task breakdown for implementation
  constitutional_checklist.md
  surfaced_assumptions.md
```

After merge, the folder moves to `docs/PRDs/<change-name>/archive/` (preserves history; never delete).

## Phase 1 — Conversation → Brief (Brainstorming sub-skill)

Read the conversation context. Identify:
- **Goal:** what is the user trying to accomplish in plain language
- **Constraints:** tech stack, deadlines, dependencies, hardware ceiling
- **Non-goals:** what is explicitly out of scope

Surface ≥3 candidate approaches with tradeoffs. Do not select a winner yet.

**Phase 1 → Phase 2 transition criterion:** ≥3 candidate approaches documented with at least one tradeoff each. Phase 2 cannot enter until this is true.

**Evidence emitted:** Artifact `phase1_brief` written to skill-runs directory.

## Phase 2 — Brief → Specs (proposal-first authoring)

Write `proposal.md` first. Cover: problem statement, goal in 1 sentence, why now, success metric (measurable), strategic context.

Then write `specs/<spec>.md` for each spec the change introduces or modifies. Each spec has: scope, contract, behavior under failure, observability hooks, security considerations.

**Phase 2 → Phase 3 transition criterion:** proposal exists, all specs exist, harsh-scorer Spec-Driven Pipeline ≥9.0 on the proposal+specs pair. If <9.0, iterate, do not proceed.

**Evidence emitted:** Artifact `phase2_specs` with hash of each spec file.

## Phase 3 — Specs → Design (alternatives + selection)

Write `design.md`. Cover: chosen approach (paragraph), 2-3 alternatives considered (paragraph each with tradeoffs), why the chosen approach won, what happens if the chosen approach proves wrong (rollback path).

**Phase 3 → Phase 4 transition criterion:** design.md has ≥2 alternatives documented with explicit tradeoffs.

**Evidence emitted:** Artifact `phase3_design`.

## Phase 4 — Design → Tasks (Superpowers writing-plans pattern)

Write `tasks.md`. Decompose into:
- File-level changes (per file: what changes, why, KiloCode size estimate)
- Dependency ordering between changes
- Verification step per change (how it will be tested)
- Rollback plan (what to do if a change breaks)

KiloCode discipline: any task that produces a file >500 LOC must be subdivided into multiple tasks before this phase exits.

**Phase 4 → Phase 5 transition criterion:** every task has a verification step; no task produces a file >500 LOC.

**Evidence emitted:** Artifact `phase4_tasks`.

## Phase 5 — Constitutional Checklist + Surfaced Assumptions

Write `constitutional_checklist.md`. Confirm explicitly:
- KiloCode discipline holds across all files in the change
- Fail-closed semantics specified for each error path
- Evidence emission specified for each task
- Sacred content types identified (test names? assertion messages? security-critical paths?)
- Expected context footprint estimated (tokens per skill run)

Write `surfaced_assumptions.md`. List every implicit assumption made during phases 1-4 that requires founder confirmation. Empty surfaced_assumptions.md is a failure signal — every change has hidden assumptions, and a skill that found none probably wasn't looking.

**Phase 5 → Phase 6 transition criterion:** both files exist; surfaced_assumptions.md has ≥1 entry; constitutional_checklist.md confirms all 5 items explicitly.

## Phase 6 — Three-Way Gate

The skill runner's three-way gate evaluates:
- **Forge policy:** is the proposed change permitted by the project constitution?
- **Evidence chain integrity:** are all 5 phase artifacts present and hashed?
- **Harsh score:** specDrivenPipeline + planningQuality + documentation each ≥9.0?

If all three are GREEN: emit Verdict `complete`, NextAction `implementation_prompt` for `/dante-tdd` to begin task execution.

If any are not GREEN: emit Verdict `progress_real_but_not_done`, NextAction with specific blocking reasons. Do not file a GitHub issue; do not declare done.

## Anti-stub Defenses

- A PRD without a `success metric (measurable)` line in proposal.md fails the harsh-scorer Spec-Driven Pipeline dimension.
- A `tasks.md` without a verification step per task fails the Planning Quality dimension.
- An empty `surfaced_assumptions.md` is treated as a red flag, not a green light.

## Output Format

Two outputs:
1. **Human-readable:** the per-change folder under `docs/PRDs/<change-name>/`.
2. **Machine-readable:** Artifact + Evidence + Verdict + NextAction matching the truth-loop schema, written to `.danteforge/skill-runs/dante-to-prd/<runId>/`.

## Failure Modes

| Failure | Detection | Recovery |
|---|---|---|
| Proposal.md scores <9.0 on Spec-Driven Pipeline | harsh-scorer pre-flight | Iterate proposal up to 3 times; if still <9.0, escalate to founder |
| Surfaced assumptions empty | Phase 5 transition check | Block; require explicit "no assumptions" justification with founder approval |
| KiloCode discipline violated in tasks.md | Phase 4 transition check | Force subdivision before proceeding |
| Three-way gate fails | Phase 6 | Emit `progress_real_but_not_done`, do not file GitHub issue |
