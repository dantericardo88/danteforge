# Next Phase — what's done, what's true, what's next (2026-06-17)

This consolidates the measurement/grounding session and hands off the work that must NOT run on the
operator's primary machine. Read this before resuming.

## What is DONE (committed, in git, safe)

The **trustworthy measurement system** — the transferable asset:
- Contamination-resistant SWE-bench-Live grader (Linux orchestrator + official harness; root cause of the
  long block was an unpopulated git submodule, fixed).
- `swe-bench-live` registered as an external suite; the grade is a scored receipt the loop can consume.
- Signed leaderboard bar anchor (`leaderboard-fetch`), the failure-mode classifier, and a pluggable
  `--solve-command` seam (measure ANY solver — a DanteForge workflow, another tool — with the same pipeline).
- Six integrity fixes, each verified: CH-036 (grader), CH-038 (infra error vs real fail), CH-040 (persistent
  session), CH-041 (gate matches grader via PASS_TO_PASS), CH-042 (source-only, ungameable), CH-043 (gate
  self-detects local-env mismatch and defers to the Docker grade).

## What is TRUE (the honest numbers this produced)

- **First contamination-resistant capability number:** SWE-bench-Live, **2 clean resolves** (briefcase 13/13,
  patroni 1/1); ~33% of the 6 cleanly-gradeable instances, ~14% of 14 graded (8 were ungradeable — empty
  FAIL_TO_PASS; 4 never graded — the machine crashed). Not zero, but modest. This is the honest frontier
  signal, NOT the flattering HumanEval 90%.
- **DanteForge assessed by its own machinery:** self 8.0 → derived **7.36**; external grounding **5% (1/25
  dims)** — and that 5% is a HumanEval receipt (CH-044: it should be the SWE-bench-Live number, which needs a
  cloud grade). 95% of the headline is self-attested.
- **The fleet, honestly graded (the goal demonstrated):** self-claims vs evidence-backed derived —
  DanteCode 7.08→0.13, DanteSecurity 6.38→0.68, DanteAgents 6.17→1.78, DanteHarvest 7.92→0.00. Their matrices
  are near-fabricated; the gate exposes 4–8 points of pure self-grading inflation.

## CRITICAL operational constraint

**NEVER run the SWE-bench Docker grading on the operator's primary Windows machine.** It force-reset the
machine TWICE (RAM/WSL2 pressure from GB images + in-container test suites + concurrent grades + auto-restart
of Docker Desktop; C: had 109GB free, so it was NOT disk). See
`memory/feedback_no_heavy_docker_on_primary_machine.md`. Grading = a dedicated/cloud Linux box ONLY.

## NEXT — split by what the hardware allows

### Cloud Linux box (heavy Docker)
1. **Replace the HumanEval receipt with the honest SWE-bench-Live one (CH-044)** — run the full Live grade on
   cloud, register the swe-bench-live external-benchmark receipt on `code_generation`. Then grounding reflects
   the honest ~14–33%, not HumanEval 90%.
2. **The DanteForge-vs-raw A/B (the experiment that validates DanteForge's value)** — via the pluggable seam:
   raw `claude -p` vs a DanteForge issue-fix workflow on the same Live issues, refereed by the grader. A real
   lift = the contamination-resistant proof that DanteForge improves AI coding. (Needs a small
   DanteForge-as-solver adapter behind the `--solve-command` contract.)
3. **The solver climb** — the local gate can't match the grader without grader-env fidelity (CH-043 proved
   it). Climb by grading in the grader's Docker per iteration (cloud). The lever is regression discipline
   (fixed-but-regressed was the dominant failure mode), not "fix harder".

### Locally / per-tool (no Docker — and NOT me editing other repos)
4. **Make the fleet matrices honest** — DanteCode/DanteSecurity/DanteAgents/DanteHarvest self-grade 6–8 with
   evidence ~0. Per the operator correction ("my job is the prompt, not editing other repos"), hand each
   tool's OWN agent the honest climb prompt (`HONEST_CLIMB_PROMPT.md`) to re-author its matrix with real
   callsites + receipts. Start with DanteCode (smallest, closest to real).

## The honest framing (don't lose it)
Measurement = done + transferable. Capability climb = genuine R&D (proven, not assumed — env-fidelity wall).
Full unattended autonomy is NOT the target; the council's verdict stands: **human ratifies the yardstick,
machine measures and climbs.** The measurement half is the win; it now tells the truth across every tool.
