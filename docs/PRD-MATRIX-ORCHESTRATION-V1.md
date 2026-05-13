# PRD-MATRIX-ORCHESTRATION-V1: PRD-to-Frontier Orchestration

**One Command. One PRD. Full Competitive Frontier Closure Through Multi-Agent Coordination.**

**Version:** 1.0
**Created:** 2026-05-12
**Status:** Approved for Execution Post-Phase-13
**Target Repos:** DanteForge (primary), DanteHarvest (consumer), DanteAgents (consumer), DanteDojo (consumer for fine-tuned harvest models)
**Implementation Agents:** substrate-Claude (primary architectural), Codex (orchestration implementation), DanteCode (dogfood target), web-Claude (UX refinement)
**Discovery Discipline:** Verify Phase 13 of Matrix Kernel PRD has shipped real adapter implementations before beginning. This PRD orchestrates Matrix Kernel as engine; without real adapters operational, this PRD has no foundation.
**Build Window:** Phase 1 (PRD ingestion plus competitive harvest) 5-7 days. Phase 2 (dimension synthesis plus capacity detection) 5-7 days. Phase 3 (two-phase frontier execution) 7-10 days. Phase 4 (retrospective-informed phase transitions) 3-5 days. Total roughly 3-4 weeks at demonstrated rate.
**Current Baseline:** Matrix Kernel MVP shipped (PR #2). Phase 13 adapter work in flight. PRD-OSS-LICENSE-DISCIPLINE-V1 specifies license discipline. OSS harvest commands operational with license gates.

---

## 1. Executive Summary

Matrix Kernel solved the hard architectural problem of coordinating multiple AI agents safely. PRD-MATRIX-ORCHESTRATION-V1 builds the user-facing orchestration layer that uses Matrix Kernel as engine to turn one PRD plus one command into full competitive-frontier closure for any project.

The end-state user experience: developer writes a PRD for what they want to build. Developer runs `danteforge matrix /path/to/prd.md`. DanteForge reads the PRD, discovers the competitive universe, analyzes OSS and closed-source competitors including user-facing pain signals from Reddit and X, synthesizes 50 dimensions that define excellence in the project's category, detects available agent capacity on the user's machine, allocates work across providers, executes parallel agent coordination through Matrix Kernel until OSS frontier is reached, generates retrospective, plans closed-source frontier closure based on what was learned, executes second phase, and produces final report showing the project moved from current state to frontier across all dimensions.

This is what you described in the broader vision. The Matrix Kernel handles coordination; this PRD handles orchestration of the full PRD-to-frontier workflow.

Three architectural decisions worth naming up front.

**The two-phase frontier approach is structurally meaningful.** Phase one closes to OSS frontier using direct harvest patterns where licensing permits and clean-room reimplementation where it doesn't. Phase two closes to closed-source frontier through inference and architectural insight because closed source can only be observed, not inspected. Different phases require different agent skills and different verification approaches.

**Capacity detection is critical.** The substrate must detect what's installed, authenticated, and concurrent on the user's specific machine. Requesting 50 agents on a machine that runs 12 produces failure cascades. The Matrix Kernel Safe Parallelism Calculator extends here with provider availability as additional constraint.

**Social signal informs dimensions, not just READMEs.** Reading Reddit and X discussions about competitor projects captures operational truth that documentation hides. "Cursor is great until token limits" is the kind of user reality that informs which dimensions actually matter versus which are marketing positioning. Dimension synthesis must consume this signal.

This PRD is post-Phase-13. The orchestration layer requires real agent adapters operational. Without that, this PRD is on hold.

---

## 2. Existing Substrate (Read Before Building)

Implementation agents must verify the following exists before extension.

**Matrix Kernel MVP shipped.** PR #2 landed. All 12 phases plus Golden Flow plus planning-half CLI shipped. 130+ tests passing. Architecture proven with fake agents end-to-end.

**Phase 13 real adapters shipped.** CodexAdapter, ClaudeCodeAdapter, DanteCodeAdapter operational. Real LLM dispatch through lease/worktree/verification/merge architecture works. Execution-loop CLI (run-wave, verify, red-team, taste-gate, merge-court) operational.

**OSS harvest substrate.** Per PRD-OSS-LICENSE-DISCIPLINE-V1. License classification taxonomy operational. Green-light direct-copy versus red-light pattern-only enforcement working. Clean-room workflow documented and enforced. THIRD_PARTY_NOTICES.md auto-generation operational.

**Existing DanteForge competitive infrastructure.** `compete-matrix.ts` exists with dimensions and competitor records. `compete --calibrate` adversarial calibration shipped per Inferno pass. The infrastructure for competitive analysis exists; this PRD orchestrates rather than rebuilds.

**Existing harvest commands.** `danteforge oss`, `danteforge harvest`, `danteforge local-harvest`, `danteforge awesome-scan` operational. License gates enforced. This PRD orchestrates these commands rather than rebuilds.

Implementation agents must verify each before extending. If Phase 13 hasn't shipped, this PRD is on hold. The orchestration layer requires the coordination layer operational underneath.

---

## 3. The Experience This PRD Ships

The end-state user experience this PRD delivers:

**Developer writes a PRD.** Standard markdown document describing what they want to build. Project type, goals, target users, key features, constraints, non-goals. Same kind of PRD they'd write for any major project. Could be the DanteCode PRD, the DanteAgents PRD, any new project specification.

**Developer runs one command.**

```bash
danteforge matrix /path/to/dantecode-prd.md
```

**DanteForge orchestrates the full pipeline.**

```
DanteForge Matrix Orchestration
-------------------------------------------------
Reading PRD: dantecode-prd.md
Project: DanteCode
Type: AI coding assistant (CLI + IDE integration)
Goal: Verification-first AI coding tool for non-technical users
Target frontier: closed-source-leader-equivalent capability

Phase 0: Competitive Universe Discovery
  Discovered 47 candidate competitors
  OSS confirmed: 23 (Aider, OpenHands, Cline, Continue, Goose, ...)
  Closed-source confirmed: 14 (Cursor, GitHub Copilot, Codeium, ...)
  Adjacent/research: 10 (HALO, Meta-Harness, ...)
  
  Approve discovery? [y/n/edit] y

Phase 1: Competitive Analysis
  OSS harvest: 23 projects cloned, READMEs parsed, architecture extracted
  Closed-source profile: 14 projects analyzed through docs, demos, public posts
  Social signal: Reddit (147 threads) + X (89 posts) analyzed for real user pain
  License discipline: 18 green-light direct-copy, 4 yellow-light pattern, 1 red-light, 0 incompatible
  
  Synthesized 50 dimensions across 8 categories:
    - Repo comprehension (4 dimensions)
    - Multi-file editing (5 dimensions)
    - Agent planning (6 dimensions)
    - Verification gates (5 dimensions)
    - CLI ergonomics (4 dimensions)
    - IDE integration (5 dimensions)
    - Provider routing (4 dimensions)
    - ... (17 more dimensions)
  
  Approve dimensions? [y/n/edit] y

Phase 2: Current State Scoring
  DanteCode current state scored across 50 dimensions:
    Overall: 6.4/10
    Above frontier (9+): 3 dimensions (verification rigor, evidence chain, constitutional substrate)
    At parity (7-8): 12 dimensions
    Below parity (5-7): 23 dimensions
    Substantial gap (<5): 12 dimensions
  
  OSS frontier score: 8.2/10 (achievable through harvest)
  Closed-source frontier score: 9.1/10 (requires inference and architectural insight)
  
  Approve frontier targets? [y/n/edit] y

Phase 3: Agent Capacity Detection
  Detecting installed and authenticated providers...
    Claude Code: ✓ authenticated, 10 concurrent instances tested
    Codex CLI: ✓ authenticated, 3 concurrent instances tested
    DanteCode: ✓ available, 5 concurrent instances tested
    Aider: ✓ installed, 4 concurrent instances tested
    Cursor: ✗ not in CLI mode
    Ollama: ✓ qwen2.5-coder:32b loaded, 1 instance available
  
  Total practical concurrency: 23 agents
  
  Approve agent allocation? [y/n/edit] y

Phase 4: OSS Frontier Execution (Phase A)
  Plan: 47 dimensions need work to reach OSS frontier (3 already above)
  Estimated waves: 6
  Estimated time: 8-12 hours
  Estimated cost: $45-75 in API spend
  
  Proceed? [y/n] y
  
  [Wave 1/6 — 23 agents working on contracts and foundations]
  ...
```

The execution runs to completion. The substrate handles verification, conflict resolution, merge arbitration. Retrospective generates between phases. Closed-source frontier execution begins after OSS frontier closure validates. Final report shows the project moved from 6.4 to 9.1 across 50 dimensions with full evidence chain.

That's the experience. The four phases below ship the components that make it possible.

---

## 4. Phase 1: PRD Ingestion and Competitive Universe Discovery (Week 1)

What happens between "user provides PRD" and "competitive universe is mapped." The phase that converts unstructured project intent into structured competitive context.

### 4.1 PRD Ingestion and Structured Intent Extraction

Build the PRD reader that produces structured project intent.

**Reader behaviors:**
- Parse PRD markdown into structured sections (goal, type, features, constraints, non-goals)
- Extract project type classification (CLI tool, IDE extension, agent runtime, SaaS, internal tool, etc.)
- Extract target user (developer, non-technical, both, specific role)
- Extract competitive category boundaries (only direct competitors, adjacent categories, research-adjacent)
- Extract constraint emphasis (security-critical, performance-critical, UX-critical, integration-critical)
- Extract explicit non-goals (what the project will NOT compete on)
- Extract "what does full potential mean for this project" framing (match leader on X, exceed leader on Y, define new category Z)

**Implementation:**
- New module `src/matrix-orchestration/prd-reader.ts`
- LLM-assisted extraction with structured output schema
- User confirmation step before downstream stages consume extracted intent
- Extracted intent stored in `.danteforge/matrix-orchestration/project-intent.json`

**Acceptance:**
- PRD reader handles diverse PRD formats (markdown with various heading structures)
- Extraction produces consistent structured output across project types
- User confirmation flow allows correction before downstream consumption
- Failed extraction returns clear error rather than silent assumption

**LOC budget:** ~400 LOC across reader, extractor, schema validation.

### 4.2 Competitive Universe Discovery

Build the discovery engine that finds the competitive landscape.

**Discovery sources:**
- GitHub search for projects matching project type plus key features
- Awesome lists for the project's category
- Reddit threads referencing competitor projects in relevant subreddits
- X posts mentioning competitor names and use cases
- HackerNews discussions referencing the category
- Existing OSS matrix entries from prior Dante work

**Discovery output:**
- Categorized competitor list (OSS confirmed, closed-source confirmed, adjacent, research, unknown)
- Source/provenance for each discovery
- Confidence score for each entry
- Initial license classification (where determinable from repo metadata)
- Recommended action per entry (harvest, profile, observe, skip)

**Implementation:**
- New module `src/matrix-orchestration/discovery.ts`
- Integration with existing `danteforge harvest`, `danteforge awesome-scan`, `danteforge oss` commands
- Social signal capture through web-fetch on Reddit/X threads (or RSS where available)
- User approval step before any cloning or deep analysis

**Acceptance:**
- Discovery produces non-trivial competitive universe (>10 entries for any meaningful project)
- Each entry has provenance and confidence
- License classification flags AGPL/SSPL/PolyForm correctly
- User can approve, reject, or add competitors before next phase
- Discovery output stored in `.danteforge/matrix-orchestration/competitive-universe.json`

**LOC budget:** ~600 LOC across discovery sources, integration with existing commands, social signal capture.

### 4.3 Phase 1 Acceptance Criteria

1. PRD reader produces structured project intent on test PRDs
2. Discovery engine finds competitive universe on test PRDs
3. User confirmation flow works for both PRD extraction and discovery
4. License classification applies correctly per PRD-OSS-LICENSE-DISCIPLINE-V1
5. End-to-end test: provide DanteCode PRD, get structured intent plus competitive universe within 30 minutes
6. Social signal capture works for Reddit and X
7. Failed extraction produces actionable errors

---

## 5. Phase 2: Competitive Analysis and Dimension Synthesis (Week 2)

What happens between "competitive universe is mapped" and "50 dimensions are synthesized with current state scored." The phase that converts competitive context into actionable dimensional analysis.

### 5.1 OSS Competitor Harvest

For each OSS-confirmed competitor with permissive license, harvest patterns through existing `danteforge harvest` command.

**Harvest behaviors:**
- Clone repo into read-only harvest area (existing harvest command)
- Extract architecture summary (existing harvest command)
- Extract feature inventory (existing harvest command)
- Extract UX/CLI/API patterns
- Extract testing strategy
- Extract dependency patterns
- Record license and provenance per PRD-OSS-LICENSE-DISCIPLINE-V1

**Implementation:**
- Orchestrate existing `danteforge harvest <repo-url>` calls in parallel
- Aggregate harvest output into competitive analysis substrate
- License classification informs whether pattern is harvestable or pattern-only

**Acceptance:**
- Harvest runs in parallel across 20+ competitors without conflicts
- License classification correctly routes harvest mode per source
- Aggregated output usable by downstream dimension synthesizer
- THIRD_PARTY_NOTICES.md auto-updates with new harvest decisions

**LOC budget:** ~300 LOC orchestration on top of existing harvest infrastructure.

### 5.2 Closed-Source Observational Profiling

For closed-source competitors, build observational profile through public sources.

**Profiling sources:**
- Official documentation
- Public demos and tutorials
- Marketing positioning (what they claim to do)
- User reviews on G2, ProductHunt, App stores where applicable
- Reddit and X discussions about real user experience
- Public APIs where documented

**Profiling output:**
- Feature inventory based on documented capabilities
- Architectural inference based on observed behavior
- Strengths reported by users
- Weaknesses reported by users
- Pricing and positioning context
- Provenance for every claim (with confidence scoring)

**Implementation:**
- New module `src/matrix-orchestration/closed-source-profiler.ts`
- LLM-assisted inference from documentation and user discussions
- Explicit confidence scoring per observation
- Constitution rule: closed-source claims marked "inferred" never "verified"

**Acceptance:**
- Profiler produces structured profile for diverse closed-source competitors
- Constitution rule enforced (no source-inspection claims for closed source)
- User reviews from social signal aggregate correctly
- Confidence scores reflect inference quality

**LOC budget:** ~400 LOC profiler plus social signal integration.

### 5.3 Social Signal Analysis

Aggregate Reddit and X discussions about competitors to capture real user pain.

**Signal sources:**
- Reddit threads in relevant subreddits (r/programming, r/MachineLearning, r/ChatGPTCoding, project-specific subreddits)
- X posts mentioning competitor names with use case context
- HackerNews threads about competitor releases
- GitHub Issues marked as "thumbs up" or with many reactions (indicates real user pain)

**Signal extraction:**
- Sentiment classification per mention
- Specific complaint extraction ("token limits", "slow on large refactors", "poor multi-file context", etc.)
- Specific praise extraction ("best for X", "saved me hours on Y", etc.)
- Aggregate trends across mentions (what users consistently complain about, what they consistently praise)

**Implementation:**
- New module `src/matrix-orchestration/social-signal.ts`
- Integration with web-fetch for Reddit and X content where accessible
- LLM-assisted sentiment and complaint extraction
- Aggregation across mentions produces actionable signal

**Acceptance:**
- Signal extraction produces meaningful pain/praise inventory per competitor
- Aggregation reveals consistent patterns across user feedback
- Output informs dimension synthesis with operational truth not marketing claims
- Confidence scores reflect signal volume and consistency

**LOC budget:** ~500 LOC across capture, extraction, aggregation.

### 5.4 Dimension Synthesis

Synthesize 50 dimensions that define excellence for the project category.

**Synthesis behaviors:**
- Combine OSS harvest patterns plus closed-source profiles plus social signal plus PRD intent
- Identify dimensions that consistently appear across leading competitors (must-haves)
- Identify dimensions that differentiate leaders from followers (excellence markers)
- Identify dimensions that match user pain points (operational requirements)
- Identify dimensions specific to the PRD's stated goals (project-unique)
- Produce 50 dimensions with 0-10 rubrics including explicit definitions of 5, 7, 9
- Include evidence requirements per dimension (what proves a 9 score)

**Implementation:**
- New module `src/matrix-orchestration/dimension-synthesis.ts`
- LLM-assisted synthesis with structured output validation
- User review/edit step before dimensions are frozen
- Integration with existing `compete-matrix.ts` to update DanteForge's own competitive matrix

**Acceptance:**
- Synthesis produces 50 dimensions on test project types
- Dimensions span multiple categories without redundancy
- Each dimension has clear rubric and evidence requirements
- User can review, edit, or reject dimensions before freezing
- Dimensions integrate with existing harsh scorer infrastructure

**LOC budget:** ~600 LOC synthesis plus user review flow.

### 5.5 Current State Scoring

Score the user's project across the 50 synthesized dimensions.

**Scoring behaviors:**
- For each dimension, evaluate current project against the rubric
- Generate evidence per score (specific files, features, capabilities that support the score)
- Calculate gaps to OSS frontier and to closed-source frontier
- Produce dimension-level recommendation (what would close the gap)

**Implementation:**
- Wrap existing `compete-matrix.ts` scoring with the synthesized dimensions
- Apply harsh scorer adversarial calibration (existing Inferno pass capability)
- Produce dimensional matrix with current/OSS-frontier/closed-source-frontier columns

**Acceptance:**
- Scoring produces honest current state across all 50 dimensions
- Evidence supports each score
- Gap calculations are accurate
- Adversarial calibration applied (no inflated self-scoring)

**LOC budget:** ~300 LOC on top of existing scoring infrastructure.

### 5.6 Phase 2 Acceptance Criteria

1. OSS harvest runs in parallel for 20+ competitors per project
2. Closed-source profiler produces inferred profiles with explicit confidence
3. Social signal analysis produces aggregated user pain inventory
4. Dimension synthesis produces 50 dimensions matching project category
5. Current state scoring produces honest baseline with evidence
6. End-to-end test: DanteCode PRD plus competitive universe produces complete dimensional matrix
7. User review steps work at each transition

---

## 6. Phase 3: Two-Phase Frontier Execution (Weeks 2-3)

What happens between "dimensions are synthesized" and "project reaches frontier." The phase that orchestrates Matrix Kernel execution across two frontier-closure phases.

### 6.1 Agent Capacity Detection

Detect available agent capacity on the user's machine before allocating work.

**Detection behaviors:**
- Check for installed providers (Claude Code CLI, Codex CLI, DanteCode, Aider, Ollama, Cursor in CLI mode if available)
- Check authentication state for each provider
- Run brief concurrency benchmark (spin up 2 instances, measure responsiveness, scale up until degradation)
- Detect resource constraints (RAM, CPU, GPU, network bandwidth)
- Produce capacity report showing practical concurrency per provider

**Implementation:**
- New module `src/matrix-orchestration/capacity-detector.ts`
- Integration with existing provider configuration (Claude Code config, Codex config, etc.)
- Brief benchmark with timeout to avoid hanging on unresponsive providers
- User confirmation of detected capacity before allocation

**Acceptance:**
- Detection produces honest capacity report on test machines
- Authentication failures surface clearly
- Concurrency benchmark completes within 2 minutes total
- User can override detected capacity (e.g., "I only want 5 Claude Code instances even though I can run 10")

**LOC budget:** ~400 LOC across provider detection, benchmark, configuration.

### 6.2 Phase A: OSS Frontier Execution

Execute Matrix Kernel coordination to close all dimensions to OSS frontier.

**Execution behaviors:**
- Generate work packets from dimensions with OSS-frontier-gap > 0
- Allocate packets across detected agent capacity
- Phase A agents use OSS harvest patterns directly (where license permits) or clean-room implementations (where pattern-only)
- Run Matrix Kernel coordination loop until all OSS-targeted dimensions reach OSS frontier or budget exhausted
- Generate intermediate retrospective on what worked, what didn't

**Implementation:**
- Orchestration on top of existing Matrix Kernel infrastructure
- Phase A specific: agents receive OSS harvest patterns as primary reference
- Agents have explicit instruction to harvest patterns where licensing permits, clean-room where pattern-only
- Verification specifically checks for license compliance per PRD-OSS-LICENSE-DISCIPLINE-V1

**Acceptance:**
- Phase A executes work packets in parallel through Matrix Kernel
- License compliance enforced (no AGPL contamination, etc.)
- Phase A completes when target dimensions reach OSS frontier or stop conditions met
- Intermediate retrospective generated for Phase B planning input

**LOC budget:** ~500 LOC orchestration on top of Matrix Kernel.

### 6.3 Inter-Phase Retrospective and Planning

Between Phase A and Phase B, generate retrospective and plan Phase B based on what was learned.

**Retrospective inputs:**
- Phase A outcomes (what merged, what was rejected, what improved scores)
- Agent performance per provider (which providers excelled at which dimension types)
- Conflict patterns (which dimensions kept colliding)
- Time and cost per dimension closed
- Remaining gap to closed-source frontier

**Phase B planning:**
- Closed-source frontier closure requires more inferential work (pattern only observed, not inspected)
- Agent allocation should favor providers that performed best on inferential work in Phase A
- Work packets emphasize architectural synthesis over pattern reproduction
- Verification emphasizes red-team for fake-completion claims (closed-source-frontier work is easier to fake than OSS-frontier work)
- User confirmation before Phase B begins

**Implementation:**
- New module `src/matrix-orchestration/inter-phase.ts`
- Wrap existing Matrix Kernel retrospective with phase-specific analysis
- Phase B planning informed by Phase A learning
- Explicit user confirmation step

**Acceptance:**
- Retrospective produces actionable insight from Phase A
- Phase B plan adapts based on Phase A learning
- User can review, adjust, or pause before Phase B begins
- Retrospective stored in `.danteforge/matrix-orchestration/phase-a-retrospective.json`

**LOC budget:** ~300 LOC retrospective extension plus Phase B planning logic.

### 6.4 Phase B: Closed-Source Frontier Execution

Execute Matrix Kernel coordination to close remaining gap to closed-source frontier.

**Execution behaviors:**
- Generate work packets from dimensions with closed-source-frontier-gap remaining after Phase A
- Allocate packets across agent capacity, favoring high-performance providers from Phase A
- Phase B agents work from closed-source observational profiles and social signal pain points
- Run Matrix Kernel coordination loop until target dimensions reach closed-source frontier or budget exhausted
- Red Team Verifier active on all merges (closed-source-frontier work is easier to fake)
- Taste Gate emphasized (UX and architectural elegance matter more than feature parity)

**Implementation:**
- Same Matrix Kernel infrastructure as Phase A
- Phase B specific: agents receive observational profiles as reference rather than concrete OSS patterns
- Red Team Verifier configured for adversarial review on all merges
- Taste Gate triggers more broadly

**Acceptance:**
- Phase B executes work packets through Matrix Kernel
- Red Team catches fake completion attempts on inferential work
- Phase B completes when target dimensions reach closed-source frontier or stop conditions met
- Final retrospective generated for full pipeline

**LOC budget:** ~400 LOC Phase B specific orchestration.

### 6.5 Phase 3 Acceptance Criteria

1. Capacity detection produces honest capacity report
2. Phase A executes parallel agent coordination to OSS frontier
3. Inter-phase retrospective informs Phase B planning
4. Phase B executes parallel agent coordination to closed-source frontier
5. License compliance maintained throughout both phases
6. Red Team Verifier and Taste Gate operational on real merges
7. End-to-end test: DanteCode dimensional matrix produces working code through both phases

---

## 7. Phase 4: Final Report and Continuous Improvement (Week 3-4)

What happens between "Phase B completes" and "user has actionable final state." The phase that ties everything together into a coherent final artifact and primes the next iteration.

### 7.1 Final Report Generation

Generate the canonical final report showing project trajectory from current state to frontier.

**Report contents:**
- Starting score per dimension
- Ending score per dimension
- OSS frontier achievement
- Closed-source frontier achievement
- Total agents deployed
- Total cost (API spend, time)
- Conflicts encountered and resolved
- Rejected branches with reasons
- Approved branches with evidence
- Patterns harvested with attribution
- License compliance audit
- Recommended next iterations

**Implementation:**
- Wrap existing Matrix Kernel report generator with orchestration-level summary
- Markdown rendering for human consumption
- JSON output for programmatic consumption
- Final report at canonical path

**Acceptance:**
- Final report renders cleanly across diverse projects
- All claims supported by evidence
- License compliance audit complete and accurate
- User can extract recommended next iterations easily

**LOC budget:** ~400 LOC report generation extension.

### 7.2 Continuous Improvement Hooks

Build hooks for the substrate to learn from this orchestration run.

**Learning capture:**
- Provider performance patterns (which providers excel at which work types)
- Conflict patterns (which dimensions tend to collide across projects)
- Successful harvest patterns (which OSS sources produced highest-value patterns)
- Failed harvest patterns (which OSS sources produced low-value patterns)
- Time-cost estimates (how long different dimension types actually take to close)

**Application:**
- Provider performance memory feeds future agent allocation
- Conflict patterns inform future dependency graph construction
- Harvest patterns inform future competitive universe weighting
- Time-cost estimates inform future budget projections

**Implementation:**
- New module `src/matrix-orchestration/learning-loop.ts`
- Persistent storage at `.danteforge/matrix-orchestration/learning-state.json`
- Integration points with Matrix Kernel agent allocation and conflict detection

**Acceptance:**
- Learning capture stores actionable patterns after each orchestration run
- Future runs read learning state and adjust behavior
- Learning state can be inspected, edited, or reset
- Privacy: learning state stays local

**LOC budget:** ~300 LOC learning capture plus application.

### 7.3 Phase 4 Acceptance Criteria

1. Final report renders cleanly with all evidence
2. License compliance audit accurate
3. Continuous improvement hooks operational
4. Future runs benefit from prior orchestration learning
5. End-to-end test: complete pipeline from PRD to final report

---

## 8. The Canonical Command Surface

The user-facing CLI for orchestration.

```bash
# Full pipeline
danteforge matrix <prd-path>
danteforge matrix <prd-path> --target oss-frontier  # stop at Phase A
danteforge matrix <prd-path> --target closed-source-frontier  # full pipeline (default)
danteforge matrix <prd-path> --max-agents 20
danteforge matrix <prd-path> --max-cost 100
danteforge matrix <prd-path> --providers claude-code,codex
danteforge matrix <prd-path> --skip-approval  # autonomous mode (require explicit flag)

# Individual phases
danteforge matrix read <prd-path>
danteforge matrix discover --intent <intent-json>
danteforge matrix analyze --universe <universe-json>
danteforge matrix synthesize-dimensions --analysis <analysis-json>
danteforge matrix score --dimensions <dimensions-json>
danteforge matrix detect-capacity
danteforge matrix execute-phase-a --matrix <matrix-json> --capacity <capacity-json>
danteforge matrix execute-phase-b --matrix <matrix-json> --capacity <capacity-json>
danteforge matrix report

# Inspection
danteforge matrix status
danteforge matrix logs
danteforge matrix learning-state
danteforge matrix replay <run-id>
```

---

## 9. Failure Modes and Recovery

| Failure Mode | Detection | Recovery |
|--------------|-----------|----------|
| PRD too ambiguous to extract structured intent | Extraction returns low confidence | Prompt user for clarification before proceeding |
| Competitive universe too broad (>100 competitors) | Discovery returns excessive results | Apply tighter filters; user approval required for proceeding |
| OSS competitor clone fails | Harvest error | Skip competitor, note in audit, continue with remaining |
| License classification ambiguous | UNKNOWN classification | Defer harvest, prompt user for manual classification |
| Social signal sources rate-limit | Web-fetch failure | Capture available signal, note gap, continue with reduced data |
| Dimension synthesis produces inconsistent dimensions | Validation fails | Retry synthesis with stricter prompt; manual override available |
| Agent capacity detection fails | Provider unresponsive | Skip provider, recalculate capacity, continue |
| Phase A budget exhausted before OSS frontier reached | Budget threshold | Stop Phase A, generate intermediate retrospective, user decides whether to continue |
| Phase B work proves uninferential | Red Team rejects too many branches | Pause Phase B, request user input on architecture, resume with guidance |
| Final report inconsistent with evidence | Validation check | Block report, surface inconsistency, require resolution |

**Strictness mode default:** standard. Production deployments use strict, which fails on ambiguous extractions or excessive discovery.

---

## 10. Success Definition

PRD-MATRIX-ORCHESTRATION-V1 is complete when all of the following are GREEN:

**Quantitative:**
1. PRD-to-final-report pipeline completes end-to-end on DanteCode PRD
2. Project moves from current score to OSS frontier on majority of dimensions in Phase A
3. Project moves further toward closed-source frontier in Phase B
4. Total time from `danteforge matrix /path/to/prd.md` to final report: under 24 hours wall time
5. Total cost: under $200 in API spend for moderate-complexity project
6. License compliance audit: zero violations

**Qualitative:**
1. Dogfooding on DanteCode produces measurably better code than current state
2. The retrospective provides actionable next-iteration recommendations
3. User experience matches the described vision (one command, structured progress, clean final state)
4. Constitutional discipline maintained throughout (no fake completion, no license violations, no protected path edits)

**Constitutional:**
1. All Articles I-XV continue to operate correctly
2. Three-way gate enforced through orchestration pipeline
3. Time Machine reversibility preserved across phases
4. Evidence chain emission consistent
5. PRD-OSS-LICENSE-DISCIPLINE-V1 fully enforced throughout

**Strategic:**
1. The PRD-to-frontier workflow becomes operational rather than aspirational
2. DanteForge can be applied to any project that produces a PRD
3. The substrate demonstrably produces qualitatively different output than single-agent work
4. Real Empanada B2B operations workflows can be PRD'd and orchestrated through this pipeline

---

## 11. Out of Scope for v1

Explicit non-goals to keep scope tight:

- Real-time collaboration between user and substrate during execution (batch approval at phase transitions only)
- Multi-PRD orchestration in single run (one PRD per orchestration)
- Cross-project pattern transfer (each orchestration is independent)
- Hosted/cloud orchestration (local-first only)
- Mobile or web UI (CLI plus optional VS Code War Room from Matrix Kernel Phase 14)
- Auto-merge to main without user approval (constitution rule)
- Public publishing of orchestration results (operational stability before external claims)

---

## 12. Open Questions for Implementation Agents

Resolve by inspecting current state at build time:

1. Has Matrix Kernel Phase 13 (real adapters) shipped? If not, this PRD is on hold.
2. What's the current state of existing `compete-matrix.ts`? Phase 2 dimension synthesis builds on it.
3. What's the current state of existing harvest commands? Phase 2 OSS harvest orchestrates them.
4. Has PRD-OSS-LICENSE-DISCIPLINE-V1 been implemented? Phase 1 and Phase 2 depend on it.
5. What's the current Reddit/X access through web-fetch? Phase 1 and Phase 2 social signal depends on it.
6. Are there existing provider detection patterns? Phase 3 capacity detection should extend them.
7. What's the current Matrix Kernel CLI state (per Phase 13)? Phase 4 orchestration commands extend it.

---

## 13. Constitutional Discipline

This PRD operates under the Dante Constitution. All Articles I-XV apply.

**Article X OSS Pattern Learning:** This PRD is the orchestration layer that makes Article X operationally repeatable across any project category.

**Article XIV Brand Asset Protocol:** Competitor profiles must accurately name competitor projects and their owners.

**Article XV Causal Coherence (pending ratification):** Predictions in capacity detection, time-cost estimates, and Phase B planning get measured against actuals. Predictor accuracy contributes to causal coherence dimension.

**Three-Way Gate:** Active throughout orchestration. Phase A and Phase B agents subject to three-way gate. Final report subject to gate verification.

**Fail-Closed Semantics:** PRD with insufficient detail refuses to extract structured intent rather than fabricate. Discovery with no clear matches returns empty rather than hallucinate competitors. Phase B with insufficient inferential signal pauses rather than proceeds with low confidence.

---

## 14. Build Calendar (Indicative)

| Week | Focus |
|------|-------|
| 1 | Phase 1: PRD ingestion plus competitive universe discovery |
| 2 | Phase 2: Competitive analysis plus dimension synthesis |
| 3 | Phase 3: Two-phase frontier execution |
| 4 | Phase 4: Final report plus continuous improvement; end-to-end testing on DanteCode |

Total: 4 weeks at demonstrated rate. Realistic completion in 18-25 days with parallel agent execution where dependencies permit.

---

## 15. Final Handoff Notes for Implementation Agents

This PRD is the canonical specification for PRD-to-frontier orchestration above Matrix Kernel.

Framing for handoff:

> This is PRD-MATRIX-ORCHESTRATION-V1, the orchestration layer that turns one PRD plus one command into full competitive-frontier closure through Matrix Kernel coordination. Read it fully. Verify Matrix Kernel Phase 13 (real adapters) has shipped before beginning. Each phase has its own acceptance gate including end-to-end testing on DanteCode as dogfood target. The constitutional substrate must not be diluted. Goal: developer writes PRD, runs `danteforge matrix /path/to/prd.md`, gets project moved from current state to frontier across 50 dimensions with full evidence chain.

Implementation agents have full autonomy to:
- Re-sequence work within a phase if dependencies dictate
- Skip sections that are already shipped
- Extend existing patterns rather than create parallel ones
- Recommend scope changes based on actual current state

Implementation agents must NOT:
- Begin before Matrix Kernel Phase 13 (real adapters) ships
- Skip end-to-end testing on DanteCode at Phase 4
- Bypass three-way gate
- Violate KiloCode discipline
- Allow license violations through OSS harvest
- Permit auto-merge without explicit user flag

---

**END OF PRD-MATRIX-ORCHESTRATION-V1**

*Implementation begins when an agent is given this PRD plus access to current DanteForge state showing Matrix Kernel Phase 13 shipped. Phase 1 starts with PRD reader plus discovery engine. Phases ship independently with acceptance gates. Constitutional discipline non-negotiable. End state: developer writes PRD, runs one command, project reaches frontier across 50 dimensions with full evidence chain. The world-changing workflow operational rather than aspirational.*
