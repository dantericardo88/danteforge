# PRD-FORGE-V1.1: DanteForge Closure and Ecosystem Integration Surfaces

**Version:** 1.0
**Created:** 2026-04-29
**Status:** Approved for Execution
**Target Repo:** github.com/dantericardo88/danteforge
**Implementation Agents:** substrate-Claude (primary), Codex
**Discovery Discipline:** Inspect commit f19e1d7 and any subsequent commits to determine current state. Most major substrate is already shipped. This PRD specifies the closure work to v1.0 plus the integration surfaces sister repos consume.
**Build Window:** 5-7 days at demonstrated build rate
**Current Baseline:** DanteForge 9.30 overall, 15/19 dimensions at 9+ per Codex Masterplan Closure Stamp 2026-04-29
**Implementation update 2026-04-29:** Pass 18 package surfaces are locally implemented but not npm-published. `@danteforge/evidence-chain` is bumped to v1.1.0 with `aggregateChildReceipts`; `@danteforge/truth-loop` v1.0.0 and `@danteforge/three-way-gate` v1.0.0 exist as workspace packages; legacy `src/spine/*` imports are compatibility adapters. MCP and sister-repo contracts now live in `docs/MCP_TOOL_SURFACE.md` and `docs/SISTER_REPO_INTEGRATION.md`. Founder-gated publication/adoption items remain pending.

---

## 1. Executive Summary

DanteForge is at 9.30 overall with 15 of 19 dimensions at 9.0+. Per the Codex Masterplan Closure Stamp committed 2026-04-29, the substrate is essentially at v1: proof spine sealed (Pass 11-17), Time Machine shipped end-to-end (Pass 17.5 / commit f19e1d7), Truth Loop substrate operational with 6 schemas + proof envelope, three-way gate enforcing constitutional discipline, four of five Dante-native skill executors shipped, magic skill orchestration runtime live, evidence-chain extracted as `@danteforge/evidence-chain` v1.0.0 npm package, Sean Lippay validation harness scaffolded.

This PRD specifies the closure work to formally seal v1.0 plus the explicit integration surfaces that PRD-CODE-V2 (multi-instance Council) and PRD-AGENTS-V1 (WhatsApp orchestrator) require to consume DanteForge cleanly. The work splits into three categories:

1. **Dimension closure** for the four remaining gaps (developerExperience 8.5→9+, specDrivenPipeline 8.5→9+, ecosystemMcp 6→9+, communityAdoption acknowledged as distribution problem requiring external visibility)
2. **Founder-gated work** that the substrate cannot self-complete (Article XIV ratification, Sean Lippay actual send, truth loop founder-confirmed closure, PRD-24 and PRD-25 authoring)
3. **Sister-repo integration surfaces** specifically the `aggregateChildReceipts` helper in evidence-chain v1.1, the `@danteforge/truth-loop` and `@danteforge/three-way-gate` package extractions, and the documented contracts that DanteCode v2 and DanteAgents v1 build against

Total work: 5-7 days at demonstrated rate. Most of it is closure rather than new functionality.

---

## 2. What's Already Shipped (Read Before Building)

This PRD assumes the following exists per commit f19e1d7. Implementation agents must verify before any extension work.

**Time Machine end-to-end.** `src/core/time-machine.ts` (549 LOC) plus `src/core/time-machine-validation.ts` plus `src/cli/commands/time-machine.ts`. CLI exposes commit, verify, restore, query, validate commands. Validation supports `--class A,B,C,E,F,G` flags and three DELEGATE-52 modes (harness default, import, live opt-in). `docs/TIME_MACHINE_VALIDATION_REPORT.md` exists with the truth boundary clearly documented (deterministic A/B/C/E/F/G harness evidence exists; live DELEGATE-52 publication evidence not yet executed).

**Truth Loop substrate.** `src/spine/truth_loop/runner.ts`, `proof.ts`, `ids.ts`, `types.ts`. Plus all six Irreducible Schemas in `src/spine/schemas/`: run, artifact, evidence, verdict, next_action, budget_envelope, plus proof_envelope and time_machine_validation. PRD-26 truth loop substrate from PRD-MASTER Phase 0 is shipped.

**Three-Way Gate.** `src/spine/three_way_gate.ts` enforces Forge policy + evidence chain integrity + harsh score, all three GREEN, before artifact promotion.

**Four Dante-native skill executors.** `src/spine/skill_runner/executors/dante-design-an-interface-executor.ts`, `dante-tdd-executor.ts`, `dante-to-prd-executor.ts`, `dante-triage-issue-executor.ts`. Plus runner at `src/spine/skill_runner/runner.ts` and types. Five-of-five status to verify (dante-grill-me may exist or need creation).

**Magic Skill Orchestration runtime.** `src/spine/magic_skill_orchestration/runtime.ts` ties skills into magic levels.

**Sean Lippay validation harness.** `src/spine/validation/sean_lippay_outreach.ts` and `sean_lippay_debate.ts`. Founder-gated final send still pending.

**Evidence-chain workspace package.** `packages/evidence-chain/` with package.json, LICENSE, README.md, CHANGELOG.md, src/index.ts, tsconfig.json. Locally bumped to v1.1.0 with `aggregateChildReceipts`; npm publication remains founder-gated.

**Codex Masterplan Closure Stamp.** `docs/CODEX_MASTERPLAN_CLOSURE_STAMP.md` documents canonical scores: DanteForge 9.30 (15/19), DanteCode 7.90 (8/19), DanteAgents 4.60 (0/19). Articulates remaining open items.

**Quality gates.** `npm run verify` runs typecheck + lint + anti-stub + tests. `npm run verify:all` adds proof-corpus integrity + CLI build + VS Code extension verification. `npm run check:proof-integrity` walks `.danteforge/evidence/` and verifies every Pass-11+ proof-anchored receipt.

**OpenSpec-style PRD folders.** `docs/PRDs/truth-loop-list/` and `docs/PRDs/truth-loop-diff/` use the per-change folder convention from OpenSpec harvest (proposal, specs, design, tasks, constitutional_checklist, surfaced_assumptions). This is the canonical PRD format going forward.

**Implementation agents:** before any new work, run `git log --oneline --since="2026-04-28"` to identify any commits since this PRD was drafted. The build velocity in DanteForge means the truth-on-disk may have moved past what this PRD assumes.

---

## 3. Section A: Four Dimension Gaps to Close

The four dimensions below 9.0+ per the closure stamp.

### 3.1 developerExperience (8.5 → 9.0+)

**Current state:** 8.5/10. Primary gaps likely in onboarding, documentation, error messages, and CLI ergonomics.

**Work to close:**
- Audit CLI help output for clarity and completeness on every command (commit, verify, restore, query, validate, score, proof, completion, truth-loop-list)
- Ensure every error message includes actionable next step (not just "failed" but "failed because X, try Y")
- Add `danteforge --help` top-level overview with command categorization
- Document the magic levels (magic, blaze, nova, inferno, ascend) with concrete examples in CONTRIBUTING.md or new docs/MAGIC_LEVELS.md
- Verify every npm script in package.json has a one-line description in the README

**Acceptance:** harsh scorer evaluates developerExperience at 9.0+. Founder confirms CLI feels easy to use on a fresh install test. Onboarding time to first successful task under 10 minutes on fresh machine.

**Effort:** 1 day.

### 3.2 specDrivenPipeline (8.5 → 9.0+)

**Current state:** 8.5/10. The truth-loop-list and truth-loop-diff PRDs in `docs/PRDs/` use the OpenSpec per-change folder pattern correctly. The pipeline likely needs the missing piece that automates spec-to-implementation handoff with full traceability.

**Work to close:**
- Verify `dante-to-prd` skill executor produces PRDs in the OpenSpec per-change folder format consistently
- Add automation that when a PRD is committed, an implementation tasks list is auto-generated and tracked through to completion
- Ensure every implementation commit references back to the spec it implements (via commit message convention or evidence chain link)
- Document the spec-driven pipeline end-to-end with one worked example (probably PRD-26 truth-loop or PRD-27 time-machine as the reference)

**Acceptance:** harsh scorer evaluates specDrivenPipeline at 9.0+. Founder can trace any production code line back to the spec section that authorized it within 60 seconds.

**Effort:** 1 day.

### 3.3 ecosystemMcp (6.0 → 9.0+)

**Current state:** 6.0/10. This is the largest gap. MCP integration likely partial. The 7 quality-gate MCP tools that DanteCode plugin manifest references are the load-bearing surface.

**Work to close:**
- Verify all 7 quality-gate MCP tools exposed via `src/core/mcp-server.ts` work correctly when invoked from external MCP clients (Claude Code, Cursor, generic MCP client)
- Document each MCP tool: name, parameters, returns, error modes, usage examples
- Add MCP tool discovery: external clients should be able to list available tools and get usage docs without source code access
- Test cross-client compatibility: same tool invocation from Claude Code and Codex produces identical evidence-chain receipts
- Ensure MCP server handles concurrent invocations cleanly (no race conditions on evidence chain writes)

**Acceptance:** harsh scorer evaluates ecosystemMcp at 9.0+. External MCP client can discover and use all 7 tools without source access. Concurrent invocations from 3 different clients produce clean evidence chain.

**Effort:** 2 days. Largest single piece of dimension closure work.

### 3.4 communityAdoption (1.5 — Distribution Problem)

**Current state:** 1.5/10. This dimension is fundamentally about external visibility, not internal capability.

**Honest framing:** communityAdoption cannot reach 9.0+ through internal build work. It requires external distribution: GitHub stars, npm downloads, blog posts, Twitter visibility, demo videos, builder community engagement. The builder-not-researcher publishing path discussed in our prior conversation is the route.

**Work to acknowledge, not close in this PRD:**
- Build the artifact set that makes external visibility possible: working demos (Time Machine reversibility on real document corruption, multi-agent composability on real workflow), short technical posts on blog or Substack with embedded video, GitHub repo public-readiness (README quality, examples directory, contribution guide)
- These are post-trio-ships work, not v1.1 closure work
- The closure stamp correctly identifies this as not founder-completable through substrate work alone

**Acceptance for this PRD:** explicit acknowledgment that 1.5 → 9+ is a distribution problem, not a substrate problem. Define the artifacts that would enable distribution (demo videos, technical blog posts, public-readiness checklist for the GitHub repo) but do not commit to executing distribution as part of v1.1 closure.

**Effort:** 0.5 days for documentation; distribution work itself is post-v1.1.

---

## 4. Section B: Founder-Gated Remaining Work

The closure stamp explicitly lists work that requires founder action and cannot be substrate-completed.

### 4.1 Article XIV Brand Asset Protocol Formal Ratification

**Status:** Article XIV identified as constitutional addition from Huashu Design pattern harvest. Substrate-side implementation for entity verification can be built; formal ratification requires founder explicit approval.

**Work for substrate-Claude:**
- Draft Article XIV text matching the pattern of Articles I-XIII (clear principle, scope, enforcement mechanism, examples)
- Specify the entity verification mechanism: when content generation involves real-world entities (brands, people, companies, products, regulations), verification against authoritative sources is required before generation
- Implement the pre-flight check in the truth loop runner: any artifact-generation step naming a real-world entity triggers verify_entity step before commit
- Update CONSTITUTION.md draft section pending founder ratification

**Work for founder:**
- Review Article XIV draft text
- Approve, revise, or reject
- If approved, formal ratification (CONSTITUTION.md commit by founder)

**Acceptance:** Article XIV either ratified (founder commit) or formally deferred with explicit reason. The substrate implementation exists either way; the constitutional status depends on founder action.

**Effort:** Substrate work 0.5 days. Founder review separate.

### 4.2 Sean Lippay Actual Outreach Send

**Status:** Validation harness scaffolded per `src/spine/validation/sean_lippay_outreach.ts`. Three-way gate works. Time machine commits available for restoration if anything goes wrong. The actual email send to a real customer is the founder-gated final step.

**Work for substrate:**
- Verify the outreach harness produces output that passes three-way gate (Forge policy permits, evidence chain integrity verified, harsh score 9.0+)
- Verify Article XIV entity verification (when ratified) catches any incorrect facts about Strategic Food Solutions, Sean's role, or Real Empanada capacity claims
- Verify the human-veto mechanism works (when DanteAgents v1 ships) for routing through approve/revise/cancel before send
- Ensure the email send mechanism is in place (which provider, allowlist verified)

**Work for founder:**
- Review final outreach email draft
- Founder rating 8.5+ required
- Approve send via human-veto when DanteAgents v1 ships, or manual approval if v1 not yet shipped
- Verify Sean's reply handling (if any) properly captured in truth loop closure

**Acceptance:** Sean Lippay outreach completed, reply captured, truth loop closed with founder-confirmed verdict.

**Effort:** Substrate work 0.5 days. Founder review and send separate.

### 4.3 PRD-24 and PRD-25 Authoring

**Status:** Closure stamp references these as not yet existing. Their content is unclear without inspecting the broader DirtyDLite 25-PRD master plan or context that defines what 24 and 25 should cover.

**Work for substrate-Claude:**
- Inspect the existing PRD numbering and identify what PRD-24 and PRD-25 should cover based on the master plan structure
- If PRD-24 and PRD-25 represent specific functional gaps, draft their content per the OpenSpec per-change folder format
- If they're placeholder PRDs that no longer reflect needed work, formally retire them with explanation

**Acceptance:** PRD-24 and PRD-25 either authored as proper PRDs or formally retired with rationale. The closure stamp's reference to them is resolved.

**Effort:** 1 day depending on what they actually need to cover.

### 4.4 Truth Loop Founder-Confirmed Closure

**Status:** Truth loop substrate works. Verdicts emit. Founder rating capture exists in schema. The systematic confirmation that a critical-mass set of truth loop runs has gone through full end-to-end with founder ratings 8.5+ is the validation that the substrate operates as designed in real use.

**Work for substrate:**
- Identify the set of truth loop runs that should be founder-validated (probably 5-10 representative runs covering different task classes)
- Verify each run produced founder-facing output and capture founder rating
- Update truth loop runner to ensure rating capture is mandatory before run-complete state

**Work for founder:**
- Review the 5-10 representative truth loop runs
- Provide ratings 8.5+ on each (or note where lower and why)
- Confirm the substrate is operating as designed in real use, not just in test scenarios

**Acceptance:** 5-10 founder-rated truth loop runs at 8.5+ average. Substrate operationally validated, not just architecturally validated.

**Effort:** Substrate work 0.5 days. Founder review separate but high-leverage.

---

## 5. Section C: Sister-Repo Integration Surfaces

The specific contracts that PRD-CODE-V2 and PRD-AGENTS-V1 build against. These need to ship as part of v1.1 because the sister repos depend on them.

### 5.1 Pass 18: Package Extractions

Substrate-Claude's recommendation in the document you shared identified this as the immediate critical-path work.

**Extract `@danteforge/truth-loop`:**
- Move `src/spine/truth_loop/runner.ts`, `proof.ts`, `ids.ts`, `types.ts` into `packages/truth-loop/src/`
- Add package.json with proper version (start at 1.0.0)
- Add LICENSE (MIT matching evidence-chain)
- Add README.md documenting the public API (createTruthLoopRun, etc.)
- Add CHANGELOG.md
- Build via tsup matching evidence-chain pattern
- Publish to npm

Implementation note 2026-04-29: the public package surface now owns `types`, `ids`, and proof helpers. The runtime runner remains under `src/spine/truth_loop/runner.ts` because it depends on DanteForge-local collectors, writers, schema validation, and Time Machine. That keeps the sister-repo contract portable instead of dragging the full CLI runtime into consumers.

**Extract `@danteforge/three-way-gate`:**
- Move `src/spine/three_way_gate.ts` into `packages/three-way-gate/src/`
- Same structure as truth-loop package
- Document the gate evaluation contract (Forge policy + evidence chain integrity + harsh score, all three GREEN)
- Build and publish

**Add `aggregateChildReceipts` to evidence-chain v1.1:**
- Specify the function signature: `aggregateChildReceipts(runId: string, children: Receipt[]): EvidenceBundle`
- Implement: takes N child receipts and produces parent bundle with all child references, parent hash chains all children, supports later byte-identical reconstruction
- Add tests: parent verifies via verifyBundle, children individually verifiable, time-machine restoration works on aggregated bundle
- Bump evidence-chain to v1.1.0 and republish

Implementation note 2026-04-29: local v1.1.0 package and tests are complete. Republish is intentionally not executed in this sprint.

**Acceptance:**
- All three packages published to npm at correct versions
- Sister repos can install via `npm install @danteforge/evidence-chain@1.1` etc. and consume the public APIs
- Existing DanteForge code still works (extracted packages imported back, not parallel)
- Tests pass on extracted packages

**Effort:** 1.5-2 days. Substrate-Claude already named this as the unblock.

### 5.2 MCP Tool Surface Documentation

The 7 quality-gate MCP tools that DanteCode plugin manifest references need formal documentation so DanteAgents adapter builders know exactly what contracts to implement.

**For each of the 7 tools:**
- Tool name (canonical)
- Parameters schema with types
- Return value schema with types
- Error modes (rate limit, invalid input, gate failure, etc.)
- Usage example with valid input and expected output
- Constitutional integration: what evidence the tool emits, which gates it triggers

**Document location:** `docs/MCP_TOOL_SURFACE.md` or update existing MCP server documentation.

Implementation note 2026-04-29: `docs/MCP_TOOL_SURFACE.md` exists and documents the seven quality-gate tools.

**Acceptance:** External developer (or external agent) can implement MCP client against DanteForge using only the documentation, without source code access.

**Effort:** 0.5 days.

### 5.3 Sister-Repo Consumption Patterns

Document how DanteCode v2 and DanteAgents v1 are expected to consume DanteForge surfaces. This is integration documentation, not new code.

**Document location:** `docs/SISTER_REPO_INTEGRATION.md`.

Implementation note 2026-04-29: `docs/SISTER_REPO_INTEGRATION.md` exists and documents DanteCode/DanteAgents consumption patterns plus founder-gated statuses.

**Content:**
- DanteCode v2: imports `@danteforge/evidence-chain` for proof-anchored commits. Uses `@danteforge/three-way-gate` for score-claim updates. Dispatches via DanteForge MCP server for verification work. Section showing example imports and usage.
- DanteAgents v1: imports `@danteforge/evidence-chain` for receipt aggregation via `aggregateChildReceipts`. Uses `@danteforge/truth-loop` for orchestration runs. Dispatches via DanteForge MCP server for verification, scoring, time machine queries. Section showing example imports and usage.
- Constitutional integration patterns: which Articles each sister repo must respect, how three-way gate flows across repo boundaries, how time machine reversibility works when state crosses sister repo boundaries.

**Acceptance:** Sister repo implementation agents can read this document and understand exactly how to consume DanteForge without ambiguity.

**Effort:** 0.5 days.

---

## 6. Verification That Five-of-Five Skills Shipped

The closure stamp documents four Dante-native skill executors visible in the commit. The fifth skill from PRD-MASTER Addendum-001 was `dante-grill-me` (interview-driven plan refinement).

**Work:**
- Inspect `src/spine/skill_runner/executors/` for `dante-grill-me-executor.ts`
- If exists, verify acceptance criteria from Addendum-001 are met
- If not exists, build it per Addendum-001 specification (interview-driven plan refinement with Socratic question depth escalation, assumption surfacing, time-boxing, optional --roles=balanced flag using claude-council role taxonomy)

**Acceptance:** Five Dante-native skill executors all shipped and tested.

**Effort:** 0.5 days if needs creation, 0.1 days if already shipped.

---

## 7. Build Calendar (Indicative)

| Day | Focus |
|-----|-------|
| 1 | Pass 18 part 1: Extract @danteforge/truth-loop and @danteforge/three-way-gate packages |
| 2 | Pass 18 part 2: aggregateChildReceipts in evidence-chain v1.1, publish all three packages |
| 3 | Dimension closure: developerExperience to 9+, specDrivenPipeline to 9+ |
| 4 | Dimension closure: ecosystemMcp to 9+ (largest piece) |
| 5 | Dimension closure: ecosystemMcp continued, MCP tool surface documentation |
| 6 | Founder-gated work: Article XIV draft, PRD-24/PRD-25 disposition, dante-grill-me verification |
| 7 | Sister repo integration documentation, final verification, harsh score evaluation |

Total: 5-7 days. Substrate-Claude can execute most of this in parallel with Codex picking up specific package extraction work.

---

## 8. Success Definition

DanteForge v1.1 is complete when all of the following are GREEN:

**Quantitative:**
1. Harsh score 9.5+ overall, 18/19 dimensions at 9.0+ (communityAdoption stays low pending distribution)
2. All three packages (`@danteforge/evidence-chain` v1.1, `@danteforge/truth-loop` v1.0, `@danteforge/three-way-gate` v1.0) published to npm
3. MCP tool surface fully documented and externally consumable
4. Sister repo integration documentation complete

**Qualitative:**
1. Founder uses DanteForge as the verification kernel for Real Empanada operations daily without friction
2. CLI feels easy to use on fresh install
3. Spec-driven pipeline traces from spec to implementation cleanly

**Constitutional:**
1. Article XIV either ratified or formally deferred with rationale
2. Sean Lippay outreach completed with founder rating 8.5+
3. 5-10 truth loop runs founder-validated at 8.5+ average
4. PRD-24 and PRD-25 either authored or formally retired

**Strategic:**
1. PRD-CODE-V2 (multi-instance Council) can build against DanteForge v1.1 surfaces without blockers
2. PRD-AGENTS-V1 (WhatsApp orchestrator) can build against DanteForge v1.1 surfaces without blockers
3. The three-PRD package (Forge v1.1 + Code v2 + Agents v1) is internally consistent and executable in parallel

---

## 9. Out of Scope for v1.1

Explicit non-goals to keep scope tight:

- Public release announcement (v1.1 closes internal v1; public release decision deferred)
- Multi-instance Council coordination substrate (DanteCode owns this per PRD-CODE-V2)
- WhatsApp orchestrator product layer (DanteAgents owns this per PRD-AGENTS-V1)
- Distribution work for communityAdoption (post-trio-ships work)
- DELEGATE-52 live mode replication (deferred per Time Machine validation report; harness mode evidence sufficient for v1.1)
- New constitutional articles beyond XIII and XIV
- DanteCreative seventh organ scoping (post-trio-ships)
- Bookkeeping fine-tune integration (Dojo work; DanteForge provides the substrate but doesn't drive Dojo)

---

## 10. Open Questions for Implementation Agents

Resolve by inspecting current repo state at build time:

1. Has dante-grill-me skill executor shipped? Inspect `src/spine/skill_runner/executors/`.
2. What are the 7 quality-gate MCP tools currently exposed? Verify current state in `src/core/mcp-server.ts`.
3. Has Article XIII Context Economy been formally ratified in CONSTITUTION.md? If not, Article XIV ratification waits behind it.
4. What's the current state of `docs/PRDs/`? Is the OpenSpec per-change folder pattern adopted everywhere or only in the two examples (truth-loop-list, truth-loop-diff)?
5. What's the npm publication status of @danteforge/evidence-chain? Is v1.0.0 actually on the npm registry or only in the local repo?
6. Have any commits since f19e1d7 changed any of the above? Run `git log --since="2026-04-29"` and check.

---

## 11. Constitutional Discipline

This PRD operates under the Dante Constitution. All Articles I-XIII apply. Article XIV applies once ratified.

**Article IX KiloCode Discipline:** Files under 500 LOC. Package extractions must respect this; if a file would exceed 500 LOC during extraction, split it.

**Article X OSS Pattern Learning:** OpenSpec per-change folder pattern attributed where used. claude-council debate mode pattern attributed where used. Brand Asset Protocol from Huashu Design attributed when Article XIV ratified.

**Article XI Production-Ready Criteria:** All 10 criteria met. Verify against existing checklist.

**Article XII Anti-Stub Enforcement:** No stub implementations. Package extractions must include real tests, not skeleton tests.

**Article XIII Context Economy:** Token telemetry continues to emit. Sacred content preserved.

**Three-Way Promotion Gate:** Forge policy + evidence chain integrity + harsh score, all three GREEN, required for any artifact promotion in v1.1 closure work.

**Fail-Closed Semantics:** Founder-gated items remain ungranted until founder explicitly approves.

---

## 12. Final Handoff Notes

This PRD is the canonical specification for DanteForge v1.1 closure. Hand it to substrate-Claude (primary) and Codex (for substantial multi-file passes like package extraction).

Framing for handoff:

> This is PRD-FORGE-V1.1 for DanteForge closure to v1.0 plus integration surfaces for sister repos. Read fully before beginning. Most major substrate is shipped per commit f19e1d7. Most work in this PRD is closure: dimension polish (4 dimensions), Pass 18 package extractions (3 packages), sister-repo integration documentation, founder-gated items requiring founder action. Inspect current state to skip what's done. The goal is sealing v1 cleanly so DanteCode v2 and DanteAgents v1 can build against stable contracts.

Implementation agents have full autonomy to:
- Re-sequence work within the build calendar
- Skip sections describing already-shipped work
- Recommend scope adjustments based on discovery findings

Implementation agents must NOT:
- Claim founder-gated items complete without founder action
- Bypass three-way gate
- Violate KiloCode discipline
- Claim communityAdoption closed (it requires distribution, not substrate work)

---

## 13. Document Version History

- **v1.0 (2026-04-29):** Initial closure specification. Synthesizes commit f19e1d7 ground truth and conversation-developed integration requirements into executable closure PRD.

---

**END OF PRD-FORGE-V1.1**

*Closure begins when substrate-Claude is given this PRD plus access to current repo state. Pass 18 package extractions are the immediate critical path. Dimension closure follows. Founder-gated items proceed in parallel with founder review. End state: DanteForge v1 sealed, three sister-repo packages published to npm, MCP tool surface documented, ready for DanteCode v2 and DanteAgents v1 to build against stable contracts.*
