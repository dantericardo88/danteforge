# DanteForge Finish-Line Masterplan

Date: 2026-04-20
Status: Active source of truth
Scope: Internal-first finish line for DanteForge itself

## 1. Authority

This document is the finish-line authority for the current repo.

When this document conflicts with older gap docs or stale competitive snapshots, this document wins:

- `docs/masterplans/DANTEFORGE_GAP_MATRIX.md`
- older finish-line notes
- the self-score currently stored in `.danteforge/compete/matrix.json`

The competitive matrix still matters, but only as directional market context. It is not the finish gate for this internal-first pass.

## 2. Scope Decision

We are building this for ourselves first.

That means:

- `community_adoption` is excluded from the finish gate until the first public launch push.
- External-enterprise proof is also not the finish gate yet.
- The in-scope replacement for that concern is `operator_readiness`: can DanteForge truthfully assess, verify, and operate its own repo without drift between code, state, and receipts?

## 3. Evidence Base

This plan is based on the following current evidence gathered on 2026-04-20:

- `npm run verify` -> PASS
- `npm run build` -> PASS
- `npm run check:truth-surface` -> PASS
- `npm run release:proof` -> PASS
- `node dist/index.js verify --json` -> FAIL

The failing operator-facing verify result is the most important new signal. The engineering gate is green, but DanteForge's own stateful verification surface still says the repo is not execution-complete because `STATE.yaml` is stuck at `clarify`, phase tasks are empty, and constitution/task state does not match the actual repo condition.

That means the finish line is no longer "make the repo healthy." The repo is already healthy.

The finish line is "make DanteForge able to truthfully recognize that health through its own workflow/state model."

## 4. Competitive Position

The stored competitive matrix at `.danteforge/compete/matrix.json` was last updated on 2026-04-15.

Directional takeaways from that matrix:

- Stored weighted self-score: `9.123/10`
- Stored weighted Claude Code score: `7.421/10`
- DanteForge is ahead of Claude Code on 16 of 18 stored dimensions
- Biggest stored advantages remain:
  - `spec_driven_pipeline`
  - `convergence_self_healing`
  - `self_improvement`
  - `token_economy`

That is still useful market context.

But the matrix is not the best source of truth for current self-scoring because:

- it predates today's verification pass
- it includes out-of-scope adoption pressure
- some self-scores are more generous than the current strict scorer

## 5. New Scorecard

### 5A. Scoring Method

Use this hierarchy:

1. Current strict score from `danteforge score --full --strict`
2. Current operator-proof signals from:
   - `danteforge verify --json`
   - `npm run check:truth-surface`
   - `npm run release:proof`
3. Competitive matrix only for relative positioning, not finish gating

### 5B. Current Scores

Current strict score:

- Full score, including adoption: `9.28/10`
- Scoped internal finish score, excluding adoption: `9.44/10`

Do not use the weighted average alone as the done signal.

Done means:

- every in-scope dimension is `>= 9.0/10`
- all hard proof gates are green
- the operator-facing verify surface agrees with the engineering reality

### 5C. In-Scope Finish Matrix

| Dimension | Current | Target | Status | Notes |
| --- | --- | --- | --- | --- |
| functionality | 10.0 | 9.0 | done | Stronger than the old matrix score. |
| testing | 9.4 | 9.0 | done | Full repo verify is green. |
| error_handling | 9.5 | 9.0 | done | Strong evidence and tests. |
| security | 9.5 | 9.0 | done | Audit and release-proof work improved this materially. |
| ux_polish | 10.0 | 9.0 | done | Clear, deliberate surface. |
| documentation | 9.9 | 9.0 | done | Public story is much tighter than before. |
| performance | 9.5 | 9.0 | done | Verify/build loop is now practical. |
| maintainability | 8.7 | 9.0 | gap | Biggest code-quality gap still in scope. |
| developer_experience | 9.0 | 9.0 | hold | At floor, not comfortably above it. |
| autonomy | 9.0 | 9.0 | hold | Good, but still near the floor. |
| planning_quality | 10.0 | 9.0 | done | This is one of the repo's clearest strengths. |
| self_improvement | 10.0 | 9.0 | done | Strong differentiation. |
| spec_driven_pipeline | 9.0 | 9.0 | hold | At target, but only just. |
| convergence_self_healing | 9.0 | 9.0 | hold | At target, but only just. |
| token_economy | 10.0 | 9.0 | done | Clear product advantage. |
| ecosystem_mcp | 10.0 | 9.0 | done | Another strong differentiator. |
| operator_readiness | 8.0 | 9.0 | gap | Hand-scored from current proof surfaces; replaces external-enterprise gating for this phase. |
| community_adoption | excluded | n/a | out-of-scope | Ignored until the public-launch phase. |

### 5D. Why `operator_readiness` Is 8.0

This is the replacement for external-facing `enterprise_readiness` during the internal-first phase.

It is scored from current repo evidence, not market proof:

- `npm run verify` passes
- `npm run build` passes
- `npm run check:truth-surface` passes
- `npm run release:proof` passes
- `danteforge verify --json` fails
- readiness/receipt authority still lags the current repo condition

That means operator readiness is no longer a 6.0 market-proof ceiling problem.
It is now an 8.0 internal truth/coherence problem.

## 6. Remaining Finish Gaps

There are only two true below-target dimensions left in scope:

1. `operator_readiness` at `8.0`
2. `maintainability` at `8.7`

There are also four "hold the floor" dimensions that are at target but not safely above it:

- `developer_experience`
- `autonomy`
- `spec_driven_pipeline`
- `convergence_self_healing`

Those should not be treated as solved forever. They need regression protection while we close the two real gaps.

## 7. Finish Definition

DanteForge is finished for this internal-first phase when all of the following are true:

1. Every in-scope dimension in Section 5C is `>= 9.0/10`.
2. `community_adoption` remains explicitly out-of-scope rather than silently dragging the score.
3. `node dist/index.js verify --json` passes on the current repo state.
4. The verify surface writes or refreshes a current receipt tied to the current workspace SHA.
5. `docs/Operational-Readiness-v0.17.0.md` reflects current receipts instead of stale ones.
6. `npm run verify` passes.
7. `npm run build` passes.
8. `npm run check:truth-surface` passes.
9. `npm run release:proof` passes.

## 8. Execution Order

### FL-1. Verify/State Coherence

Priority: P0
Size: M

What:

- Make the operator-facing `verify` command assess repo reality instead of failing on stale workflow bookkeeping.
- Decide which parts of `STATE.yaml` are authoritative for repo self-verification and which should be treated as advisory.
- Ensure verify receipts refresh correctly for the current repo state.

Where:

- `src/cli/commands/verify.ts`
- `src/core/state.ts`
- `src/core/completion-tracker.ts`
- `src/core/verify-receipts.ts`
- `tests/verify-json-e2e.test.ts`
- `tests/verify-light.test.ts`
- add/extend verify receipt freshness coverage where needed

Why:

This is the largest remaining trust gap in the whole project. Today the repo is healthier than DanteForge's own verify surface can admit.

Verification:

- `node dist/index.js verify --json` passes for the current repo state, or fails only for real current problems
- the resulting receipt is current-sha aware
- readiness regeneration reflects the new receipt truthfully

Dependencies:

- none

### FL-2. Receipt Authority and Readiness Truth

Priority: P0
Size: M

What:

- Make the readiness guide consume the latest real verify outcome instead of leaving stale verify authority in place.
- Ensure the operator docs and receipt snapshot are synchronized after real verification events.
- Tighten the "what is actually green" story so public and internal proof match.

Where:

- `src/core/readiness-doc.ts`
- `scripts/sync-operational-readiness.ts`
- `docs/Operational-Readiness-v0.17.0.md`
- `tests/readiness-doc.test.ts`
- any verify-receipt tests that cover stale/current transitions

Why:

The readiness guide is supposed to be a truth surface. Right now it still lags behind current repo reality.

Verification:

- a fresh verify run changes the rendered readiness guide
- stale and current receipts are distinguished correctly
- the guide no longer points people at obsolete verify state after a real current run

Dependencies:

- FL-1

### FL-3. Maintainability Lift

Priority: P1
Size: L

What:

- Reduce complexity and coupling in the highest-pressure command/core files.
- Extract clearer seams around large orchestration and scoring modules.
- Add focused regression coverage where refactors create new boundaries.

Where:

- `src/cli/index.ts`
- `src/core/ascend-engine.ts`
- `src/core/autoforge-loop.ts`
- `src/core/harsh-scorer.ts`
- `src/core/mcp-server.ts`
- related tests around those modules

Why:

Maintainability is the last pure code-quality dimension still below target. The score is good, but not yet locked.

Verification:

- strict maintainability score reaches `>= 9.0`
- no regression in `npm run verify`
- no regression in `npm run release:proof`

Dependencies:

- FL-1 can run in parallel
- FL-2 should land first if shared verify/readiness code is touched

### FL-4. Hold-the-Floor Regression Locks

Priority: P1
Size: M

What:

- Add regression protection for the dimensions sitting exactly at `9.0`.
- Prevent follow-up work from pulling down autonomy, developer experience, spec-driven pipeline, or convergence behavior while we refactor.

Where:

- `tests/cli-release-readiness.test.ts`
- `tests/init.test.ts`
- `tests/doctor.test.ts`
- `tests/completion-tracker.test.ts`
- `tests/workflow-surface.test.ts`
- other command-level smoke tests covering onboarding and pipeline truth surfaces

Why:

These are not problem areas today, but they are fragile enough to slip while we fix the last two real gaps.

Verification:

- no drop below `9.0` on:
  - `developer_experience`
  - `autonomy`
  - `spec_driven_pipeline`
  - `convergence_self_healing`

Dependencies:

- can begin alongside FL-3

## 9. Non-Goals Until Finish

Do not spend this cycle on:

- adoption work
- launch marketing polish
- new matrix dimensions
- new flagship commands
- external-enterprise storytelling

If a task does not improve:

- verify/state coherence
- receipt/readiness authority
- maintainability
- regression safety for floor dimensions

it is not finish-line work.

## 10. Practical Next Move

The next best step is FL-1.

If FL-1 closes cleanly, the finish line gets much shorter very quickly:

- operator readiness rises
- readiness truth rises
- public/internal proof finally agree

After that, maintainability becomes the only meaningful remaining below-target dimension.
