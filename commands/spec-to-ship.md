---
name: spec-to-ship
description: Run the Spec-to-Ship flow — guided wizard from goal statement to scored, verified output through the full DanteForge pipeline.
contract_version: "danteforge.workflow/v1"
stages: [build, score, synthesize]
execution_mode: sequential
failure_policy: stop
verification_required: true
---

# /spec-to-ship — Guided Spec-to-Ship Wizard

When the user invokes `/spec-to-ship`, ask what they want to build (a plain-English goal). Then execute:

1. Run `danteforge build "<goal the user stated>"` — the wizard:
   - Detects which pipeline stages are already complete from the filesystem (CONSTITUTION.md, SPEC.md, CLARIFY.md, PLAN.md, TASKS.md, src/ directory, lastVerifyStatus)
   - Prints a pipeline plan showing `[SKIP]` for done stages and `[RUN]` for pending stages
   - Shows the entry score before starting
   - Runs each pending stage in order: constitution → specify → clarify → plan → tasks → forge → verify
   - If a stage fails, the pipeline stops and reports which stage blocked it
   - Shows the exit score with delta from entry

   If the user wants to confirm each stage interactively: `danteforge build "<goal>" --interactive`

2. Run `danteforge score` — show the final score and top 3 remaining gaps.

3. Run `danteforge synthesize` — generate `UPR.md` (Unified Project Report) summarising the full pipeline outcome.

After all steps complete, report:
- Which stages ran and which were skipped
- Entry score → exit score delta
- Any stage that failed and why
- Path to the generated UPR.md

CLI parity: `danteforge build "<goal>" [--interactive]`
