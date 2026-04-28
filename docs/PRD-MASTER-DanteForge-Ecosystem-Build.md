# PRD-MASTER: DanteForge Ecosystem Build
## The Canonical Build PRD for Trio-to-10 Plus Five Constitutional Additions

**Version:** 1.0
**Created:** 2026-04-26
**Author:** Founder (Ricky) + AI Council (Claude, Codex, GPT-5.5)
**Status:** Approved for Execution
**Target Build Window:** 7-10 calendar days at demonstrated build rate
**Build Rate Baseline:** 0.26 harsh-scorer-points per orchestrator-hour, 2-hour scaffolding cycles for new organs, 14-hour cycles for production hardening sprints
**Primary Executor:** Claude Code via `/oss-harvest` and `/inferno` commands
**Secondary Executor:** Codex (via `/oss-harvest --critic codex` for reconciliation)
**Hardware Profile:** RTX 4060 laptop primary orchestrator, RTX 3070 / 3060 / 4060 secondary nodes, RTX 3090 PC training node, max 2-3 parallel agent instances per founder constraint

---

## 1. Mission Statement

This PRD authorizes Claude Code to execute the next phase of DanteForge ecosystem build using the constitutional substrate already in place (Articles I-XII, harsh double scoring matrix, evidence chain, three-way promotion gate, KiloCode discipline). The work consists of five constitutional additions and one structural rebuild, all to be completed within the 7-10 day window at demonstrated build rate, with the goal of converting the current 9.6/10 trio (DanteForge, DanteCode, DanteAgents) plus paused Phase 0 organs (DanteDojo, DanteHarvest) into a production-ready 9+ ecosystem capable of running Real Empanada operations end-to-end.

The constitutional substrate is non-negotiable. Speed is a function of correctness, not a substitute for it. The build is over when the harsh double scoring matrix grades all current organs at 9.0+ across all dimensions including the new 18th dimension introduced in this PRD, and a real Real Empanada bookkeeping fine-tune has been served end-to-end through the new Truth Loop.

---

## 2. Constitutional Substrate (Existing, Non-Negotiable)

The following are already ratified and apply throughout this build. Claude Code must not violate any of these regardless of perceived shortcut value.

**Articles I-XII of the Constitution** as currently committed in `CONSTITUTION.md` of each repo. Specifically:

- **Article II: Five-Layer Moat**: PolicyGate → SovereignVerify → SoulSeal → CoinPurse → EvolveBrain. Inviolable order. Every operation passes through layers in sequence.
- **Article IX: KiloCode Discipline**: Every file under 500 lines of code, no stubs, no placeholders, no mock implementations in production paths.
- **Article X: OSS Pattern Learning**: Read OSS source to understand patterns. Write notes in own words. Close source. Implement clean-room version under MIT/Apache. Attribute pattern source in commit messages and module headers. No verbatim code. No GPL dependencies.
- **Article XI: Production-Ready Criteria**: 10 explicit criteria including 95%+ test pass rate, evidence chain integrity, golden path coverage, error recovery playbooks, performance benchmarks Grade A, three-way gate sign-off.
- **Article XII: Anti-Stub Enforcement**: Every test must be real, every implementation must be functional, no scaffolding-as-completion claims. The double competitive truth matrix grades against this.

**Harsh Double Scoring Matrix**: Every artifact gets scored once by the dimension scorer and once by the adversarial blind-audit scorer. Both must reach 9.0+ for promotion. This PRD adds an 18th dimension (see Phase 1).

**Evidence Chain**: All organ state lives in `.danteforge/` directories. Schema follows the PRD-26 Truth Loop format introduced in Phase 0. Every mutation emits a SoulSeal receipt.

**Three-Way Promotion Gate**: Forge policy + evidence chain integrity + harsh score, all three GREEN, required for any artifact to land in production state.

**Fail-Closed Semantics**: When in doubt, refuse. Missing evidence is not a passing grade. Unverifiable claims are unsupported, not provisional.

---

## 3. Hardware Reality and Parallelism Constraints

The founder operates from a single development workstation with the following capacity constraints, determined empirically during the previous build window:

**Primary orchestration host**: RTX 4060 laptop, capable of running 2-3 parallel Claude Code or Codex instances before RAM saturation (40-60GB consumed across instances). Cannot run 5 parallel instances. This was verified when DanteDojo and DanteHarvest scaffolding was paused on 2026-04-23 due to laptop capacity exhaustion.

**Secondary nodes**: RTX 3070 laptop (8GB VRAM), RTX 3060 laptop (6GB VRAM), can act as dedicated agent runners but not as primary orchestrator due to lower thermal headroom for sustained runs.

**Training node**: RTX 3090 PC (24GB VRAM, 936 GB/s memory bandwidth), reserved for DanteDojo training workloads. Idle while CPU-bound orchestration runs on laptop.

**No cloud GPU fallback during this build**. All work executes on local hardware.

**Operational rule**: Claude Code must not attempt to run more than 3 parallel sub-agents per orchestration session. Inferno mode max parallelism is 3, not 5. If a phase requires more than 3 parallel streams, sequence them across days rather than overload the laptop.

---

## 4. Build Sequence Overview

The build is structured as six phases executed in strict order. Each phase has explicit acceptance criteria and a three-way gate before the next phase begins. Phases 1, 2, 3, 4 may overlap in parallel within the 3-instance ceiling. Phase 0 must complete first because subsequent phases depend on its primitives.

| Phase | Name | Duration | Dependencies |
|-------|------|----------|--------------|
| **0** | Truth Loop Foundation (PRD-26) | 2-3 days | None (foundational) |
| **1** | Article XIII Constitutional Addition (RTK harvest) | 1-2 days | Phase 0 schemas |
| **2** | Five Dante-Native Skills (mattpocock harvest) | 3-4 days | Phase 0 truth loop substrate |
| **3** | Magic Level Skill Integration | 1-2 days | Phase 2 skills functional |
| **4** | OSS Matrix Updates (six new entries) | 1 day | Pattern notes from Phases 1-2 |
| **5** | End-to-End Validation Run | 1 day | All prior phases at 9.0+ |

Total: 7-10 calendar days at demonstrated rate. Center estimate 8 days. Buffer day for ML correctness validation surfaces (Dojo, Harvest) reserved for post-trio resumption.

---

## 5. Phase 0: Truth Loop Foundation (PRD-26)

This is the foundational phase. All subsequent phases consume primitives defined here. Build this first.

### 5.1 Source Pattern

Pattern source for the Truth Loop architecture is the manual reconciliation methodology the founder has been running for months: ask Codex, ask Claude, compare against repo evidence, reconcile contradictions, produce verdict, choose next action, repeat. The truth loop automates this process.

Reference document: `Dante Ecosystem Unified Spine + Truth Loop PRD v0.2` produced by GPT-5.5 on 2026-04-24. That document is the input specification. Honor it.

Structural pattern source for critic collection: `hex/claude-council` (https://github.com/hex/claude-council, MIT licensed, 41 stars, v2026.4.0). Specific patterns to harvest: debate mode protocol (Round 1 independent answers, Round 2 see each other's responses, synthesis identifies position changes and unresolved disagreements), role-based critic assignment (security, performance, simplicity, devil's advocate, scalability, dx, compliance), agent-enhanced critic mode (parallel Claude subagents that evaluate response quality and retry on vague responses), the debate-Round-2-not-cached rule (caching invalidates disagreement detection because Round 2 input is Round 1 output).

### 5.2 The Irreducible Six Schemas

Build these as JSON Schema files in `danteforge/src/spine/schemas/`. Do not start with eleven schemas. The six below are the minimum for a functioning factory cell. Additional schemas (Task, Claim, Score, Approval, Decision, Event, MemoryRecord) deferred to future PRDs and added only when concrete pain demands them.

**Run schema** (`run.schema.json`): Identifies one truth-loop execution. Fields: `runId` (format `run_YYYYMMDD_NNN`), `projectId`, `repo`, `commit`, `startedAt` (ISO 8601), `mode` (`sequential` | `parallel`), `initiator` (`founder` | `agent` | `ci`), `objective` (free text), `budgetEnvelopeId`.

**Artifact schema** (`artifact.schema.json`): Represents any input/output: commit, report, critique, test result, patch, prompt packet. Fields: `artifactId`, `runId`, `type` (enum: `repo_snapshot`, `commit_diff`, `test_result`, `external_critique`, `static_analysis`, `forge_score`, `human_note`, `prompt_packet`, `next_action`), `source` (`codex` | `claude` | `grok` | `gemini` | `repo` | `tests` | `human`), `createdAt`, `uri`, `hash` (sha256).

**Evidence schema** (`evidence.schema.json`): Represents verifiable proof tied to file/test/hash/log. Fields: `evidenceId`, `runId`, `artifactId`, `kind` (enum: `test_result`, `file_inspection`, `static_analysis`, `benchmark`, `hash_verification`, `human_confirmation`), `claimSupported` (free text describing what claim this evidence supports), `verificationMethod`, `status` (enum: `passed`, `failed`, `partial`, `missing`, `inconclusive`, `unsupported`), `location` (file path or URL), `hash`.

**Verdict schema** (`verdict.schema.json`): Final Forge judgment for a run. Fields: `verdictId`, `runId`, `summary`, `score` (0.0-10.0), `confidence` (`low` | `medium-low` | `medium` | `medium-high` | `high`), `blockingGaps` (array of strings), `unsupportedClaims` (array of strings), `supportedClaims` (array of strings), `contradictedClaims` (array of strings), `opinionClaims` (array of strings, claims marked as opinion not truth), `finalStatus` (enum: `complete`, `progress_real_but_not_done`, `blocked`, `escalated_to_human`, `budget_stopped`, `evidence_insufficient`).

**NextAction schema** (`next_action.schema.json`): Machine-readable continuation step. Fields: `nextActionId`, `runId`, `priority` (`P0` | `P1` | `P2`), `actionType` (enum: `implementation_prompt`, `targeted_test_request`, `human_decision_request`, `evidence_collection`, `budget_extension_request`), `targetRepo`, `title`, `rationale`, `acceptanceCriteria` (array), `recommendedExecutor` (enum: `codex`, `claude_code`, `kilo_code`, `human`), `promptUri`.

**BudgetEnvelope schema** (`budget_envelope.schema.json`): Cost/time/model/hardware limits. Fields: `budgetEnvelopeId`, `runId`, `maxUsd` (number), `maxMinutes` (number), `maxCritics` (integer), `executionMode` (`sequential` | `parallel`), `parallelismAllowed` (boolean), `hardwareProfile` (enum: `rtx_4060_laptop`, `rtx_3090_workstation`, `cloud_runner`, `ci_only`), `stopPolicy` (enum: `stop_on_budget`, `stop_on_unresolved_blocker`, `stop_on_budget_or_unresolved_blocker`).

### 5.3 CLI Contract

Implement one user-facing command. Subcommands are internal subroutines invoked in sequence.

```bash
forge truth-loop run \
  --repo . \
  --objective "Evaluate latest DanteForge progress and determine next action" \
  --critics codex,claude \
  --critique-file ./codex_critique.md \
  --critique-file ./claude_critique.md \
  --budget-usd 5 \
  --mode sequential \
  --strictness standard \
  --out .danteforge/truth-loop/latest
```

Internal subroutine sequence:
1. `collect-repo-state`: scan repo, capture commit hash, file tree, modified files, branch state. Emit as Artifact.
2. `collect-tests`: run test suite, capture pass/fail counts, failing test details. Emit as Artifact + Evidence.
3. `collect-artifacts`: scan `.danteforge/` for prior run state, score history, prior verdicts. Emit as Artifacts.
4. `import-critic-claims`: read critique files, parse claims, classify by type (mechanical, repo, architecture, prediction, preference, strategic). Emit each claim as an Artifact.
5. `reconcile`: for each claim, attempt verification against repo/test/artifact evidence. Mark as `supported`, `unsupported`, `contradicted`, `inconclusive`, or `opinion`. Emit reconciliation as Evidence.
6. `verdict`: synthesize claim states into a Verdict. Apply strictness mode rules (strict fails closed, standard allows partial verdicts with confidence downgrade, dev allows incomplete artifacts but marks clearly).
7. `commit-next-action`: emit NextAction with implementation prompt, target repo, recommended executor, acceptance criteria. Write prompt packet to `.danteforge/truth-loop/<runId>/next_action_prompt.md`.

### 5.4 Claim Classification Rules

| Claim Type | Example | Handling |
|------------|---------|----------|
| Mechanical | "Tests pass" | Verify against test output. Pass/fail. |
| Repo | "File X implements Y" | Verify against file inspection. Pass/fail. |
| Architecture | "Design A is better than B" | Mark as opinion unless backed by constraints/evidence. Log but don't promote to truth. |
| Prediction | "This will scale better" | Mark as forecast, not truth. May influence NextAction with low confidence weight. |
| Preference | "Founder prefers X" | Verify against memory or human confirmation. If neither, mark as inferred. |
| Strategic | "This should be the next product" | Can influence NextAction but cannot be labeled proven. Logged with strategic-claim flag. |

**Rule**: No external model claim is accepted as truth unless backed by evidence. **Rule**: Unsupported opinions are not discarded; they are logged as opinions and may influence NextAction generation if clearly labeled.

### 5.5 Disagreement Policy

| State | Meaning | Action |
|-------|---------|--------|
| Evidence settles it | One claim is proven, another is wrong | Accept evidence-backed claim |
| Evidence partially settles it | Some claim parts are proven | Split claim into supported/unsupported |
| Evidence does not settle it | Critics disagree, artifacts inconclusive | Generate targeted test or escalate |
| Opinion-only disagreement | Architecture/preference disagreement | Log as opinion, request human decision if blocking |
| High-risk disagreement | Security, money, legal, production risk | Fail closed and escalate immediately |

Default resolution order: inspect repo/artifacts → inspect tests/logs → split broad claims into atomic claims → mark each as supported/unsupported/contradicted/inconclusive → generate targeted test if possible → escalate to human only if unresolved AND blocking.

### 5.6 File Output Layout

```
.danteforge/
  truth-loop/
    run_20260427_001/
      run.json
      budget.json
      artifacts/
        repo_snapshot.json
        test_results.json
        codex_critique.md
        claude_critique.md
      evidence/
        evidence.jsonl
      verdict/
        verdict.json
        verdict.md
      next_action/
        next_action.json
        next_action_prompt.md
      report.md
    latest -> run_20260427_001
```

### 5.7 Phase 0 Acceptance Criteria

Phase 0 is complete when all of the following are GREEN:

1. `forge truth-loop run` works on a local repo without errors.
2. Creates valid `.danteforge/truth-loop/<runId>/` folder with all expected files.
3. Captures repo state, test state, artifact state correctly.
4. Imports at least one external critique from file (manual mode), parses claims by type.
5. Reconciles claims into supported/unsupported/contradicted/inconclusive/opinion categories.
6. Emits valid `verdict.json` matching schema.
7. Emits valid `next_action.json` matching schema.
8. Emits human-readable `report.md` summarizing the run.
9. Refuses to mark unsupported model opinion as proven truth (anti-stub test passes).
10. Has budget/time guardrails that actually trigger (budget stop test passes).
11. Generates next-action prompt usable by Codex/Claude/Kilo Code as input.
12. All six schemas validate against test fixtures (unsupported claim test, contradiction test, inconclusive opinion test, budget stop test).
13. Harsh double scoring matrix grades the truth loop implementation at 9.0+ on Functionality, Testing, Error Handling, Spec-Driven Pipeline, and the new Context Economy dimension introduced in Phase 1.
14. Three-way gate signs off on Phase 0 completion before Phase 1 begins.

### 5.8 Phase 0 Pilot Tests

After Phase 0 acceptance, run three pilot tests before declaring functional:

**Pilot 1 — Repo Truth Reconciliation**: Target the latest commit of DanteAgents `coin-purse` package. Question: "Did the floating-point precision fix in the latest commit resolve the boundary condition correctly, or are there remaining edge cases?" Critics: Codex (file critique), Claude (file critique). Expected: supported claims (commit landed, tests pass), unsupported claims (any agent claims about future scalability not backed by current tests), targeted test recommendation if edge cases remain.

**Pilot 2 — Architecture Boundary Audit**: Target DanteAgents `personal-trainer` package. Question: "Is this scaffold-level fine-tuning (prompt/loop tuning) or weight-level fine-tuning (model weights)?" Critics: Codex, Claude. Expected: file inspection evidence resolves the question definitively, scaffold-vs-weight classification published, Dojo overlap question resolved.

**Pilot 3 — Real Empanada Workflow**: Target Real Empanada RC Show lead follow-up data. Question: "Generate an outreach email to Sean Lippay at Strategic Food Solutions covering capacity, GFSI timeline, and pricing prep." Critics: Codex (business writing), Claude (business writing), with role assignment `--roles=persuasive,concise,grounded`. Expected: three drafts, debate mode round 2 critique each other, synthesis selects best draft with reasoning, human review checkpoint before send.

If all three pilots produce valid outputs at standard strictness, Phase 0 is functionally complete and Phase 1 begins.

---

## 6. Phase 1: Article XIII Constitutional Addition (RTK Harvest)

### 6.1 Source Pattern

Pattern source: `rtk-ai/rtk` (https://github.com/rtk-ai/rtk, license verification required before harvest, 28K stars). RTK is a Rust CLI proxy that compresses shell command output before it reaches the LLM context window, achieving 60-90% token savings on common dev commands. The principle being elevated: **every token entering the context window is a cost; verbose boilerplate must be compressed before context entry without losing load-bearing information**.

This is the first OSS pattern that rises to constitutional level. Treat the harvest accordingly. Article XIII becomes the 13th article of the Constitution. The 18th dimension joins the harsh scorer.

### 6.2 Article XIII Drafting

Draft Article XIII: Context Economy as a formal addition to the existing 12 articles. Length 150-250 words of load-bearing prose. Must include all five elements:

- **Principle**: Every token entering context is a cost. Context windows are finite. Verbose boilerplate that consumes tokens without providing value is a constitutional violation.
- **Rule**: Verbose shell output, repeated headers, passing-test noise, progress indicators must be filtered or compressed before context entry. Compression must be lossless on sacred content types.
- **Fail-closed exception**: Errors, warnings, security flags, constitutional violations, promotion gate failures, test assertion messages, and root-cause analysis chains are sacred content. Sacred content is never compressed.
- **Measurement requirement**: Token-savings telemetry must be emitted to `.danteforge/economy/` for ecosystem-wide visibility.
- **Scoring obligation**: Context Economy is the 18th harsh scorer dimension. Production readiness requires 7.0+ on this dimension.

The draft must be coherent with the existing 12 articles. Use the harsh double scoring matrix to grade the draft on coherence (9.0+ required) and testability (9.0+ required) before merge.

### 6.3 The 18th Harsh Scorer Dimension

Add to `.danteforge/HARSH_SCORER_DIMENSIONS.md` as the 18th dimension. Composite of five sub-metrics, each scored 0-10, dimension score is the average:

1. **Filter coverage**: Does the package filter verbose shell output through compression proxies or equivalent?
2. **Evidence compression**: Are `.danteforge/` artifacts compressed at write time using per-artifact-type rules?
3. **Telemetry emission**: Are token-savings metrics emitted to the shared `.danteforge/economy/` surface?
4. **Fail-closed compression**: Are sacred content types preserved (errors, warnings, violations, promotion gate failures)?
5. **Per-type rules**: Does the package have per-artifact-type compression rules rather than generic catch-all compression?

Production-ready threshold: composite 7.0+. Excellence threshold: 9.0+.

### 6.4 PRD-26b: Dante Context Economy Layer

Generate this as a follow-on PRD building on Phase 0's truth loop substrate. Specification:

**Language**: Python or TypeScript per existing language profile of the consuming organ. Do not introduce Rust into the Dante stack for one component. Performance overhead of Python/TS shell-output filtering is invisible against LLM network round-trip time (<50ms vs. >500ms).

**Architecture**: PreToolUse hook pattern installed at the Claude Code / Codex configuration layer. When the agent attempts to run a shell command, the hook intercepts, runs the underlying command, captures full output, applies per-command filter, returns compressed output to the agent. Original full output stored in `.danteforge/economy/raw/<runId>/` for audit if needed.

**Per-command filter modules**: Implement filters for the top 10 commands: `git`, `cargo`, `pnpm`, `npm`, `eslint`, `pytest`, `jest`, `vitest`, `docker`, `find`. Each filter is a focused module under 200 LOC, KiloCode-disciplined. Filter logic: identify boilerplate patterns specific to that command, preserve sacred content, summarize repetition, output compressed but information-equivalent stream.

**`danteforge economy` CLI command**: Reports ecosystem-wide token savings from the `.danteforge/economy/` telemetry surface. Outputs total commands intercepted, tokens saved, savings ratio, top commands by savings, organs scoring lowest on dimension 18 (regression detection).

**Evidence chain compression layer**: Compress `.danteforge/` artifacts at write time. Per-artifact-type rules: test results compressed differently than benchmark output differently than evidence receipts differently than verdicts. Sacred content preserved across all types: errors, warnings, security flags, constitutional violation reports, promotion gate failure details, SoulSeal hash chain integrity.

**Threshold passthrough**: If compression yields less than 10% gain, pass through unchanged. Avoids overhead on already-compact output.

### 6.5 Phase 1 Acceptance Criteria

1. License of `rtk-ai/rtk` verified compatible (MIT, Apache-2.0, or BSD). If GPL, downgrade to inspiration-only and exclude direct integration; harvest patterns clean-room only.
2. `.danteforge/OSS_HARVEST/rtk_patterns.md` produced with minimum 8 patterns extracted, each cited to specific RTK source files/lines, paraphrased in own words, with PRD mapping.
3. `.danteforge/oss-registry.json` updated with RTK entry: `competitor_tier: foundation_for_constitutional_article`, `status: pattern_harvest_complete`, dimension overlaps including the new 18th dimension.
4. Article XIII drafted as formal addition to `CONSTITUTION.md`, scoring 9.0+ on coherence and 9.0+ on testability via harsh double scoring matrix, three-way gate signed off.
5. 18th dimension specification added to `.danteforge/HARSH_SCORER_DIMENSIONS.md` with five sub-metrics fully defined.
6. PRD-26b: Dante Context Economy Layer drafted and ready for build (build itself deferred to post-trio-completion if needed; PRD and constitutional substrate are sufficient for Phase 1).
7. Baseline scoring of existing trio (DanteForge, DanteCode, DanteAgents) on the new 18th dimension, captured in `.danteforge/CONTEXT_ECONOMY_BASELINE.md`. Scoring is data, not judgment — establishes starting point.
8. Updates to existing PRD backlog (PRD-24, PRD-25, Dojo PRD v1.0, Harvest backlog) adding Context Economy specifications: expected context footprint, expected compression ratio, sacred content types.

### 6.6 Phase 1 Non-Goals

- Do not install RTK as a dependency. Pattern-harvest only.
- Do not bundle Rust into the Dante stack. Dante-native primitive in Python or TypeScript only.
- Do not implement PRD-26b (the Context Economy Layer code) in Phase 1. PRD writing only. Implementation deferred until after trio reaches 9.0+ on all dimensions including the new one.
- Do not retroactively rewrite existing organs to satisfy Context Economy in Phase 1. Baseline scoring only. Remediation happens incrementally as dimensions get re-scored.

---

## 7. Phase 2: Five Dante-Native Skills (mattpocock Harvest)

### 7.1 Source Pattern

Pattern source: `mattpocock/skills` (https://github.com/mattpocock/skills, MIT licensed, 23.7K stars). The repo is Matt Pocock's daily-use AI agent skills extracted from his real workflow. The repo's positioning ("Agent Skills for Real Engineers, not vibe coding") aligns structurally with Dante's KiloCode discipline and harsh-scoring ethos.

The harvest harvests structural patterns plus content patterns. Five skills are selected for Dante-native rebuild because they benefit from constitutional substrate (evidence chain, harsh scoring, three-way gates). Other skills in Matt's repo are skipped — they don't benefit from constitutional substrate and remain available via vanilla `npx skills@latest` install for users who want them.

### 7.2 The Five Dante-Native Skills

Each skill is a slash command in DanteForge, a structured prompt-plus-workflow, evidence-emitting, harsh-scoring, three-way-gated. Each skill is roughly 200-400 LOC of Dante-specific wrapping plus the skill's prompt content. KiloCode discipline applies.

#### 7.2.1 `/dante-to-prd`

**Pattern source**: `mattpocock/skills/to-prd`. Conversation → PRD → GitHub issue.

**Constitutional additions**:
- Emits PRD into `.danteforge/PRDs/` with full Run + Artifact + Evidence chain
- Runs harsh-scorer pre-flight on the generated PRD against all 18 dimensions including new Context Economy
- Requires three-way gate sign-off before the GitHub issue gets filed
- Includes constitutional checklist section in every generated PRD: KiloCode discipline confirmation, fail-closed semantics specification, evidence emission specification, sacred content type identification, expected context footprint

**Acceptance criteria**: Skill runs end-to-end on a real conversation, produces a PRD that scores 9.0+ on Spec-Driven Pipeline and Planning Quality dimensions, three-way gate signs off, GitHub issue created with full evidence chain link.

#### 7.2.2 `/dante-grill-me`

**Pattern source**: `mattpocock/skills/grill-me`. Interview-driven plan refinement.

**Constitutional additions**:
- Integrates claude-council debate mode patterns from PRD-26 (Round 1 independent answers, Round 2 critique each other, synthesis identifies position changes and unresolved disagreements)
- Emits each interview turn as Evidence into `.danteforge/grill-sessions/<sessionId>/`
- Applies the unresolved-disagreement protocol from Phase 0 truth loop when interviewer and interviewee hit irreconcilable positions
- Scores the final plan on Planning Quality dimension before declaring complete (9.0+ required)
- Optional `--roles=balanced` flag activates multi-perspective grilling using the role taxonomy from claude-council patterns

**Acceptance criteria**: Skill runs end-to-end on a real planning question, produces a grilled plan that scores 9.0+ on Planning Quality dimension, identifies and surfaces at least 3 hidden assumptions in the original plan, integrates with truth loop verdict format.

#### 7.2.3 `/dante-tdd`

**Pattern source**: `mattpocock/skills/tdd`. Red-green-refactor TDD loop.

**Constitutional additions**:
- KiloCode discipline enforced during refactor step (blocks any file growing past 500 LOC, requires extraction)
- Harsh-scorer dimension check on the test suite after each cycle (Testing dimension 9.0+ required to proceed)
- Evidence emission for each red-green-refactor transition as separate Artifacts
- Sacred content preservation rule for test names and assertion messages (never get compressed by Context Economy filters)
- Three-way gate before any commit lands

**Acceptance criteria**: Skill runs end-to-end on a real coding task, produces a test suite that scores 9.0+ on Testing dimension, all KiloCode discipline rules enforced (no file >500 LOC), three-way gate signs off on each commit, evidence chain shows complete red-green-refactor history.

#### 7.2.4 `/dante-triage-issue`

**Pattern source**: `mattpocock/skills/triage-issue`. Bug investigation with root-cause analysis.

**Constitutional additions**:
- SoulSeal receipt for the root-cause analysis itself (chain of reasoning is signed and auditable)
- Three-way gate before any proposed fix lands
- Integration with evidence chain so triage history is queryable from `.danteforge/incidents/`
- Harsh-scorer Error Handling dimension check on the proposed fix (9.0+ required)
- Optional `--mode=adversarial` flag invokes claude-council debate mode on the root cause hypothesis

**Acceptance criteria**: Skill runs end-to-end on a real bug, produces a root cause analysis with SoulSeal receipt, proposed fix scores 9.0+ on Error Handling dimension, three-way gate signs off, incident history queryable.

#### 7.2.5 `/dante-design-an-interface`

**Pattern source**: `mattpocock/skills/design-an-interface`. Parallel sub-agents producing radically different designs.

**Constitutional additions**:
- Each sub-agent emits its design as a separate Artifact with full evidence trail
- Synthesis step runs through claude-council debate mode protocol to identify which design's tradeoffs win on which dimensions
- Final selection emits a Verdict and NextAction matching truth loop schema
- Maximum 3 parallel sub-agents per laptop hardware ceiling (not the 5+ that Matt's vanilla version may default to)
- Harsh-scorer dimension check on each design before synthesis (9.0+ on relevant dimensions)

**Acceptance criteria**: Skill runs end-to-end on a real interface design question, produces 3 distinct design options each scoring 9.0+ on relevant dimensions (Maintainability, Developer Experience, Performance per applicable), synthesis selects winner with reasoning, NextAction emitted for chosen design.

### 7.3 Skill Frontmatter Standard

Every Dante-native skill includes this frontmatter block:

```yaml
---
name: dante-<skill-name>
based_on: mattpocock/skills/<original-skill>
attribution: |
  Pattern derived from Matt Pocock's skills repository (MIT licensed).
  Original at https://github.com/mattpocock/skills/tree/main/<skill>.
  Dante-native implementation adds: evidence chain emission, harsh-scorer
  pre-flight, three-way promotion gate, constitutional preservation rules.
license: MIT
constitutional_dependencies:
  - .danteforge/evidence-chain
  - .danteforge/harsh-scorer
  - .danteforge/promotion-gate
  - .danteforge/economy
required_dimensions:
  - <list of harsh-scorer dimensions this skill must score 9.0+ on>
sacred_content_types:
  - <list of content types this skill must preserve from compression>
---
```

This is non-negotiable per Article X. Attribution lives in the skill frontmatter, not buried in a credits file.

### 7.4 Phase 2 Build Order

**Day 1**: Ship `/dante-to-prd` as standalone slash command. Highest-value single skill, proves the Dante-native pattern works. Includes evidence emission scaffolding, harsh-scorer integration, three-way gate, constitutional preservation rules. Meta-test: have the skill bootstrap its own PRD ("PRD-27: Dante-Native Skills System").

**Day 2**: Ship `/dante-grill-me` and `/dante-tdd` in parallel on instances B and C while instance A handles `/dante-to-prd` polish. By end of day 2, three skills working independently.

**Day 3**: Ship `/dante-triage-issue` and `/dante-design-an-interface`. By end of day 3, all five Tier A skills working as standalone factory cells.

### 7.5 Phase 2 Acceptance Criteria

1. All five skills produce valid output on real test cases (not toy examples).
2. Each skill scores 9.0+ on the harsh double scoring matrix on its required dimensions.
3. Each skill emits valid evidence into `.danteforge/skill-runs/<skill-name>/<runId>/` matching truth loop schema.
4. Each skill's three-way gate signs off correctly on test cases.
5. Attribution frontmatter present and correct on all five skills.
6. No verbatim code from Matt's skills (clean-room implementation verified by harsh double scoring matrix anti-stub check).
7. KiloCode discipline maintained: every skill module under 500 LOC.
8. `.danteforge/OSS_HARVEST/mattpocock_skills_patterns.md` produced with extracted patterns and attributions.

---

## 8. Phase 3: Magic Level Skill Integration

Once the five skills work as standalone slash commands, integrate them into the existing magic levels (spark, ember, canvas, magic, blaze, nova, inferno, ascend) for autonomous orchestration.

### 8.1 Magic Level Skill Orchestration Mapping

| Level | Skill Behavior |
|-------|----------------|
| **spark** | No skill orchestration. Single user-invoked actions only. |
| **ember** | Optional skill invocation. Agent uses `dante-grill-me` if it detects vague spec, but doesn't autonomously orchestrate multi-skill workflows. |
| **canvas** | Structured skill orchestration. Default workflow `dante-to-prd → dante-grill-me → dante-design → dante-tdd` for new feature work, with human checkpoints between each skill. Each skill emits evidence; human reviews evidence before next skill runs. |
| **magic** | Autonomous skill orchestration with checkpoint safety. Agent runs full skill workflow autonomously, pauses for human approval at three-way gate failures or unresolved disagreements (using truth loop disagreement protocol). |
| **blaze** | Autonomous skill orchestration with parallel exploration. `dante-design-an-interface` runs 3 sub-agents in parallel; synthesis runs through debate mode; winning design auto-proceeds to `dante-tdd`. Multiple workflows can run in parallel within 3-instance hardware ceiling. |
| **nova** | Autonomous skill orchestration plus harsh-scorer convergence loops. After each skill completes, harsh scorer runs against output; if any dimension below threshold, skill auto-runs again with dimension-specific failure as new prompt. Loops until convergence or budget exhaustion. |
| **inferno** | Full autonomous skill orchestration plus parallel exploration plus convergence loops plus deep OSS pattern mining. Most expensive level. Reserved for "ship a complete feature autonomously overnight" use cases. Budget envelope mandatory. Maximum parallelism capped at 3 per hardware constraint. |
| **ascend** | Meta-level. Orchestrates the magic levels themselves — picks the right level per task based on complexity, hardware availability, budget, and historical success rate. Truth loop substrate from PRD-26 is the underlying decision engine. |

### 8.2 Phase 3 Acceptance Criteria

1. Each magic level correctly invokes skills per the mapping above on test workflows.
2. Inferno mode caps parallelism at 3 per hardware ceiling and refuses to spawn more.
3. Ascend mode correctly classifies tasks and routes to appropriate magic level using truth loop verdict logic.
4. All magic-level orchestrations emit complete evidence chains traceable from initiating action through final commit.
5. Three-way gate failures correctly halt magic-mode execution and surface for human review.
6. Budget envelope enforcement works: inferno mode stops on budget exhaustion, emits partial verdict, does not produce false-completion claims.
7. Harsh double scoring matrix grades the magic-level integration at 9.0+ on Autonomy, Convergence Self-Healing, Token Economy, and Spec-Driven Pipeline dimensions.

---

## 9. Phase 4: OSS Matrix Updates

Six OSS projects evaluated during the planning phase need formal entries in `.danteforge/oss-registry.json`. Each entry includes license, status, categories, dimension overlaps, PRD mapping, competitor tier, notes.

### 9.1 OSS Matrix Entries to Add

| Entry # | Project | Status | Tier |
|---------|---------|--------|------|
| 19 | rtk-ai/rtk | pattern_harvest_complete | foundation_for_constitutional_article |
| 20 | hex/claude-council | pattern_harvest_complete | structural_pattern_source_for_PRD-26 |
| 21 | mattpocock/skills | pattern_harvest_complete | content_partner_dante_native_versions_built |
| 22 | tinyhumansai/openhuman | pattern_harvest_pending | secondary_pattern_source_components_only |
| 23 | EvoMap/evolver | pattern_harvest_pending | secondary_pattern_source_evolvebrain_skillmarket |
| 24 | hyperspaceai/aios-cli | reconnaissance_complete_no_harvest | declined_use_case_mismatch |

### 9.2 Phase 4 Acceptance Criteria

1. All six entries added to `.danteforge/oss-registry.json` with full metadata.
2. Each entry includes specific dimension overlaps and PRD mappings.
3. Pattern harvest documents (`.danteforge/OSS_HARVEST/<project>_patterns.md`) exist for all "pattern_harvest_complete" status entries with minimum 5 patterns each.
4. License compatibility verified for each entry; any GPL-licensed projects flagged with `pattern_harvest_only_no_integration`.
5. Competitor tier classification reviewed for accuracy against the framework: constitutional invariant addition vs. structural pattern source vs. content partner vs. tactical pattern vs. declined.

---

## 10. Phase 5: End-to-End Validation Run

The final phase validates the entire build by running a real Real Empanada workflow end-to-end through the new ecosystem.

### 10.1 The Real Empanada Validation Workflow

**Workload**: RC Show B2B follow-up campaign.

**Specific task**: Generate outreach email to Sean Lippay at Strategic Food Solutions. Sean is the highest-priority lead requiring capacity, GFSI timeline, and pricing prep response. The email must reference Real Empanada's actual capacity (Rational 202G + 102G combi ovens, 260kg spiral mixer, MFM 3600 forming machine), GFSI certification timeline, and pricing structure.

**Workflow execution**:
1. Founder invokes `forge truth-loop run --objective "Generate outreach email to Sean Lippay covering capacity, GFSI, pricing"` at magic level.
2. Magic level routes through `dante-grill-me` to refine the brief by interviewing the founder on tone, length, urgency, prior context.
3. Magic level invokes `dante-design-an-interface` (in this case, 3 different email designs: persuasive, concise, technically-grounded).
4. Each design scores against Persuasive Communication and Technical Accuracy dimensions.
5. Synthesis runs through debate mode, selects winning email.
6. Three-way gate signs off (Forge policy: outreach permitted; Evidence chain: all claims about capacity/GFSI verifiable; Harsh score: 9.0+ on relevant dimensions).
7. NextAction emits ready-to-send email to founder for human review.
8. Founder approves, sends, marks workflow complete in evidence chain.

### 10.2 Phase 5 Acceptance Criteria

The build is complete when:

1. The Sean Lippay outreach workflow runs end-to-end through magic level without errors.
2. Total wall-clock time from invocation to ready-to-send email is under 30 minutes.
3. Total cost (API + compute) is under $5.
4. Three-way gate signs off correctly.
5. Evidence chain is complete and queryable.
6. Founder reviews output and rates it 8.5+ on usability (qualitative human metric).
7. Email is actually sent (not just generated) — the loop closes on real business action.
8. Harsh double scoring matrix grades the entire ecosystem (DanteForge, DanteCode, DanteAgents) at 9.0+ on all 18 dimensions including the new Context Economy dimension.

If all eight criteria pass, the trio is at v1 with constitutional Context Economy invariant ratified, and the founder has the receipt that proves the ecosystem runs real business operations end-to-end. **This is the build's success state.**

If any criterion fails, identify the specific failure mode, file as a P0 NextAction, and iterate. Do not declare false completion.

---

## 11. /oss-harvest Command Usage Instructions

For each OSS project this PRD harvests, invoke `/oss-harvest` with the following standardized prompt template. Adjust per-project details as noted.

### 11.1 Standard Invocation Template

```
/oss-harvest

Target: <github URL>
Mission: <constitutional invariant addition | structural pattern source | content harvest | tactical pattern>
License verification: <required before harvest>

Acceptance criteria:
1. License of target verified compatible (MIT, Apache-2.0, BSD). If GPL, downgrade to inspiration-only.
2. .danteforge/OSS_HARVEST/<project>_patterns.md produced with minimum <N> patterns extracted.
3. Each pattern cited to specific source files/lines, paraphrased in own words, with PRD mapping.
4. .danteforge/oss-registry.json updated with full metadata entry.
5. <Constitutional artifact if applicable: Article draft, dimension specification, PRD>.

Constitutional discipline:
- No verbatim code from target. Pattern learning only. Clean-room reimplementation.
- All claims about target's behavior sourced to specific files and lines. No inferred capabilities.
- Article X discipline: read source, write notes in own words, close source, implement from notes.
- Anti-stub enforcement: any code generated must be real, not scaffolded.

Strictness mode: strict.
Critic protocol: harsh double scoring matrix grades the harvest before commit.

Expected output:
<list specific deliverables>
```

### 11.2 Specific Invocations for This PRD

**For RTK harvest (Phase 1)**: Use the full prompt from PRD-MASTER section 6 above. Mission: constitutional invariant addition. Minimum 8 patterns. Includes Article XIII drafting plus 18th dimension specification plus PRD-26b plus baseline scoring of trio.

**For claude-council harvest (Phase 0)**: Mission: structural pattern source for PRD-26. Minimum 5 patterns. Focus on debate mode protocol, role-based critic assignment, agent-enhanced critic mode, debate-Round-2-not-cached rule. Patterns inform Truth Loop critic-collection layer.

**For mattpocock/skills harvest (Phase 2)**: Mission: content partner with Dante-native versions. Per-skill harvest: read each of the five target skills (to-prd, grill-me, tdd, triage-issue, design-an-interface), extract the workflow structure and prompt patterns, build Dante-native version under MIT with full attribution. Patterns plus implementations.

**For OpenHuman, EvoMap, Hyperspace harvests (Phase 4)**: Mission: registry entry with notes; pattern harvest deferred to future windows unless concrete consuming PRD demands it. Minimum 3 patterns each. Status: `pattern_harvest_pending` for OpenHuman and EvoMap; `reconnaissance_complete_no_harvest` for Hyperspace.

---

## 12. /inferno Command Usage Instructions

Inferno is the most expensive magic level. Use it for sustained autonomous build sessions where the workload justifies the cost.

### 12.1 When to Use Inferno

**Appropriate uses**:
- Phase 0 implementation: build all six schemas plus CLI plus subroutines plus tests in one overnight session
- Phase 2 day 1: build `/dante-to-prd` end-to-end with evidence chain plus harsh-scorer integration plus three-way gate
- Phase 5 validation: run the Real Empanada workflow end-to-end as final acceptance test

**Inappropriate uses**:
- Reading PRDs (use spark or ember)
- Single bug fixes (use canvas or magic)
- Architectural decisions requiring human judgment (use grill-me skill at magic level, not inferno)

### 12.2 Standard Inferno Invocation Template

```
/inferno

Mission: <specific phase or sub-phase to build>
Reference PRDs: <list>
Reference patterns: <list of OSS_HARVEST documents to consult>
Budget envelope:
  max_usd: <appropriate cap, typically $20-50 for phase-level builds>
  max_minutes: <typically 4-8 hours for overnight runs>
  max_parallelism: 3
  hardware_profile: rtx_4060_laptop
  stop_policy: stop_on_budget_or_unresolved_blocker

Acceptance criteria: <reference relevant Phase acceptance criteria from PRD-MASTER>

Strictness mode: strict.
KiloCode discipline: enforced.
Anti-stub enforcement: enforced.
Three-way gate: required before any artifact commits.

Expected output:
<list specific deliverables>
<list of harsh-scorer dimensions that must score 9.0+ before completion>
```

### 12.3 Phase-Specific Inferno Invocations

**Phase 0 Inferno run**: 6-8 hour budget. Mission: implement Truth Loop substrate end-to-end. Output: six schemas + `forge truth-loop run` CLI + all internal subroutines + 12 acceptance test fixtures + three pilot tests passing. Stop conditions: any acceptance criterion below 9.0 on harsh double scoring matrix triggers iteration; budget exhaustion stops with partial completion artifact.

**Phase 2 day 1 Inferno run**: 4-6 hour budget. Mission: ship `/dante-to-prd` as standalone slash command with full constitutional substrate. Output: skill prompt + workflow + evidence emission + harsh-scorer integration + three-way gate + frontmatter + meta-test (skill bootstraps its own PRD).

**Phase 5 Inferno run**: 2-4 hour budget. Mission: run Real Empanada Sean Lippay outreach workflow end-to-end at magic level, capture full evidence chain, validate all 8 acceptance criteria. Output: ready-to-send email plus complete evidence trail plus harsh-score across all 18 dimensions.

---

## 13. Build Calendar (7-10 Day Target)

| Day | Phase | Activities | Primary Instance | Secondary Instance | Tertiary Instance |
|-----|-------|-----------|------------------|--------------------|--------------------|
| 1 | Phase 0 | Truth Loop substrate inferno run, schemas, CLI, subroutines | DanteForge build | claude-council pattern harvest | (idle / monitoring) |
| 2 | Phase 0 | Truth Loop tests, pilot 1 (coin-purse audit), pilot 2 (personal-trainer boundary) | DanteForge tests | RTK pattern harvest | (idle) |
| 3 | Phase 1 + Phase 2 | Article XIII drafting + dimension specification; `/dante-to-prd` build | DanteForge constitution | DanteForge skills (to-prd) | (idle) |
| 4 | Phase 2 | `/dante-grill-me` + `/dante-tdd` parallel build | dante-grill-me | dante-tdd | (idle) |
| 5 | Phase 2 | `/dante-triage-issue` + `/dante-design-an-interface` parallel build | dante-triage-issue | dante-design-an-interface | (idle) |
| 6 | Phase 3 | Magic level integration, ascend logic, parallel exploration | DanteForge magic | DanteAgents cross-checks | (idle) |
| 7 | Phase 3 + Phase 4 | Magic level testing, OSS matrix updates | DanteForge magic tests | OSS registry updates | (idle) |
| 8 | Phase 5 | Real Empanada workflow validation run, harsh-scorer ecosystem-wide evaluation | Validation | Score collection | (idle) |
| 9 | Buffer | Iteration on any failed acceptance criteria | (as needed) | (as needed) | (idle) |
| 10 | Buffer | Final harsh-score, three-way gate sign-off, build complete declaration | Sign-off | Documentation | (idle) |

**Note on tertiary instance**: Reserved for emergency parallelism only. Default operation is 2 instances; tertiary spins up only when primary blocks on long-running test or build operation. This honors the laptop hardware ceiling.

**Note on slippage**: If any phase slips, the buffer days (9 and 10) absorb the slip. If buffer is exhausted, Phase 5 (validation) is non-negotiable and Phase 4 (OSS matrix) gets compressed or deferred. The validation run is what proves the build, not the OSS registry entries.

---

## 14. Per-Project Detailed Specifications Summary

For ease of reference, here is the complete inventory of artifacts this PRD authorizes Claude Code to produce.

### 14.1 New Files to Create

| Path | Purpose |
|------|---------|
| `danteforge/src/spine/schemas/run.schema.json` | Truth loop Run schema |
| `danteforge/src/spine/schemas/artifact.schema.json` | Truth loop Artifact schema |
| `danteforge/src/spine/schemas/evidence.schema.json` | Truth loop Evidence schema |
| `danteforge/src/spine/schemas/verdict.schema.json` | Truth loop Verdict schema |
| `danteforge/src/spine/schemas/next_action.schema.json` | Truth loop NextAction schema |
| `danteforge/src/spine/schemas/budget_envelope.schema.json` | Truth loop BudgetEnvelope schema |
| `danteforge/src/spine/truth_loop/runner.{ts,py}` | Truth loop CLI runner |
| `danteforge/src/spine/truth_loop/collectors.{ts,py}` | Repo, test, artifact collectors |
| `danteforge/src/spine/truth_loop/critic_importer.{ts,py}` | External critique parser |
| `danteforge/src/spine/truth_loop/reconciler.{ts,py}` | Claim classification engine |
| `danteforge/src/spine/truth_loop/verdict_writer.{ts,py}` | Verdict emission |
| `danteforge/src/spine/truth_loop/next_action_writer.{ts,py}` | NextAction emission |
| `danteforge/skills/dante-to-prd/SKILL.md` | Dante-native PRD generation skill |
| `danteforge/skills/dante-grill-me/SKILL.md` | Dante-native interview skill |
| `danteforge/skills/dante-tdd/SKILL.md` | Dante-native TDD loop skill |
| `danteforge/skills/dante-triage-issue/SKILL.md` | Dante-native bug triage skill |
| `danteforge/skills/dante-design-an-interface/SKILL.md` | Dante-native interface design skill |
| `.danteforge/OSS_HARVEST/rtk_patterns.md` | RTK pattern harvest notes |
| `.danteforge/OSS_HARVEST/claude_council_patterns.md` | claude-council pattern harvest notes |
| `.danteforge/OSS_HARVEST/mattpocock_skills_patterns.md` | mattpocock pattern harvest notes |
| `.danteforge/OSS_HARVEST/openhuman_patterns.md` | OpenHuman pattern harvest notes |
| `.danteforge/OSS_HARVEST/evomap_patterns.md` | EvoMap pattern harvest notes |
| `.danteforge/OSS_HARVEST/hyperspace_patterns.md` | Hyperspace reconnaissance notes |
| `.danteforge/CONTEXT_ECONOMY_BASELINE.md` | Trio baseline scoring on dim 18 |
| `.danteforge/HARSH_SCORER_DIMENSIONS.md` (updated) | Add 18th dimension specification |
| `Docs/PRDs/PRD-26-truth-loop.md` | Truth loop PRD (already drafted by GPT-5.5; commit as canonical) |
| `Docs/PRDs/PRD-26b-context-economy-layer.md` | Context Economy implementation PRD (deferred build) |

### 14.2 Existing Files to Update

| Path | Update |
|------|--------|
| `CONSTITUTION.md` | Add Article XIII: Context Economy |
| `.danteforge/oss-registry.json` | Add 6 new entries (#19-#24) |
| `Docs/PRDs/PRD-24-personal-trainer.md` | Add Context Economy specifications |
| `Docs/PRDs/PRD-25-lovability-layer.md` | Add Context Economy specifications |
| `DanteDojo/Docs/PRDs/PRD-Dojo-v1.0.md` | Add Context Economy specifications |
| `DanteHarvest/Docs/PRDs/Harvest-backlog.md` | Add Context Economy specifications |

---

## 15. Success Metrics

The build is measurably successful if:

1. **Trio reaches 9.0+ on all 18 dimensions** including new Context Economy dimension. Measured via `danteforge measure --level=harsh-double` against each repo.

2. **Truth Loop runs end-to-end on real questions** without errors, producing valid evidence chains, verdicts, and next actions. Measured via 3 pilot tests passing (coin-purse audit, personal-trainer boundary, Real Empanada outreach).

3. **All 5 Dante-native skills function as standalone slash commands** plus integrated into magic levels canvas through inferno. Measured via skill execution on real test cases.

4. **Article XIII Context Economy is ratified** as constitutional invariant. Measured via formal merge of CONSTITUTION.md update.

5. **Real Empanada Sean Lippay outreach workflow runs end-to-end** through magic level, producing send-ready email, with full evidence trail, three-way gate sign-off, founder approval. Measured via Phase 5 validation run.

6. **OSS matrix has 24 entries** (existing 18 plus 6 new from this PRD). Measured via `.danteforge/oss-registry.json` content.

7. **Build completes within 7-10 calendar days** from authorization. Measured via commit timestamps.

8. **Total cost under $200** in API and compute charges across the build. Measured via budget envelope telemetry.

If 6 of 8 metrics pass, the build is successful with caveats. If 7 of 8 pass, the build is successful. If all 8 pass, the build is exemplary and the founder has full receipt of the ecosystem at v1.

---

## 16. Failure Modes and Recovery

Anticipate and pre-plan for the following failure modes.

| Failure Mode | Detection | Recovery |
|--------------|-----------|----------|
| Truth loop schemas don't validate | Phase 0 acceptance test fails | Fix schema, re-run validation, do not proceed to Phase 1 until GREEN |
| RTK license incompatible (GPL) | Phase 1 license check fails | Downgrade harvest to inspiration-only, skip direct integration recommendation, proceed with constitutional addition |
| Article XIII coherence score below 9.0 | Phase 1 harsh double scoring fails | Iterate the article draft up to 3 times; if still below 9.0, escalate to founder for direct review |
| Skill scoring below 9.0 on required dimensions | Phase 2 acceptance test fails | Iterate skill prompt and workflow; if 3 iterations don't cross threshold, defer skill to v0.2 and proceed with remaining 4 |
| Magic level orchestration produces evidence chain breaks | Phase 3 acceptance test fails | Identify break point, file as P0 NextAction, fix before proceeding to Phase 4 |
| Real Empanada workflow doesn't complete | Phase 5 validation fails | Capture failure mode in evidence, iterate, re-run; do not declare build complete until validation passes |
| Laptop hardware ceiling exceeded | Out-of-memory crashes during inferno | Reduce parallelism to 2, sequence remaining work across additional days |
| API budget exhausted before phase complete | Budget envelope triggers stop | Emit partial completion artifact, file P0 NextAction with remaining work, request budget extension from founder |
| Three-way gate keeps failing on a specific artifact | Same gate failure repeats > 2 times | Escalate to founder for human decision; do not loop indefinitely |

**Strictness mode default for this build**: strict. CI must use strict. Iteration runs may use standard if dev mode is needed for incremental progress. Never use offline mode (no critic consultation) for substantive decisions during this build.

---

## 17. Final Handoff Notes

This PRD is the canonical input for Claude Code to execute the next build phase. When invoking Claude Code, hand it this document with the following framing:

> This is PRD-MASTER for the DanteForge ecosystem build. Read it in full before beginning. Execute phases in strict order. Use `/oss-harvest` for Phases 1, 2, and 4 source pattern extraction. Use `/inferno` for Phase 0 substrate build, Phase 2 day-1 skill build, and Phase 5 validation run. Use standard magic level (`/magic`) for incremental work between inferno runs. Honor the constitutional substrate (Articles I-XII existing plus XIII new). Honor the hardware ceiling (max 3 parallel instances). Honor the harsh double scoring matrix (9.0+ required on all dimensions for completion). Honor the three-way promotion gate (Forge policy + evidence chain + harsh score, all GREEN). Do not declare false completion. The build is over when Phase 5 validation passes, not before.

The founder's role during this build:

- Day 1-3: review Phase 0 outputs, sign off on truth loop substrate before Phase 1 begins
- Day 4-5: spot-check skill outputs, sign off on each skill's three-way gate
- Day 6-7: review magic level integration, test inferno mode on a sample task
- Day 8: participate in Real Empanada workflow validation (provides the brief, reviews the email, sends it)
- Day 9-10: final review, ratify Article XIII formally, commit the v1 declaration

The founder explicitly reserves the right to:
- Halt any phase that produces output below 9.0 on harsh double scoring matrix
- Override the three-way gate only with explicit reasoning logged as a strategic-claim Artifact
- Adjust the build calendar based on real-world constraints (Real Empanada operational needs, family commitments, hardware availability)
- Defer Phase 4 (OSS matrix updates) if Phase 5 (validation) requires the buffer days

---

## 18. Appendix: References to Conversation-Generated Artifacts

This PRD synthesizes the following artifacts produced in the planning conversation:

- **Codex Vision Document** (2026-04-23): "Dante Ecosystem Unification Vision" — strategic north star for one-shared-spine-many-organs architecture. Adopted as long-term direction; tactical correction applied.
- **Claude Critique** (2026-04-23): pushback on Codex vision — added hardware-aware constraints, founder-time-budget reality, dimension-of-shared-memory split, failure-mode and recovery section. Incorporated into this PRD.
- **GPT-5.5 PRD v0.1** (2026-04-24): tactical correction of Codex vision — "build the first factory cell, not the whole factory." Foundation for Phase 0.
- **GPT-5.5 PRD v0.2** (2026-04-24): "Dante Ecosystem Unified Spine + Truth Loop PRD v0.2" — concrete specification for Truth Loop with six schemas, claim classification, disagreement policy, hardware profiles. Adopted as canonical Phase 0 specification.
- **Claude Reconciliation** (2026-04-24): meta-observation that the manual reconciliation between three AI systems is itself the truth loop being built; sharpened first-pilot from "DanteForge latest commit" to coin-purse floating-point fix; added "ship v0.2 and learn" recommendation. Incorporated into Phase 0 pilot tests.
- **OSS Pattern Reels Discussion** (2026-04-25 to 2026-04-26): five OSS projects evaluated (RTK, OpenHuman, EvoMap, Hyperspace, claude-council, mattpocock/skills); each classified into appropriate ecosystem layer; pattern harvests planned. Foundation for Phases 1, 2, 4.

These artifacts are the source material; this PRD-MASTER is the synthesis. The artifacts remain in the chat history for reference; this PRD is the canonical executable specification.

---

## 19. Document Version History

- **v1.0 (2026-04-26)**: Initial canonical PRD-MASTER. Synthesizes 24-hour planning conversation into single executable specification. Authorized for execution by founder.

---

**END OF PRD-MASTER**

*The build begins when the founder invokes `/oss-harvest --target=rtk-ai/rtk` or `/inferno --phase=0` with this PRD as context. Strictness mode strict. Three-way gate enforced. Constitutional discipline non-negotiable. Hardware ceiling respected. Real Empanada validation is the receipt.*
