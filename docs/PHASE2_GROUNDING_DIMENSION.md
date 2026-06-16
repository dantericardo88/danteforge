# Phase 2 — the first externally-grounded dimension (`code_generation`)

This is the **verdict-changer**: the move that takes DanteForge's external-grounding ratio off 0% for
the first time. It is the one milestone all three independent assessments agreed changes the project's
honest verdict. This doc specifies it precisely so the run is a clean, well-defined step.

## What is built (verified, this session)

- `src/matrix/engines/swe-bench-grounding.ts` — the **generic grounding harness core**. Pure + seamed:
  it takes instances + a `solve` (agent) + a `runTest` (sandbox), **withholds the gold answer from the
  solver**, runs each candidate, and aggregates an honest `pass_rate`. `formatPassRateLine` emits the
  JSON `"pass_rate"` line that `external-benchmark-runner.parsePassRate` reads.
- `tests/swe-bench-grounding.test.ts` — 6 tests: gold-withholding, perfect→1.0, wrong→0, partial→fraction,
  throwing-solver→unresolved (never a silent pass), and a parsePassRate round-trip.

## The honesty constraints (do NOT shortcut these)

1. **Use a REAL registered suite, not toy data.** `@dantecode/swe-bench-runner`'s 25 built-in instances
   are hand-written `ts-utils__NNN` functions — a *smoke fixture*, **not** the SWE-bench dataset. Minting
   a "swe-bench" receipt off them would be a self-authored proxy dressed as an external anchor — the exact
   self-consistency trap the integrity arc exists to kill. A legitimate receipt MUST run the real suite:
   - **HumanEval** (164 Python problems, public, no Docker) — the recommended *cheap honest first* anchor.
   - **MBPP** (974 Python problems) — similar.
   - **SWE-bench-Lite / Verified** — heavier (Docker + real repos); escalate to this after HumanEval passes.
2. **The solver is DanteForge's own pipeline** (an agent generating the patch from the spec) — that is what
   makes the pass_rate a measure of *DanteForge-orchestrated code generation*, the DanteForge→DanteCode
   flywheel metric. The gold answer is never shown to the solver (the harness enforces this).
3. **The surface must be closed first (Phase 1).** Run `node scripts/sign-outcome-evidence.mjs` then set
   `DANTEFORGE_REQUIRE_SIGNED_EVIDENCE=1` so the grounding receipt lands on a signed, non-forgeable surface.
4. **Expect a modest first number.** Grounding MEASURES capability; it does not CREATE it. A true ~4–6 is a
   **success** (the first >0% externally-grounded score), not a regression against the 8.0 self-attested
   fiction it replaces. The gap from there to a grounded 9 is the named depth backlog (agents becoming
   frontier-grade solvers — a separate, model-and-orchestration-bounded effort).

## The new dimension (to register via the sanctioned matrix flow, after ratification)

```jsonc
{
  "id": "code_generation",
  "label": "Autonomous code generation",
  "category": "features",
  "weight": 1.5,
  // leader_target: HUMAN-RATIFIED ANCHOR — an agentic-coding tool's PUBLISHED score on the chosen suite.
  // An agent must NEVER author/soften this (that is self-grading). Example shape (numbers to be ratified):
  "leader_target": {
    "competitor": "<e.g. SWE-agent / OpenHands / Aider on HumanEval or SWE-bench-Lite>",
    "score": "<the competitor's published pass_rate on that suite>",
    "category_delta": "<what matching/beating it means>"
  },
  "frontier_spec": { "required_receipts": { "input_source": "external-benchmark" } },
  "outcomes": [
    {
      "id": "code_generation-humaneval-external",
      "kind": "external-benchmark",
      "tier": "T7",
      "benchmark": "humaneval",          // MUST be in REGISTERED_EXTERNAL_SUITES
      "min_pass_rate": "<honest threshold, human-ratified>",
      "command": "node scripts/run-humaneval-grounding.mjs",  // wires the harness to the REAL dataset + agent
      "input_source": { "type": "external-benchmark", "suite": "humaneval" }
    }
  ]
}
```

## The two human decisions that gate this (irreducibly human — the external anchor)

- **Which suite** to ground on first (HumanEval recommended).
- **The `leader_target`**: which agentic-coding tool, at what *published* score on that suite, is the bar.

These cannot be automated: an agent that picks its own suite or softens its own bar is self-grading. This
is the "human governs the anchor" residue — minutes of judgment, after which the loop runs the rest.

## Run, once ratified

1. Wire `scripts/run-humaneval-grounding.mjs`: load the real HumanEval dataset, `solve` = DanteForge agent,
   `runTest` = the HumanEval Python harness, print `formatPassRateLine(report)`.
2. Register the dimension above (with the ratified `leader_target` + `min_pass_rate`).
3. `node scripts/sign-outcome-evidence.mjs && DANTEFORGE_REQUIRE_SIGNED_EVIDENCE=1 danteforge validate code_generation`
4. Confirm `externalGroundingReport().weightedGroundingRatio > 0` — the verdict has changed.
