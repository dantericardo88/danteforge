# depth_doctrine — Definition of Done for a REAL court-validated 9

Shared checklist for the builder + grader sessions. **Nobody declares victory until items 3–7 all land.**
The matrix currently records `self: 9` — that is **fiction**: it rests on a `--help` proxy capability_test
(item 5). The honest score is **~8** and stays there until the interrupt gate, the real capability_test,
AND a ≥2-session evidence campaign all land and the court validates. Auto re-entry shipping does **not**
move the score — the round that moves it is the **evidence round** (item 6), not a code round.

The frozen `frontier_spec` (target_score 9, `required_receipts: {min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: real-user-path}`) is what the frontier-review-court checks.

## Checklist

| # | Item | Kind | Status |
|---|------|------|--------|
| 1 | ≥3 independent loops emit identical WaveLedger receipts | code | ✅ DONE (CH-021: harden-crusade d684d81, autoforge f43bb90, ascend 8bde9b2 — each with an emission pin) |
| 2 | Replay / state-history queryable (`planReplay` + `danteforge wave list\|show\|replay`) | code | ✅ DONE (CH-022 read half: 890475a) |
| 3 | Auto re-entry — execution resumes from the planner's index | code | ✅ harden-crusade `--resume` (this round; runtime test: crashed run continues from wave K, not 0). ⬜ autoforge + ascend `--resume` wiring = mechanical follow-up (same `resolveResumeIndex` primitive) |
| 4 | Interrupt-before-score-write gate | code | ⬜ NOT STARTED. The spec names "human/machine interrupts before score writes or frontier declarations." **Cross-dim leverage** — the same gate is in the 9-row of constitutional_governance, spec_workflow_enforcement, planning_quality, multi_agent_orchestration. Do this next. |
| 5 | Replace the capability_test | test | ⬜ **LANDMINE.** Current: `node dist/index.js validate --help && node dist/index.js gap --help` — a pure `--help` reachability proxy. The court will NOT credit it for a 9. Must be rewritten to exercise a **crash → resume → interrupt** cycle end-to-end. Sequenced AFTER item 4 (nothing to test end-to-end until the interrupt gate exists). |
| 6 | Evidence campaign | evidence | ⬜ Run the real-user-path: `node dist/index.js harden --dim depth_doctrine` → `.danteforge/harden-report.json`, producing **≥3 T5+ outcomes across ≥2 distinct session_ids, fresh**. (Callsite `hardener-recency.ts` exists; 0 session-tagged outcomes currently → unsatisfied.) **This is the round that moves the score.** |
| 7 | frontier-review-court validates → score crosses to 9 | gate | ⬜ Only after 3–6. This would be the project's FIRST genuine court-validated 9 ("every self:9 was fiction") — proving the whole pipeline. |

## Sequencing (memory lesson: don't cram the full state-graph into one session)

1. **This round:** item 3 (auto re-entry, harden-crusade) + runtime test. ✅
2. **Next:** item 4 (interrupt-before-score-write gate) + item 5 (rewrite the capability_test to crash→resume→interrupt). Item 4 first (item 5 needs it).
3. **Then:** item 6 (evidence campaign, ≥2 sessions) → item 7 (court).

## Strategic note
depth_doctrine is the closest dim to a real 9, and the project has never crossed a court to a genuine 9.
Finishing this ONE dim honestly validates the entire scoring pipeline — worth doing before pivoting to
the breadth play. Do NOT raise `self` above 8 until item 7 passes.
