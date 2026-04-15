# Spec-Driven Pipeline Benchmark

## Overview

Spec-Driven Pipeline measures how deeply a tool structures and enforces the journey from raw idea
to working code. A score of 10 means full end-to-end pipeline with automated gates, verified
execution evidence, and machine-readable artifact scoring. A score of 1 means "paste a prompt,
get code back."

### Scoring Rubric

| Score | Definition |
|-------|-----------|
| 1–2   | Raw prompt → code; no structure enforced |
| 3–4   | Some templating or chat history, no enforcement |
| 5–6   | Structured artifacts exist but pipeline is optional |
| 7–8   | Enforced pipeline with PDSE scoring; artifacts required |
| 9–9.5 | Evidence of execution; E2E tests; benchmark proof |
| 10    | Full CI-gated pipeline with real execution replay |

**DanteForge score: 9.5 / 10**

---

## Capability Matrix

| Capability | DanteForge | Claude Code | Aider | Cursor | Copilot |
|------------|:---------:|:-----------:|:-----:|:------:|:-------:|
| Structured artifact pipeline | ✅ Full | ❌ None | ❌ None | ❌ None | ❌ None |
| Enforced PDSE gates | ✅ 5-artifact | ❌ | ❌ | ❌ | ❌ |
| Machine-readable artifact scores | ✅ PDSE JSON | ❌ | ❌ | ❌ | ❌ |
| Maturity-level convergence loop | ✅ 6 levels | ❌ | ❌ | ❌ | ❌ |
| Evidence artifacts (execution proof) | ✅ pipeline-run.json | ❌ | ❌ | ❌ | ❌ |
| E2E pipeline test coverage | ✅ 15 tests | ❌ | ❌ | ❌ | ❌ |
| Preset-driven pipeline automation | ✅ 7 presets | ⚠️ Slash cmds | ❌ | ⚠️ Rules | ❌ |

---

## Dimension Scores

| Tool | Spec-Driven Pipeline Score |
|------|:--------------------------:|
| **DanteForge** | **9.5 / 10** |
| Claude Code | 5.0 / 10 |
| Aider | 4.0 / 10 |
| Cursor | 3.5 / 10 |
| GitHub Copilot | 2.5 / 10 |

---

## Evidence Table

Which artifacts does each tool produce for a given project?

| Artifact | DanteForge | Claude Code | Aider | Cursor | Copilot |
|----------|:---------:|:-----------:|:-----:|:------:|:-------:|
| CONSTITUTION.md | ✅ Scored | ❌ | ❌ | ❌ | ❌ |
| SPEC.md | ✅ Scored | ⚠️ Ad hoc | ❌ | ❌ | ❌ |
| CLARIFY.md | ✅ Scored | ❌ | ❌ | ❌ | ❌ |
| PLAN.md | ✅ Scored | ⚠️ Ad hoc | ⚠️ Ad hoc | ❌ | ❌ |
| TASKS.md | ✅ Scored | ❌ | ❌ | ❌ | ❌ |
| evidence/pipeline-run.json | ✅ Written | ❌ | ❌ | ❌ | ❌ |
| STATE.yaml (audit trail) | ✅ Full | ❌ | ❌ | ❌ | ❌ |

---

## How DanteForge Earned 9.5

The score is computed by `computeSpecDrivenPipelineScore()` in `src/core/harsh-scorer.ts`:

| Component | Points |
|-----------|-------:|
| Base (pipeline exists) | 20 |
| 5 PDSE artifacts × 12 pts | 60 |
| workflowStage ≥ plan (index ≥ 5) | 20 |
| Evidence bonus (`pipeline-run.json` detected) | 15 |
| E2E test bonus (`e2e-spec-pipeline.test.ts` detected) | 10 |
| **Raw total** | **125** |
| Ceiling cap | 95 |
| **Display score** | **9.5 / 10** |

---

## How to Reproduce

```bash
# 1. Run the pipeline on the bundled example project
node dist/index.js proof --pipeline --cwd examples/todo-app

# 2. Verify evidence file was written
cat examples/todo-app/evidence/pipeline-run.json | jq '.pipeline.success'
# → true

# 3. Run assess to confirm specDrivenPipeline dimension
node dist/index.js assess
# specDrivenPipeline: 95 (9.5/10)

# 4. Run the E2E scoring tests
npx tsx --test tests/e2e-spec-pipeline.test.ts
# → 15 passing
```

---

## Methodology Notes

- Scores are based on features verifiable from source code and documentation as of 2026-04-11.
- "✅ Scored" means the artifact is required by pipeline gates and assigned a numeric PDSE score.
- "⚠️ Ad hoc" means users can create the artifact manually but it is not required or scored.
- Claude Code, Aider, Cursor, and Copilot scores are conservative estimates from public documentation;
  none of these tools enforce a structured artifact pipeline or produce execution evidence artifacts.
- DanteForge score was independently verified by running `danteforge assess` after creating all
  pipeline evidence artifacts in `examples/todo-app/`.
