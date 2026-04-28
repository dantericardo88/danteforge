---
name: dante-triage-issue
description: "Use when investigating a bug, incident, or unexpected behavior. Use when a fix attempt has already failed and a deeper root cause analysis is needed. Use with --mode=adversarial to invoke debate mode on the root cause hypothesis."
based_on: mattpocock/skills/triage-issue
attribution: |
  Pattern derived from Matt Pocock's skills repository (MIT licensed).
  Original at https://github.com/mattpocock/skills/tree/main/triage-issue.
  4-phase root-cause loop attributed to obra/superpowers/systematic-debugging (MIT).
  Defense-in-depth pattern attributed to obra/superpowers/systematic-debugging.
  Adversarial debate mode attributed to hex/claude-council (MIT).
  Dante-native implementation adds: SoulSeal receipt for the root-cause analysis,
  three-way gate before fix lands, integration with .danteforge/incidents/,
  harsh-scorer Error Handling check on proposed fix.
license: MIT
constitutional_dependencies:
  - .danteforge/evidence-chain
  - .danteforge/harsh-scorer
  - .danteforge/promotion-gate
  - .danteforge/incidents
  - .danteforge/economy
required_dimensions:
  - errorHandling
  - testing
  - functionality
sacred_content_types:
  - error_messages
  - stack_traces
  - reproduction_steps
  - root_cause_chain
---

# /dante-triage-issue — 4-Phase Root Cause Investigation

> Dante-native skill module. Adopts Superpowers' 4-phase systematic debugging loop and adds SoulSeal-signed root cause receipts + truth-loop integration.

## Iron Law

**Symptom is not cause.** **A fix that resolves the symptom but doesn't address the cause is not a fix; it's a defer.**

The 4-phase loop forces separation of symptom (what the user observed) from proximate cause (what fired the symptom) from root cause (the structural condition that allowed the proximate cause to exist).

## Constitutional Iron Law

The root-cause analysis chain is sacred content. The chain is signed with a SoulSeal receipt so that "we investigated and concluded X" becomes auditable. A claim of root cause without a SoulSeal receipt is a claim, not a finding.

## Inputs

- Bug report or incident description (free-form)
- Optional: reproduction steps (if known)
- Optional: `--mode=adversarial` invokes claude-council-style debate mode on the proposed root cause hypothesis
- Optional: `--mode=quick` skips Phase 4 (defense-in-depth) for incidents needing immediate triage

## Phase 1 — Reproduce

Get the bug to fire reliably. This is the falsifiability foundation.

- Capture exact reproduction steps (preserving sacred content: error messages, stack traces verbatim)
- Identify the **observed symptom** (what the user saw)
- Identify the **failing condition** (what test/check would fail given the symptom)
- If you cannot reproduce, the bug is either (a) flaky → flag for separate investigation, or (b) misreported → request more detail before proceeding

**Transition criterion:** reproduction is reliable (≥3 consecutive reproductions) OR explicit "cannot reproduce" with documented investigation.

**Evidence emitted:** Artifact `phase1_reproduction` + Evidence `reproduction_status` with status `passed` (reproduced) or `inconclusive` (cannot reproduce).

## Phase 2 — Hypothesize

Enumerate competing root cause candidates. **Minimum 3 hypotheses** — a single-hypothesis investigation is confirmation bias by another name.

For each hypothesis:
- **Statement:** what condition would have to be true for this to be the root cause
- **Test:** how would you falsify this hypothesis (an experiment that, if negative, rules it out)
- **Likelihood:** prior probability based on system knowledge

**Transition criterion:** ≥3 hypotheses with explicit falsification tests.

**Evidence emitted:** Artifact `phase2_hypotheses` listing all candidates.

## Phase 3 — Falsify

Run each hypothesis's falsification test. Record results as Evidence:
- **Falsified:** hypothesis ruled out
- **Confirmed:** hypothesis matches the observed evidence
- **Inconclusive:** test didn't separate the hypothesis from alternatives → design a better test or escalate

If `--mode=adversarial` is set: when ≥2 hypotheses are still live, run claude-council debate mode (Round 1 each role argues for one hypothesis; Round 2 critique each other; synthesis identifies the genuinely irreducible disagreement).

**Transition criterion:** exactly one hypothesis confirmed AND all others falsified, OR explicit escalation when ≥2 hypotheses survive falsification.

**Evidence emitted:** Artifact `phase3_falsification_log` with per-hypothesis status. Evidence record per falsification test.

## Phase 4 — Defense in Depth

Once root cause is confirmed, design the fix. The fix has **two layers**:
- **Proximate fix:** code change that prevents the bug from firing
- **Structural defense:** invariant, type, test, or assertion that makes the *class of bug* harder to reintroduce

A fix that has only the proximate layer is a deferred regression — the same bug can fire again from a different call site.

**Transition criterion:** both layers designed; structural defense has a regression test that fails before the fix and passes after.

**Evidence emitted:** Artifact `phase4_fix_design` with both layers + regression test diff.

## Phase 5 — SoulSeal Root Cause Receipt

Generate a signed receipt covering:
- Symptom statement
- Reproduction steps (verbatim, sacred)
- Hypothesis enumeration (verbatim)
- Falsification log per hypothesis
- Confirmed root cause statement
- Two-layer fix design

The receipt is hashed (sha256 over the canonical JSON) and the hash is the SoulSeal. Future references to this triage cite the SoulSeal hash; if the underlying analysis is later modified, the hash mismatch surfaces the tampering.

The receipt is written to `.danteforge/incidents/<runId>/soulseal_receipt.json`.

## Phase 6 — Three-Way Gate (before fix lands)

- **Forge policy:** the fix complies with the constitution (no security regressions, no scope creep beyond the bug)
- **Evidence chain integrity:** Phase 1-5 artifacts present, SoulSeal receipt present and hashes match
- **Harsh score:** ErrorHandling + Testing + Functionality each ≥9.0?

If GREEN: emit Verdict `complete`, NextAction `implementation_prompt` to drive the fix through `/dante-tdd` (regression test first, fix second).

If RED: emit Verdict `progress_real_but_not_done`, do NOT commit the fix.

## Quick Mode (`--mode=quick`)

Skips Phase 4 (defense-in-depth) and emits a NextAction `targeted_test_request` for follow-up. Use only for production-incident triage where the proximate fix has to land within minutes; the structural defense becomes a P0 backlog item.

## Anti-stub Defenses

- A "root cause" without a Phase 3 falsification log is rejected as a guess
- A fix without a regression test fails Testing dimension and blocks
- A fix that modifies files unrelated to the bug fails forge policy (scope creep)
- A SoulSeal receipt whose hash doesn't match its body is rejected as tampered

## Output Format

1. **Human-readable:** triage report markdown + SoulSeal receipt JSON
2. **Machine-readable:** per-phase Artifact + Evidence + Verdict + NextAction
3. **Incident record:** entry under `.danteforge/incidents/<runId>/` for queryable history
