# Requirements to Reach Verified 9.0 — Per Dimension

**Source:** Full adversarial evaluation (2026-05-25)  
**Purpose:** Give future council, inferno, or autonomous loops a clear target for each dimension. Only move a dimension to 9.0 when the specific evidence below exists.

**General Rule for 9.0 (applies to almost all dimensions):**
- At least one (preferably multiple) full autonomous multi-cycle run (crusade / frontier / inferno style) on or directly benefiting the dimension.
- 3+ fresh T7 or T8 outcome receipts from realistic inputs (not just unit tests or seams).
- Time Machine commits showing causal improvement.
- Evidence that harvested OSS patterns or council work were actually used in production code changes.
- No material mocks/stubs/TODOs in the critical execution path for that dimension.
- The outcome evidence must survive re-execution cold.

---

## High-Priority / Currently Weak Dimensions

### community_adoption (Current: 3.0)
**To reach verified 9.0:**
- Real external signals (stars, forks, issues, published packages, user reports, or measurable adoption metrics).
- At least one successful adoption-focused autonomous loop that produces documented external interest or usage.
- Dedicated T7+ outcomes that measure actual adoption signals (not just internal readiness scoring).

**Why currently low:** New module exists but almost no real-world usage evidence.

### security (Current: 5.0)
**To reach verified 9.0:**
- A clean, successful multi-cycle crusade on the security dimension itself that harvests real patterns and produces measurable hardening outcomes.
- T7+ outcomes that demonstrate the system autonomously improving security posture (e.g., finding/fixing real vulnerabilities or implementing security controls from OSS patterns).
- Evidence that previous total failure mode (0 patterns, failed forge waves) has been resolved in practice.

**Current blocker:** Last real crusade on this dimension was a complete failure.

### autonomy (Current: 6.5)
**To reach verified 9.0:**
- Multiple successful end-to-end autonomous loops (3+ cycles) on real dimensions without human rescue.
- Clear T7/T8 evidence that the system can self-correct, continue after partial failures, and drive dimensions upward over time.
- Proof that council + forge waves can operate with minimal intervention on non-trivial work.

**Current blocker:** Heavy dependence on the still-fragile crusade/forge pipeline.

### multi_agent_orchestration (Current: 7.5)
**To reach verified 9.0:**
- At least one full council-driven wave (parallel agents in worktrees + merge court + anonymous review) that produces real, verified competitive progress on one or more dimensions.
- T7+ outcomes that measure quality and reliability of the council process itself (not just that it runs).
- Evidence that the "builder-never-judges" model actually results in better outcomes than single-agent forge.

**Current state:** Council layer is strong structurally; the missing piece is proving it drives better results in autonomous loops.

---

## Core Differentiator Dimensions (Mostly 7.0–7.5)

### outcome_verification (Current: 8.0)
**To reach verified 9.0:**
- Broader coverage: High-tier outcomes defined and passing for most or all dimensions.
- Multiple T8-level outcomes (live, recent, high realism).
- Evidence that the verification system is actively used inside autonomous loops to gate progress (not just run after the fact).

**Already strong** — this is one of the closest to 9.0.

### agent_activity_provenance (Current: 8.0)
**To reach verified 9.0:**
- Time Machine used as a first-class tool inside autonomous loops (replays, counterfactuals, or provenance queries actually influencing decisions).
- T7/T8 outcomes that demonstrate the system using its own history to improve.

**Already one of the strongest areas.**

### depth_doctrine (Current: 7.5)
**To reach verified 9.0:**
- Multiple autonomous loops that visibly follow wave cadence (breadth → depth) with fresh evidence.
- Proof that the doctrine prevents premature "9.0" claims in practice.

### spec_workflow_enforcement (Current: 6.5)
**To reach verified 9.0:**
- Full spec → plan → tasks → forge → verify loops running autonomously with hard gates actually blocking progress when artifacts are missing.
- T7+ evidence on real projects showing the pipeline improves output quality.

### constitutional_governance (Current: 7.0)
**To reach verified 9.0:**
- Hard gates and CIP checks firing inside real autonomous multi-agent runs.
- Evidence that the system refuses to advance or claim high scores when constitutional requirements are not met.

### self_improvement (Current: 7.0)
**To reach verified 9.0:**
- Multiple cycles where the system identifies its own gaps (via evaluation or scoring), plans work, executes it, and produces measurable improvement — all with minimal human direction.
- Lessons / refused patterns / PRIME updates generated and used by subsequent autonomous runs.

### functionality (Current: 7.0)
**To reach verified 9.0:**
- The full designed autonomous capability (council + harvest + forge + verification) working reliably on real competitive gaps.
- Low rate of human intervention needed for typical loops.

### testing (Current: 7.0)
**To reach verified 9.0:**
- High coverage on the critical autonomous execution paths.
- Anti-stub and CIP enforcement proven effective in real runs (not just test suites).
- Evidence that testing quality improves as a result of autonomous work.

### developer_experience (Current: 7.5)
**To reach verified 9.0:**
- Realistic user-facing workflows (onboarding, long-running loops, error recovery) are smooth and well-supported during autonomous operation.

### documentation (Current: 8.5)
**To reach verified 9.0:**
- Documentation is actively maintained and improved by autonomous loops themselves.
- New capabilities come with high-quality docs as a natural output of the process.

### planning_quality (Current: 7.5)
**To reach verified 9.0:**
- Autonomous loops produce high-quality plans that lead to successful execution (measured by outcome success rate).

### spec_driven_pipeline (Current: 7.0)
**To reach verified 9.0:**
- The full spec-driven workflow (constitution → specify → plan → tasks → forge → verify) runs reliably in autonomous mode with gates enforced.

---

## Lower / Specialized Dimensions

### ux_polish (Current: 7.0)
**To reach verified 9.0:** Strong, repeated evidence of smooth user-facing flows being produced and improved by autonomous work.

### error_handling (Current: 6.5)
**To reach verified 9.0:** Autonomous loops demonstrate good recovery from partial failures, with clear logging and continuation.

### convergence_self_healing (Current: 6.0)
**To reach verified 9.0:** Multiple documented cases of the system detecting plateaus or regressions and self-correcting without external intervention.

### ecosystem_mcp (Current: 6.5)
**To reach verified 9.0:** Real, repeated use of MCP tools inside autonomous council/inferno runs with measurable benefit.

### maintainability (Current: 6.5)
**To reach verified 9.0:** Autonomous work visibly improves code quality metrics (file size, complexity, testability) over time.

### performance (Current: 5.5)
**To reach verified 9.0:** Concrete, repeated benchmarks showing autonomous improvements in speed, cost, or scalability.

### token_economy (Current: 5.5)
**To reach verified 9.0:** Measurable, sustained budget control and efficiency improvements across multiple autonomous runs.

### enterprise_readiness (Current: 4.0)
**To reach verified 9.0:** Significant dedicated work on multi-tenancy, compliance, auditability, RBAC, etc., with high-tier evidence.

---

## Summary Guidance for Next Council / Inferno Loop

- **Do not** aim for volume of dimensions.
- **Do** aim for depth on 2–4 dimensions per major loop, with excellent evidence.
- The fastest path to raising the overall verified score is fixing the execution loop reliability first, then targeting the currently weakest high-leverage dimensions (community_adoption, security, autonomy, multi_agent_orchestration).
- Every dimension that reaches 9.0 must have its own clear "receipt" trail in outcome-evidence + Time Machine.

Update this file (or the matrix) after every significant autonomous run with new evidence status.