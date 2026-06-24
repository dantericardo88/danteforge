---
name: ps
description: "Use when handed a vague task ('fix the bug', 'optimize this', 'make it work', 'clean it up'). Reigns the lazy verb into a resolve-then-proceed plan: investigate first, decompose large into small, prove with evidence. The harness discipline IS the lever — not a better-worded answer or a senior-engineer persona."
---
# /ps — Problem-Solve Intake (DFPP-001)

> Don't answer a lazy verb blind. Investigate → resolve-then-proceed → decompose → prove. A frontier model already
> reasons like a senior engineer; what "fix the bug" lacks is enforced steps — and that is what this supplies.

## When To Use This Skill

- The task arrives as a lazy verb as its sole instruction: "fix the bug", "find the problem", "make it work",
  "optimize this", "clean it up", "refactor this", "review this", "is this good?"
- A task is large or stuck and needs breaking into smaller, individually-solvable, tracked sub-problems.

## The protocol — apply every time

1. **Investigate before you mutate.** Reconstruct what the relevant code ACTUALLY does before proposing any change.
   Trace the real root cause; never pattern-match to a likely-looking line. Label anything you have not read or run
   as an assumption, never as a finding.
2. **Resolve, then proceed — the resolution ladder, NOT a hard ask-gate.** Resolve the under-specified verb from:
   the request → the codebase → sensible defaults. If you resolve it, PROCEED and state the assumption plainly.
   Stop and ask ONLY when a choice is genuinely the user's AND hard to reverse / outward-facing (bias to action on
   reversible work — a clarifying question is the exception, not the reflex).
3. **Decompose large into small.** If the task is big or stuck, break it into ≥2 DEFINED sub-problems (a defined
   problem is a solvable one) and tackle them one at a time, recording each as tracked next-work. A wall is a
   worklist, never a dead stop.
4. **Preserve behavior** unless told otherwise; state the blast radius — touched / deliberately untouched.
5. **Prove it.** "Done" = evidence (a reproduction that now passes, a test, a run, an output diff) — not because the
   code looks right. For bugs: reproduce → fix → prove the reproduction passes.
6. **Pick the analysis lens** that fits, as ONE line (a frame, not a costume): `debugging | architecture |
   performance | security | devops | frontend | tech-lead`.

## Output contract

End every substantive reply with, in order: **FINDINGS** (what the code actually does + root cause) · **CHANGE**
(what + blast radius) · **EVIDENCE** (the proof; anything unproven named) · **RISKS & ASSUMPTIONS** (assumptions
taken + residual risk + trigger) · **NEXT** (one line, only if out of scope).

## Optional: the structured template

Run `danteforge ps "<the task>"` to print the filled resolve-then-proceed contract — required fields (symptom,
definition of done, scope) with unresolved ones flagged for the ladder, plus the suggested lens. Flags:
`--symptom`, `--done`, `--scope`, `--lens`. Useful for handing a clean, reigned-in task to a sub-agent or teammate.

CLI parity: `danteforge ps <goal> [--symptom <t>] [--done <t>] [--scope <t>] [--lens <name>]`
