---
name: ps
description: "Problem-solve intake — reign a lazy task ('fix the bug', 'optimize this') into a resolve-then-proceed plan: investigate first, decompose large into small, prove with evidence. NOT a better answer to a vague verb — the discipline IS the lever."
---

# /ps — Problem-Solve Intake (DFPP-001)

When the user invokes `/ps <task>`, do NOT answer the lazy verb directly. Apply the DanteForge problem-solving
protocol — the power is in the harness discipline, not in a better-worded answer. (A frontier model already reasons
like a senior engineer; "act like a senior engineer" adds nothing. What it lacks is enforced steps, and that is what
this supplies.)

## The protocol — apply every time

1. **Investigate before you mutate.** Reconstruct what the relevant code ACTUALLY does before proposing any change.
   Trace the real root cause; never pattern-match to a likely-looking line. Label anything you have not read or run
   as an assumption, never as a finding.
2. **Resolve, then proceed — the resolution ladder, NOT a hard ask-gate.** Resolve the under-specified verb from:
   the request → the codebase → sensible defaults. If you resolve it, PROCEED and state the assumption plainly.
   Stop and ask ONLY when a choice is genuinely the user's AND hard to reverse / outward-facing. A clarifying
   question is the exception, not the reflex (bias to action on reversible work — like Claude Code and Codex do).
3. **Decompose large into small.** If the task is big or stuck, break it into ≥2 DEFINED sub-problems (a defined
   problem is a solvable one) and tackle them one at a time, recording each as tracked next-work. A wall becomes a
   worklist, never a dead stop.
4. **Preserve behavior** unless told otherwise; state the blast radius — what you touched and what you deliberately
   did NOT.
5. **Prove it.** "Done" = evidence (a reproduction that now passes, a test, a run, an output diff) — not because the
   code looks right. For bugs: reproduce → fix → prove the reproduction passes.
6. **Pick the analysis lens** that fits, as ONE line (a frame, not a costume): `debugging | architecture |
   performance | security | devops | frontend | tech-lead`.

## Output contract

End every substantive reply with, in order:
- **FINDINGS** — what the code/system actually does (grounded) + root cause / decision rationale.
- **CHANGE** — what changed and why; blast radius (touched / deliberately untouched).
- **EVIDENCE** — the proof the done-criteria are met (test/run/repro); anything NOT yet proven, named explicitly.
- **RISKS & ASSUMPTIONS** — assumptions taken under proceed-on-assumptions + the residual risk + its trigger.
- **NEXT** — one line, only if genuinely out of current scope.

## Optional: the structured template

Run `danteforge ps "<the task>"` to print the filled resolve-then-proceed contract — the required fields (symptom,
definition of done, scope) with unresolved ones flagged for the ladder, plus the suggested lens. Useful for handing a
clean, reigned-in task to a sub-agent or a teammate. Flags: `--symptom`, `--done`, `--scope`, `--lens`.

## Banned as a SOLE instruction (reign these in, never answer them blind)

"fix the bug" · "find the problem" · "make it work" · "optimize this" · "clean it up" · "refactor this" · "review
this" · "is this good?" — each fails for missing context, missing definition-of-done, and missing verification, none
of which a better incantation solves. Resolve the missing fields from context first; proceed stating assumptions.

CLI parity: `danteforge ps <goal> [--symptom <t>] [--done <t>] [--scope <t>] [--lens <name>]`
