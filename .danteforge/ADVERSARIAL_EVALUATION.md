# Adversarial Evaluation — May 2026 (Grok)

**Date:** 2026-05-25  
**Evaluator:** Grok (full strict mode per super evaluation prompt)  
**Purpose:** Independent evidence-based scoring of all 24 competitive dimensions. All prior self-reported 9.0 claims treated as untrusted until verified.

## Overall Result
- **Verified overall score:** ~6.8–7.2 / 10 (weighted, actual competitors only)
- Previous claimed overall: 9.0
- Many dimensions downgraded from 9.0 claims to 6.5–8.0 range.
- Only a handful of dimensions have strong, recent, multi-receipt E2E evidence on realistic workloads.

## Systemic Findings (Why So Many Downgrades)

1. **Autonomous execution pipeline is the primary limiter**
   - The crusade → OSS harvest → forge wave loop has repeated silent or hard failures.
   - Known bug (partially addressed): `crusade.ts` `defaultRunOssPass` previously called the `oss` command with invalid `--auto` flag → always returned 0 patterns → forge waves had nothing to work with.
   - Even after partial fixes, pattern counting is still mostly hardcoded rather than parsed from real OSS reports.
   - Result: High "structural" scores on council, autoforge, and scoring, but weak proof that the full closed-loop autonomous system works end-to-end on competitive dimensions.

2. **Evidence quality vs. claims mismatch**
   - Many T5/T7 outcomes exist and some tests pass.
   - However, the outcomes often test narrow slices or use injection seams rather than full realistic user-facing workflows.
   - Time Machine and outcome-evidence system are real and active (strong point).

3. **"Self as leader" on most dimensions**
   - The matrix frequently lists `oss_leader: self` and `closed_source_leader: self`.
   - This is only credible when backed by recent, high-tier, externally comparable evidence. Much of it currently is not.

4. **Council/Multi-agent layer improved significantly**
   - Recent work (anonymous review, session resume, worktree safety, diff embedding, proper adapters) is real and high quality.
   - Still limited by the downstream harvest/forge execution layer.

## Key Dimension Status (Condensed)

### Strong / Differentiators (8.0+)
- **outcome_verification** (8.0) — Real T0–T8 system + active evidence files + working rescore script. One of the clearest strengths.
- **agent_activity_provenance** (8.0) — Time Machine is genuinely implemented and firing on recent runs.
- **documentation** (8.5) — Exceptionally thorough for this class of tool.

### Partially Verified / Needs More E2E (7.0–7.5)
- multi_agent_orchestration (7.5)
- depth_doctrine (7.5)
- developer_experience (7.5)
- planning_quality (7.5)
- constitutional_governance (7.0)
- self_improvement (7.0)
- functionality (7.0)
- testing (7.0)
- ux_polish (7.0)
- spec_driven_pipeline (7.0)

**Common gap:** Strong individual components and tests, but the full autonomous loop (harvest → council/forge → verified outcome on real competitive gaps) is not yet repeatedly proven.

### Clearly Capped / Structural or Early (≤6.5)
- autonomy (6.5) — Directly gated by the crusade/forge reliability problem.
- spec_workflow_enforcement (6.5)
- error_handling (6.5)
- ecosystem_mcp (6.5)
- maintainability (6.5)
- convergence_self_healing (6.0)
- performance (5.5)
- token_economy (5.5)
- security (5.0) — Latest real crusade on this dimension was a total 0-pattern failure.
- enterprise_readiness (4.0)
- community_adoption (3.0) — Very early (new module added recently).

## What Is Needed to Reach Verified 9.0 (Per Major Dimension)

### For dimensions currently 7.0–7.5 (most "core" ones)
- At least one full successful multi-cycle autonomous crusade or frontier run on that dimension (or a related weak one).
- 3+ fresh T7+ outcome receipts from realistic inputs (not just unit tests or injected seams).
- Time Machine commits showing causal improvement from the run.
- Evidence that the council or autoforge actually used patterns from real OSS harvest in a way that moved the competitive score.

### For autonomy / multi_agent_orchestration / spec_workflow_enforcement
- Fix any remaining silent-failure paths in crusade/oss integration.
- Demonstrate a full council-driven wave (multiple agents in worktrees + merge court) that closes a real gap and produces verifiable outcome evidence.
- Show the loop can run for 3+ cycles without human rescue on a non-trivial dimension.

### For security, performance, enterprise_readiness, token_economy
- Dedicated deep work (not just side-effect of general loops).
- Specific high-tier outcomes that exercise the claimed capability under realistic conditions.
- External or comparative evidence where possible.

### For community_adoption
- Actual adoption artifacts (stars, forks, real user reports, published packages, etc.) or clear, measurable signals of external interest. This one legitimately stays low for now.

## Recommended Focus for Next Council / Inferno Loop

**Priority 1 (Unblock everything else):** Finish hardening the crusade/oss/forge integration so autonomous loops stop silently failing or returning fake data.

**Priority 2:** Run a focused, well-instrumented council-assisted inferno or harden-crusade targeting 2–3 currently weak dimensions (community_adoption + security + one core differentiator). Insist on real pattern extraction, real forge waves, and fresh high-tier outcome evidence + Time Machine commits.

**Priority 3:** After the run, re-execute a lightweight adversarial review (or at least `node scripts/evidence-rescore.mjs` + manual spot checks) before updating the matrix again.

Do not declare broad 9.0 victory until at least one clean, fully evidenced autonomous loop has succeeded on multiple dimensions.

---

**Status for next agents:** Use this file + the current `.danteforge/compete/matrix.json` (which has been updated with the verified scores from this evaluation) as ground truth.

The previous optimistic 9.0 surface was largely structural + test-passing, not end-to-end autonomous capability on competitive gaps.

This evaluation was performed under the project's own strict doctrine. The gaps are the value.