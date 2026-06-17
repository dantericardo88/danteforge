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

### Cloud Linux box (heavy Docker) — COUNCIL-VALIDATED RUN PLAN (2026-06-17)

**Key reframe (council):** the A/B *treatment* resolve-rate IS the honest `code_generation` receipt — so
CH-044 (replace HumanEval) and the thesis A/B are **ONE experiment, not two.** The build is done + dry-run
proven; the risk is now experimental design, not code. Execute IN THIS ORDER:

0. **Box:** Ubuntu VM, enough RAM for Docker (the WSL2/RAM pressure that reset the Windows box will OOM a
   small VM — size deliberately, spot/ephemeral, tear down). `git clone` + `npm ci` + `npm run build` + Claude
   CLI auth. Sanity: `npx tsx --test tests/swe-bench-real.test.ts tests/external-benchmark-runner.test.ts
   tests/danteforge-solver-steps.test.ts`.
1. **SMOKE FIRST (1 instance, both arms, REAL grade):** prove the treatment grades end-to-end (it has only
   ever been `--dry-run`) and the box survives the load before paying for a sweep.
2. **The 3-arm A/B at a MEANINGFUL n** — use `--spread 40` (cross-repo) to land ≥20 *gradeable* instances
   after the empty-FAIL_TO_PASS attrition (~half were ungradeable at n=20). Same instances, same model
   (`DANTEFORGE_SOLVE_CLAUDE`), sequential grades (CH-038 watch `Error:`/`Incomplete:`), `--grade-only` to
   resume:
   ```bash
   # A) raw one-shot          B) budget-matched control       C) DanteForge structured (treatment)
   --solver "claude -p"   |   --solve-command "node scripts/raw-solve.mjs"   |   --solve-command "node scripts/danteforge-solve.mjs"
   ```
   Arms B vs C isolate STRUCTURE (same 3-turn budget); A is the one-shot reference. **Report the Wilson 95%
   CI (now in the analyzer), never the bare rate** — a small-n delta with overlapping CIs is NOT a win.
3. **Register the TREATMENT (C) resolve-rate as the `code_generation` swe-bench-live receipt** (`validate
   code_generation --force-cold` + `evidence-rescore.mjs`) — this simultaneously kills CH-044 (honest receipt
   replaces HumanEval 90%) and answers the thesis.
4. **Climb ONLY if C shows a real lift over B (non-overlapping CIs) or a clear fixable failure mode.** A null
   or negative A/B is THE ANSWER (thesis not supported on hard SWE), not a failure to fix — do not pour cloud
   budget into climbing a refuted thesis. The climb lever is regression discipline; faithful feedback needs
   grading in the grader's Docker per iteration (CH-043).

CAVEAT (Codex): the treatment arm is a 3-phase prompt/session adapter, NOT the full autoforge/party workflow
— a null result may indict the adapter more than the whole thesis. If C ≈ B, try the fuller DanteForge
workflow behind the same seam before concluding.

### Locally / per-tool (no Docker — and NOT me editing other repos)
4. **Make the fleet matrices honest** — DanteCode/DanteSecurity/DanteAgents/DanteHarvest self-grade 6–8 with
   evidence ~0. Per the operator correction ("my job is the prompt, not editing other repos"), hand each
   tool's OWN agent the honest climb prompt (`HONEST_CLIMB_PROMPT.md`) to re-author its matrix with real
   callsites + receipts. Start with DanteCode (smallest, closest to real).

## The honest framing (don't lose it)
Measurement = done + transferable. Capability climb = genuine R&D (proven, not assumed — env-fidelity wall).
Full unattended autonomy is NOT the target; the council's verdict stands: **human ratifies the yardstick,
machine measures and climbs.** The measurement half is the win; it now tells the truth across every tool.
