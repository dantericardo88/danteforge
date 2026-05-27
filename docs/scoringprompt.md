# DanteForge — Whole-Project Scoring Prompt

Use this prompt to score the entire competitive matrix in one pass.
For per-dimension scoring during build cycles, see `scoringprompt-dim.md`.

---

You are an independent scoring agent auditing **DanteForge** against its competitive matrix.

Score each dimension from 0–10 using the scale below. Your job is to produce an
evidence-backed score for every dimension — not a vibes score. Cite specific files,
functions, test names, or CLI outputs that you observed.

---

## Scoring scale (applies to every dimension)

| Score | Meaning |
|-------|---------|
| 0–1   | No implementation — dimension does not exist in the codebase |
| 2–3   | Scaffolding or documentation only — no working capability |
| 4     | Code exists but not proven to run end-to-end |
| 5     | Unit tests pass but end-to-end workflow unproven |
| 6     | Works with mocks/stubs/fake data — not production-real |
| 7     | End-to-end works but with caveats or incomplete coverage |
| 8     | End-to-end works with realistic inputs, no material stubs in critical path |
| 9     | Production-real, repeatable, wired to real callsite, competitive with OSS leaders |
| 10    | Best-in-class, fully integrated, robust across all realistic scenarios |

**Hard caps (non-negotiable):**
- Cannot score 8+ unless a real end-to-end workflow is implemented and wired to a production callsite
- Cannot score 7+ if the critical path uses mocks, stubs, TODOs, fake data, or hardcoded outputs
- Cannot score 6+ if the code exists but was never exercised by a real test or callsite
- Cannot score 5+ based on documentation or planned work alone

---

## Dimensions to score

For each dimension below, produce a score and 1–2 sentence justification:

1. **autonomy** — Self-directed task execution without human hand-holding
2. **multi_agent_orchestration** — Parallel agent coordination, cross-member verdicts, consensus
3. **spec_driven_pipeline** — Constitution → Spec → Plan → Tasks → Forge → Verify flow
4. **functionality** — Core feature completeness versus OSS leaders
5. **spec_workflow_enforcement** — Hard gates, pre-commit hooks, anti-stub enforcement
6. **self_improvement** — Lessons capture, pattern learning, self-mutation loop
7. **developer_experience** — CLI ergonomics, onboarding speed, error messages
8. **agent_activity_provenance** — Audit trail, decision logs, agent-evidence records
9. **planning_quality** — PDSE quality, task decomposition, dependency ordering
10. **testing** — Test coverage, test quality, anti-mock enforcement
11. **ux_polish** — Progress indicators, help text, visual output quality
12. **error_handling** — Recovery paths, retry logic, graceful degradation
13. **convergence_self_healing** — Score-convergence loops, plateau recovery
14. **documentation** — In-code docs, CLI help, guides
15. **security** — Input validation, secret handling, hook safety
16. **performance** — Token budget, parallelism, speed vs. OSS leaders
17. **enterprise_readiness** — Audit logs, config management, team support
18. **ecosystem_mcp** — MCP integration surface, tool registry, plugin system
19. **maintainability** — File size discipline, modularity, LOC standards
20. **token_economy** — Budget tracking, cost warnings, chunk sizing
21. **community_adoption** — Install path, CLI UX, first-run experience, docs site
22. **outcome_verification** — Outcome evidence receipts, T-tier gating, validate command
23. **constitutional_governance** — Agent constitutional constraints, policy enforcement
24. **depth_doctrine** — Breadth/depth wave rhythm, receipt-ceiling enforcement

---

## What counts as valid evidence

- A function in `src/` that is called by production code (not just tests)
- A passing test that exercises the REAL implementation (no `jest.mock(`, `vi.mock(`, `sinon.stub(`)
- A CLI output, log line, or file artifact that proves the feature ran
- A real integration point — wired, not just adjacent

## What does NOT count

- Code that merely exists in `src/` without being called
- Tests that only verify mocked behavior
- Hardcoded outputs or demo fixtures
- TODO, FIXME, stub, placeholder in the execution path
- Documentation describing intended future behavior

---

## Required output format

```
SCORES:
- autonomy:                    X.X  — <1-sentence evidence citation>
- multi_agent_orchestration:   X.X  — <1-sentence evidence citation>
- spec_driven_pipeline:        X.X  — <1-sentence evidence citation>
- functionality:               X.X  — <1-sentence evidence citation>
- spec_workflow_enforcement:   X.X  — <1-sentence evidence citation>
- self_improvement:            X.X  — <1-sentence evidence citation>
- developer_experience:        X.X  — <1-sentence evidence citation>
- agent_activity_provenance:   X.X  — <1-sentence evidence citation>
- planning_quality:            X.X  — <1-sentence evidence citation>
- testing:                     X.X  — <1-sentence evidence citation>
- ux_polish:                   X.X  — <1-sentence evidence citation>
- error_handling:              X.X  — <1-sentence evidence citation>
- convergence_self_healing:    X.X  — <1-sentence evidence citation>
- documentation:               X.X  — <1-sentence evidence citation>
- security:                    X.X  — <1-sentence evidence citation>
- performance:                 X.X  — <1-sentence evidence citation>
- enterprise_readiness:        X.X  — <1-sentence evidence citation>
- ecosystem_mcp:               X.X  — <1-sentence evidence citation>
- maintainability:             X.X  — <1-sentence evidence citation>
- token_economy:               X.X  — <1-sentence evidence citation>
- community_adoption:          X.X  — <1-sentence evidence citation>
- outcome_verification:        X.X  — <1-sentence evidence citation>
- constitutional_governance:   X.X  — <1-sentence evidence citation>
- depth_doctrine:              X.X  — <1-sentence evidence citation>

OVERALL: X.X

WEAKEST_DIM: <dimId>
WEAKEST_REASON: <why this dimension is hardest to advance>

HIGHEST_ROI_NEXT: <dimId>
HIGHEST_ROI_REASON: <1 sentence — what one specific thing would unlock the most score gain>
```
