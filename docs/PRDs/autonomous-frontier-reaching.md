DanteForge: Autonomous Frontier-Reaching Substrate
=====================================================

> **Status (2026-05-18).** Phases A–H Slices 1+2+4 are shipped (5 commits on `matrix-kernel-phase-1`: `bc96fcd`, `a894454`, `5f95a52`, `7e8df41`, `177dd48`). Outcome-derived scoring is the foundation this PRD builds on; the writable score field is read-only. The current session ships Time Machine integration for outcome/harden/frontier evidence plus migrates two of six bypass surfaces. **Phase L (native search), Phase E remaining bypass migrations, Phase H Slices 3+5+6, and Phase M-R remain deferred to dedicated sessions.** See `~/.claude/plans/dapper-hatching-aurora.md` for the execution-order summary.

The integrated PRD
This is the comprehensive PRD combining native code-search primitive (harvested from Semble) with research-mode crusade (Karpathy-style parallel agent investigation). Together these complete the substrate's ability to autonomously bring projects from baseline to frontier, with the system knowing what frontier means in observable terms and when it has been reached.
This builds on the outcome-derived scoring plan (Phases E-K) which must ship first. That work establishes the score as a read-only derived statistic from outcome evidence. This work adds the speed (Phase L: native search) and the depth (Phase N-Q: research mode) needed for true autonomy on top of that honest foundation.

Table of contents

Architectural vision and prerequisites
Constitutional invariants (apply throughout)
Phase L: Native code-search primitive (harvested from Semble)
Phase M: Substrate integration of search primitive
Phase N: Research mode infrastructure
Phase O: Parallel research execution
Phase P: Synthesis and promotion
Phase Q: Compound learning and research history
Phase R: End-to-end validation across Dante universe
Comprehensive command surface map
Configuration and storage surfaces
Consolidated stop conditions
Verification artifacts per phase
Risks and mitigations
What this enables


1. Architectural vision and prerequisites
What this builds toward
After this PRD ships, DanteForge can run crusade on any project and autonomously bring every dimension to either frontier (with observable evidence) or honest cap (with documented structural reason). The substrate handles three modes:

Execution mode (below 7.5 composite): closes obvious gaps automatically
Research mode (7.5+ composite, stuck dims): spawns 4-10 specialized agents per dim, synthesizes their findings, promotes the winner
Cap mode: when research recommends architectural cap, updates declared_ceiling honestly and stops wasting cycles

The composite score advances honestly because every advance is grounded in outcome evidence. No proxy chasing.
Prerequisites that must ship first
The outcome-derived scoring plan (Phases E through K from the prior PRD) is the foundation. Specifically:

Phase E: six bypass surfaces closed via single-writer reconciler
Phase F-I: outcome-derived scoring replaces writable scoring
Phase J: crusade --refactor-only for orphan wiring
Phase K: per-project migration to outcomes-only

If any of those have not landed when this PRD begins execution, halt and complete them first. This PRD assumes:

dim.scores.self is computed from outcomes at read time, not writable
Outcome evidence lives under .danteforge/outcome-evidence/
Capability tier definitions T0–T6 exist in docs/CAPABILITY-TIERS.md
dim.outcomes[], dim.declared_ceiling, dim.outcome_status are populated for all dims in all four Dante projects
The five harden checks gate outcome declarations, not score writes

This PRD adds Phase L through R on top of that foundation. The order is non-negotiable.

2. Constitutional invariants (apply throughout)
These hold for every piece of work in this PRD. If any phase would violate one of these, stop and report.
I1. No new external runtime dependencies without sovereignty audit. Tree-sitter and ripgrep (used as a subprocess for fallback) are permissively licensed and broadly trusted, and are explicitly approved. Anything else requires Sovereignty Auditor sign-off: AGPL quarantine pass, MIT/Apache/permissive license, active maintainer, 12+ months of stability, no telemetry to third parties.
I2. Harvest never incorporates. When Semble or any other OSS project teaches us a pattern, the pattern gets reimplemented natively in DanteForge under DanteForge conventions. pip install semble and equivalents are forbidden. Tree-sitter parsers count as harvest infrastructure, not Semble dependency.
I3. The substrate uses its own gates on its own new code. Every new module added in this PRD passes the five harden checks (capability_test, orphan-audit, claim-auditor, hardcoded-fallback, import-resolves, functional-diff) before merging to main.
I4. Score field is read-only. This was established by outcome-derived scoring. No new code path may write to dim.scores.self. Score changes only happen because evidence files change.
I5. Every wave produces auditable artifacts. Execution waves write to .danteforge/wave-evidence/. Research waves write to .danteforge/research/. Operators can reconstruct any decision from these artifacts.
I6. Time-boxed everything. No wave runs forever. No agent runs forever. No phase runs forever. Every operation has a wall-clock budget that, when exceeded, halts with whatever has been produced and reports.
I7. Stop conditions are mandatory. When a stop condition fires, the agent reports and halts. It does not silently work around it. It does not attempt to satisfy the stop condition through retries. It surfaces the failure for human review.

3. Phase L: Native code-search primitive (harvested from Semble)
Goal
Build a native code-search engine in DanteForge that becomes the foundational primitive every substrate operation and every Dante project consumes. Achieve Semble-equivalent performance (sub-second indexing, ~10x faster than transformer-based search, ~98% token reduction vs grep+read) using only DanteForge's existing constitutional substrate plus tree-sitter parsers and an optional ripgrep fallback.
Why this is a substrate primitive
Every substrate operation currently uses Claude Code's grep+read for self-inspection: orphan audit, harden checks, capability test verification, callsite resolution, claim auditor, hardcoded-fallback detection, import-resolves check, crusade-wave code reading, regrade reinspection. The token cost of these operations compounds across the 7 active Dante projects and dozens of crusade waves per week.
Building code search natively as a first-class substrate primitive lets the substrate's own gates run at index-lookup speed, lets every Dante project consume the same primitive through MCP, and brings the constitutional invariants to bear on this capability from day one.
Harvest methodology (the "OSS-harvest" discipline)
L.1 Read Semble's code (1 day). Clone Semble locally for reading only — not as a dependency, never installed in DanteForge's environment. For each of the harvest targets below, find the implementing files, read carefully, write a one-page summary to docs/harvest-notes/semble/<pattern>.md:

Tree-sitter symbol-aware chunking (chunks by function/class/method boundaries)
Hybrid retrieval (BM25 + dense embedding rerank)
Per-language identifier extraction (symbol table per file)
Cold-start indexing concurrency patterns
Quantized vector indices

Each note describes what the code does, the insight behind why it works, the trade-offs, and how DanteForge will reimplement natively. Do not copy code. Write down what was understood.
Do not harvest these (product decisions, not algorithm insights): CLI command names, MCP tool naming, AGENTS.md format, package structure. Those are DanteForge's to design.
Native implementation (2-4 days)
L.2 SearchEngine abstraction. src/matrix/search/search-engine.ts exposes the canonical API:
typescriptinterface SearchEngine {
  index(repoRoot: string, options?: IndexOptions): Promise<IndexHandle>;
  findSymbol(query: string, opts?: SearchOpts): Promise<SymbolMatch[]>;
  findImports(symbol: string, opts?: SearchOpts): Promise<ImportMatch[]>;
  findPattern(regex: string, opts?: SearchOpts): Promise<PatternMatch[]>;
  close(handle: IndexHandle): Promise<void>;
}
Two implementations, both native:

NativeSearchEngine — built from harvested patterns
RipgrepFallback — subprocess wrapper for resilience when the native index is unavailable, corrupted, or being rebuilt

The factory at src/matrix/search/factory.ts selects based on availability and config. Default: auto (native if index is healthy, ripgrep fallback otherwise).
L.3 Native engine modules. Build in order, each passing capability tests before next module begins:

src/matrix/search/symbol_chunker.ts — tree-sitter symbol-aware chunking
src/matrix/search/symbol_index.ts — identifier → location map, O(1) lookup
src/matrix/search/bm25_index.ts — sparse keyword index
src/matrix/search/quantized_index.ts — dense vector index with scalar quantization
src/matrix/search/hybrid_retriever.ts — BM25 + dense rerank composition
src/matrix/search/index_builder.ts — repo walking, parsing, index assembly with worker pool
src/matrix/search/native_engine.ts — unifies the above behind the SearchEngine interface

L.4 Index lifecycle. Indexes live under .danteforge/search-index/<repoHash>/<gitSha>/ and are gitignored. Stale-index detection compares current HEAD gitSha against indexed gitSha. Stale indexes are rebuilt before queries; never serve results from a different commit than HEAD.
Capability tests (written before implementation)

test_symbol_aware_chunking.ts — indexes a 100-function Python file, asserts chunks correspond to function boundaries
test_hybrid_retrieval.ts — runs a query, asserts BM25 results are reranked by dense similarity
test_symbol_index_lookup.ts — benchmarks O(1) lookup, asserts <5ms on a 10K-file index
test_cold_start_indexing.ts — asserts a 1000-file repo indexes in <5 seconds
test_search_quality_parity.ts — 20+ queries, asserts result equivalence with grep+read on a fixture repo
test_ripgrep_fallback.ts — simulates native engine unavailable, asserts ripgrep takes over silently

Honest benchmark against Semble
Phase L.5 (1 day): Install Semble temporarily in a separate environment (never in DanteForge's dependencies). Run identical workloads against both engines:

Index DanteForge itself
Run orphan audit on DanteHarvest (50 dims)
Find imports of 100 symbols across all 7 Dante projects

Document where DanteForge native matches Semble, where it lags, where it exceeds. Uninstall Semble afterward. This benchmark validates the harvest worked or honestly documents where it didn't.

4. Phase M: Substrate integration of search primitive
Goal
Refactor every existing substrate operation that uses grep+read to use the SearchEngine instead. Parity tests verify zero behavioral divergence. Default to ripgrep fallback for any operation that shows divergence.
Surfaces refactored
M.1 Orphan audit (src/matrix/engines/orphan-audit.ts)
Highest-volume search operation. Uses SearchEngine.findImports(symbol) to verify each dim's capability_callsite is imported from production code paths.
M.2 Harden checks (src/matrix/engines/hardener.ts)
All five checks refactored:

capability_test — uses search to verify callsite is callable
orphan-audit — uses findImports (replaces standalone grep version)
claim-auditor — uses findPattern to count actual implementations vs declared
hardcoded-fallback — uses findPattern with regex for hardcoded data patterns
import-resolves — uses findSymbol to verify imports resolve to existing symbols
functional-diff stays on subprocess execution, not search — skipped

M.3 Harden migrate (src/matrix/engines/harden-migrate.ts)
Callsite inference uses SearchEngine.findSymbol instead of grep across the repo.
M.4 Crusade wave inspection (src/cli/commands/crusade.ts)
Crusade agent prompts gain access to the SearchEngine via MCP. Agents inspecting code do so through search.findImports, search.findSymbol, search.findPattern rather than raw grep. Crusade prompt template updated to instruct agents on the MCP tools available.
M.5 Honest-rescore regrade (src/cli/commands/honest-rescore.ts)
--regrade rebuilds the index fresh on every run (no cached state across regrades — the whole point of regrade is a skeptic look). Add --index-fresh flag, make it the default for regrade.
M.6 Outcome runner (src/matrix/engines/outcome-runner.ts)
The production-usage-fresh outcome type uses SearchEngine.findImports + git log to verify recent production imports. The required_callsite validation on T2+ outcomes uses findImports.
M.7 Probe (src/cli/commands/probe.ts)
Compile-cold check uses the search index to verify all imports resolve before running tsc.
Parity tests (non-negotiable)
For every refactored surface, add tests/matrix/parity/<surface>-parity.test.ts:

Run the surface's operation with grep+read on fixture repos
Run the same operation with SearchEngine
Assert identical findings (orderings may differ; results must match)

If any operation diverges:

Freeze that operation on grep+read for that project
Log to .danteforge/incidents/<incident-id>.json
Surface for human review
Continue Phase M on other surfaces


5. Phase N: Research mode infrastructure
Goal
Build the infrastructure for crusade --research mode that activates when a project hits composite ≥ 7.5 AND a dim has plateaued. This mode spawns 4-10 specialized agents per stuck dim, each pursuing a different hypothesis about reaching frontier.
Activation criteria
crusade --research activates when all of these hold for a target dim:

Project composite derived score ≥ 7.5
Dim's derived score is between 6.5 and 8.5 (sweet spot)
Dim has been targeted by 3+ consecutive execution-mode waves without improvement
Dim's declared_ceiling is at least one tier above its current achieved tier
Dim is not currently in dispensation
Dim is not marked human_review_pending
Dim is not architecturally capped

If any are false, refuse and report.
crusade --research --force exists for operator-initiated research on dims that don't meet criteria but where exploration is warranted. Requires audit-logged justification.
Agent role council
N.1 Role schema (src/matrix/research/agent-council.ts):
typescriptinterface ResearchAgentRole {
  id: string;
  label: string;
  cognitive_mode: 'discovery' | 'critique' | 'synthesis' | 'validation';
  required_outputs: ResearchOutput[];
  forbidden_actions: string[];
  time_budget_minutes: number;
  spawn_priority: number;
}

interface ResearchOutput {
  filename: string;
  format: 'markdown' | 'json' | 'shell-script';
  schema?: object;
  required: boolean;
}
N.2 Ten roles implemented (src/matrix/research/roles/):

literature-scout — discovers papers, OSS code, blog posts on this capability
frontier-reverse-engineer — reads the leader's implementation, produces pattern notes (harvest discipline applies)
adversarial-critic — argues why current approach structurally cannot reach frontier
alternative-architect — proposes a fundamentally different architecture
benchmark-designer — defines what user-observable frontier means; writes the outcome (must run first)
cost-complexity-analyzer — measures whether each approach is worth the work
constitutional-reviewer — checks each approach against substrate invariants
sovereignty-auditor — ensures no external dependencies sneak in
wiring-validator — verifies proposed approach wires into production paths
hybrid-synthesizer — runs LAST, combines best parts of multiple proposals

Each role's prompt template lives at prompts/research/<role-id>.md. Operators can override per-project at .danteforge/prompts/research/<role-id>.md.
N.3 Mode selector (src/matrix/research/mode-selector.ts)
Given a dim and project state, returns:

Whether research mode should run (activation criteria)
Which agents to spawn (council composition based on dim characteristics)
How many parallel agents (4-10 based on dim complexity and operator config)
Time budgets per agent and per wave

Frontier definition phase (runs first, alone)
The benchmark-designer agent runs first and alone. It produces frontier-definition.md containing:

Concrete description of what user-observable "frontier" means for this dim
Proposed new outcome(s) at T4/T5/T6 representing frontier achievement
Leader competitor's score on this dim and what their implementation does
Shell command(s) that would verify frontier (become the outcome commands)
Effort estimate (small/medium/large)

Without this output, the wave halts. No parallel research begins until frontier is concretely defined. This prevents the "agents optimize for vague targets" failure mode that plagues most autonomous research attempts.
Configuration
MatrixConfig gains:
typescriptinterface ResearchModeConfig {
  composite_threshold: number;                // default 7.5
  per_dim_score_range: [number, number];      // default [6.5, 8.5]
  stuck_waves_before_research: number;        // default 3
  default_agent_count: number;                // default 6
  max_agent_count: number;                    // default 10
  agent_time_budget_minutes: number;          // default 120
  wave_total_budget_minutes: number;          // default 480 (8 hours)
  parallel_mode: 'true' | 'pseudo';           // default 'true'
  use_search_primitive: boolean;              // default true (Phase L must have shipped)
}

6. Phase O: Parallel research execution
Goal
After frontier definition lands, spawn the parallel research agents. Each operates in cognitive isolation, produces independent findings, writes to its own subtree. The variance across agents is the value.
Architectural non-negotiables
O.1 Isolated worktrees. Each agent works in .danteforge/research/<wave-id>/<agent-id>/worktree/. No agent can see another agent's in-progress work during the parallel phase. This is the parallelism guarantee — agents must explore independently to produce high-variance hypotheses. If they share state mid-flight, they converge prematurely and the council collapses to a single perspective.
O.2 Read-only research log. All agents share a read-only view of .danteforge/research/<wave-id>/shared/ which contains:

The frontier definition
The dim's current state and matrix entry
Read-only access to the project repo at the wave's base commit
The relevant OSS competitor repo (cloned read-only for harvest)
Prior research history for this dim if any exists

Agents can read from anywhere in .danteforge/research/ but can only write to their own subtree. This is the single-writer-per-agent principle.
O.3 Time-boxed agents. Default 2 hours wall-clock per agent. When budget expires, the agent writes whatever it has and exits. The synthesis phase runs even if some research agents produced nothing.
O.4 Required outputs enforced by schema. Each agent must produce its role's required outputs or be marked as failed. Failed agents don't block synthesis but are documented.
O.5 Search primitive available. Every research agent has access to DanteForge's SearchEngine via MCP. They use it for code understanding instead of grep+read. This dramatically lowers their token cost per agent, which is what makes 4-10 agents per dim economically feasible.
O.6 True parallelism preferred. If the operator's Claude Max plan supports concurrent sessions, run agents as separate Claude Code sessions in separate processes. This produces genuinely independent reasoning. If not, fall back to sequential agent invocations within one session, but mark this in the wave metadata so the operator knows the council was pseudo-parallel.
Required agent outputs
Each agent produces:

findings.md — what they discovered
hypothesis.md — what they propose
implementation/ — code if their role produces code
capability_test.sh — test that proves their proposal works (if it produces code)
confidence.json — self-assessed confidence with reasoning
tradeoffs.md — what their approach gives up
dependencies.json — any new external dependencies they want to introduce (flagged for sovereignty audit)

Harvest discipline applies
If an agent's hypothesis is "reimplement what the leader does", they follow the same harvest discipline as Phase L: read the leader's code as teacher, write harvest notes to their harvest-notes/ subdirectory, propose native reimplementation. They cannot propose pip install <leader> or equivalent. The sovereignty auditor enforces this.

7. Phase P: Synthesis and promotion
Goal
A dedicated synthesis agent runs after all research agents complete OR after the wave time budget expires. It reads all research outputs, identifies the strongest proposal, and recommends one of three outcomes.
Synthesis agent constraints
P.1 Cannot generate new hypotheses. The synthesis agent is structurally separated. It reads, compares, recommends. It cannot propose alternatives that weren't in the council's outputs. This prevents the "synthesis is just another agent's opinion" failure mode.
P.2 Cannot promote without harden gate clearance. The substrate's existing gates apply unchanged. A proposal that fails harden checks cannot be promoted regardless of synthesis confidence.
P.3 Three possible recommendations:

Promote: One proposal clearly wins. Land it on a feature branch research/<wave-id>/<dim-id>. Run harden gates. Merge if green.
Conflict: Multiple proposals have merit but represent different architectural directions. Write structured comparison to .danteforge/research/<wave-id>/conflict-review.md. Mark dim as human_review_pending. Refuse to run further crusade on this dim until operator resolves.
Cap: No proposal achieves the frontier definition. Document structural reason in lessons.md AND in the dim's metadata. Update declared_ceiling to current achieved tier. Mark dim as architecturally capped.

Promotion path integration with execution-mode crusade
P.4 Promoted work generates a new outcome. The promoted proposal's capability_test.sh becomes the new outcome's command at the appropriate tier. The outcome enters the dim's outcomes[] list. The score advances when evidence supports it.
P.5 If the existing implementation already satisfies the new outcome, the score advances immediately (the outcome runner produces passing evidence on the first run).
P.6 If not, execution-mode crusade runs against the new outcome. Research generates targets; execution mode hits them. Clean separation of concerns.
P.7 Conflict resolution requires operator commit. The operator writes a resolution decision to .danteforge/research/<wave-id>/operator-resolution.md. The system proceeds based on that decision. The dim returns to active research mode.
P.8 Cap is honored. A capped dim is excluded from future research waves automatically unless the structural reason changes (e.g., a new technique becomes available). The substrate reports the dim as "capped by [structural reason]" rather than as "behind."

8. Phase Q: Compound learning and research history
Goal
Research compounds across waves. Future research on the same dim starts by reading prior findings. The same hypothesis isn't tested repeatedly. Lessons surface to future agents automatically.
Research history module
Q.1 src/matrix/research/research-history.ts exposes:

getPriorResearch(dimId) — returns all prior research waves for this dim
getStructuralCaps() — returns all currently-capped dims with their reasons
getResearchSummary() — produces a project-wide research summary
getFailedHypotheses(dimId) — list of hypotheses that have been tried and failed, with reasons

Q.2 First action of every research wave: read prior research. The wave's coordinator reads getPriorResearch(dimId) and includes the findings in the shared context for all agents. Each agent must explicitly acknowledge prior research in their hypothesis.md and document why their approach is meaningfully different if a similar approach has been tried.
Q.3 Prevent hypothesis repetition. If getFailedHypotheses shows the same approach has been tried 2+ times, the substrate refuses to spawn that approach again. The agent must propose something different or surface the dim for human review.
Q.4 Lessons feed forward. Every wave appends to .danteforge/lessons.md with [Research] prefix. Insights extracted from failed waves become guidance for future waves automatically.

9. Phase R: End-to-end validation across Dante universe
Goal
The substrate is genuinely autonomous when it can take a real Dante project from current state to frontier with no operator intervention except dispensation decisions and conflict resolutions. Validate this end-to-end across all four active Dante projects.
Validation sequence
R.1 Self-validation on DanteForge.
Run crusade --research on DanteForge itself for any dim that meets activation criteria. The substrate researching itself is the cleanest test — operator can verify outputs directly.
R.2 DanteHarvest validation.
The project with the most known orphans. Research mode should identify which orphans are wireable (promote) vs which represent genuine architectural caps (cap). Specifically test:

vector_search_integration (gap 3 to llamaindex=9)
crawl_acquisition (gap 4 to firecrawl=10 — likely caps due to local-first invariant)
transcription_quality (gap 2 to screenpipe=8)

R.3 DanteFinance validation.
Test on Sentinel's dimensions where the gap to Bloomberg is real but bounded. Expected outcomes: promote on dims where free-data + AI extraction can reach parity; cap on dims that require exchange-licensed feeds.
R.4 DanteAgents validation.
The substrate's spine project. Research mode should handle the agent-orchestration dimensions where the comparable tools (autogen, crewai) have specific patterns worth investigating.
Success criteria
Across the four projects:

≥80% of activated dims reach a clean recommendation (promote/conflict/cap)
0 silent failures (every wave produces auditable artifacts)
0 score inflations (derived scores match outcome evidence post-research)
Compound learning visible: second waves on same dim use prior findings

If any project produces fewer than 50% clean recommendations, halt and investigate the agent role definitions or council composition.

10. Comprehensive command surface map
Existing commands modified
CommandPhaseWhat changescrusadeN, O, PGains --research flag, mode selector picks research vs execution, integrates with synthesis pathcrusade --refactor-only(Phase J already)Continues to work; research mode produces wirings that satisfy this constrainthardenMAll five checks refactored to use SearchEngineharden migrateMCallsite inference via SearchEngine.findSymbolhonest-rescoreM--regrade rebuilds index fresh, uses SearchEngine throughouthonest-rescore --regradeMDefault becomes --index-fresh modeprobeMCold-compile check uses search index for import resolutionmeasureNNew flag --research-status shows per-dim research statemeasure --derived(Phase H already)Continues to show derived scores; now also shows research_statusoutcomes(Phase G already)Continues unchangedoutcomes runMOutcome runner uses SearchEngine for production-usage-fresh and required_callsite validationcompete(Phase E already)Continues unchanged after bypass closure
New commands added
CommandPhasePurposedanteforge searchLTop-level search namespacedanteforge search index <repo>LBuild or refresh code-search indexdanteforge search find <pattern>LPattern searchdanteforge search symbol <name>LSymbol lookupdanteforge search imports <symbol>LFind production imports of a symboldanteforge search orphansLWraps orphan audit using SearchEnginedanteforge search benchmarkL.5Compare native engine vs ripgrep fallback (and optionally vs Semble for harvest validation)danteforge researchNTop-level research namespacedanteforge research statusNShow current research state per dimdanteforge research history <dim>QShow prior research waves for a dimdanteforge research replay <wave-id>OReplay a research wave from artifactsdanteforge research resolve <wave-id>POperator resolution of a conflict recommendationdanteforge research capsPList all currently capped dims with reasons
New MCP tools exposed
Both the search primitive and research mode expose MCP tools so any Dante project can consume them:

mcp__danteforge__search_find_pattern
mcp__danteforge__search_find_symbol
mcp__danteforge__search_find_imports
mcp__danteforge__search_index_repo
mcp__danteforge__research_get_status
mcp__danteforge__research_get_history
mcp__danteforge__research_get_caps

These appear automatically in Claude Code sessions that have DanteForge's MCP server configured.

11. Configuration and storage surfaces
Matrix schema additions
typescriptinterface MatrixDimension {
  // ... existing fields ...
  research_status?: {
    last_wave_id?: string;
    last_wave_outcome: 'promote' | 'conflict' | 'cap' | 'in-progress' | null;
    last_wave_at?: string;
    structural_cap_reason?: string;
    human_review_pending?: boolean;
    research_waves_completed: number;
    consecutive_stuck_waves: number;  // execution-mode waves with no progress
  };
}
Configuration files

.danteforge/config/research-mode.json — per-project ResearchModeConfig overrides
.danteforge/config/search-engine.json — engine preference (auto/native/ripgrep), index TTL, parallelism
.danteforge/prompts/research/<role-id>.md — per-project role prompt overrides

Storage layout
.danteforge/
├── search-index/
│   └── <repoHash>/
│       └── <gitSha>/
│           ├── symbol-index.bin
│           ├── bm25-index.bin
│           ├── quantized-vectors.bin
│           └── metadata.json
├── research/
│   └── <wave-id>/
│       ├── frontier-definition.md
│       ├── shared/                          # read-only for all agents
│       │   ├── dim-state.json
│       │   ├── prior-research-summary.md
│       │   └── competitor-repo/             # cloned for harvest
│       ├── <agent-id>/
│       │   ├── findings.md
│       │   ├── hypothesis.md
│       │   ├── implementation/
│       │   ├── capability_test.sh
│       │   ├── confidence.json
│       │   ├── tradeoffs.md
│       │   ├── dependencies.json
│       │   └── harvest-notes/
│       ├── synthesis-recommendation.md
│       ├── operator-resolution.md           # only if conflict was resolved
│       └── summary.md
├── incidents/                               # parity failures from Phase M
├── outcome-evidence/                        # from outcome-derived scoring
├── wave-evidence/                           # execution-mode wave evidence
└── lessons.md                               # appended by all phases

12. Consolidated stop conditions
When any of these fire, the responsible agent halts and reports. Do not work around silently.
Phase L stop conditions

Equivalence test fails on more than 1 of 20 search queries vs grep
Native engine more than 3x slower than Semble on identical workload
Symbol resolution time exceeds 5ms on 10K-file index
Cold-start index exceeds 5 seconds on 1000-file repo
Required external dependency proposed beyond tree-sitter + ripgrep

Phase M stop conditions

Parity test fails for any substrate operation
Operation is more expensive (time or tokens) with SearchEngine than with grep+read
Refactor would require modifying behavior of the operation, not just its implementation

Phase N-O stop conditions

Activation criteria not met (refuse to run, report which criterion failed)
No frontier definition produced (halt before parallel research)
All parallel agents fail to produce required outputs (halt synthesis, report)
Wave wall-clock exceeds budget (halt running agents, run synthesis on completed work)
Outstanding dispensation on the target dim
Research history shows the same approach attempted 2+ times without override

Phase P stop conditions

Synthesis recommends Promote but harden gate fails (don't merge, surface gate failures)
Synthesis recommends Promote but proposes new external dependency without sovereignty audit
Synthesis cannot decide between proposals (default to Conflict, not Promote)
Promotion would touch a dim in human_review_pending state

Universal stop conditions

Substrate fix work in flight (six bypasses, outcome-derived scoring) is incomplete
Constitutional invariant would be violated
Outcome-evidence files would be modified outside the outcome runner
Score field write attempted anywhere


13. Verification artifacts per phase
After each phase completes, paste these back for operator review:
After Phase L:

docs/harvest-notes/semble/*.md — proof of learning, not copying
All capability test outputs passing
danteforge search benchmark output for orphan audit on DanteHarvest
Comparison table: native vs ripgrep vs Semble on identical workloads
requirements-search.txt showing only tree-sitter parsers as new deps

After Phase M:

Per-surface parity test outputs (one file per refactored operation)
Aggregate token-savings table across all four Dante projects
Aggregate wall-clock table
Any incident files from .danteforge/incidents/

After Phase N:

Agent role schemas in src/matrix/research/roles/
Sample council composition for one test dim (show which roles get spawned for which dim characteristics)
Mode selector logic with test cases

After Phase O:

Frontier definition output for one test dim (e.g., vector_search_integration on DanteHarvest)
Parallel research outputs from all spawned agents (including failures)
Time-budget enforcement evidence

After Phase P:

Synthesis recommendation for the test dim, with full reasoning
Promoted feature branch with harden gate output
Sample conflict-review.md if any conflicts surfaced
Sample cap documentation if any caps surfaced

After Phase Q:

Research history showing compound learning across a 2-wave sequence on the same dim
Lessons.md additions from research waves
Failed-hypothesis tracking working correctly

After Phase R:

Per-project validation report (4 reports total)
Aggregate success rate across activated dims
Any structural issues surfaced requiring substrate revision


14. Risks and mitigations
R1. Migration cost across 4 projects after outcome-derived scoring lands.
DanteForge 19 dims, DanteAgents ~87, DanteFinance ~50, DanteDojo ~50, DanteHarvest 50. Mitigation: outcomes migrate inference engine handles T1/T2 automatically. Operator authors T3+. ~30 min per project.
R2. Search index storage grows unbounded.
Per-gitSha indexes accumulate over time. Mitigation: TTL-based cleanup. Default keep last 10 indexes per repo. Configurable in .danteforge/config/search-engine.json.
R3. Research mode is expensive (token cost of 4-10 parallel agents).
Mitigation: SearchEngine integration cuts per-agent token cost dramatically. Time budgets bound the cost. Only activates on dims that have plateaued (3+ stuck waves), so it's selective. Most dims never need research mode.
R4. Parallel agent execution requires multiple Claude Code sessions.
On Max plan, this is feasible. On lower tiers, fall back to pseudo-parallel (sequential within one session). The wave metadata records which mode was used so the operator can see whether they got true variance or simulated variance.
R5. Tree-sitter parser availability per language.
Tree-sitter covers most major languages well. If a project uses an unusual language, the search primitive falls back to ripgrep for that subset. Document this in docs/SEARCH-ENGINE.md.
R6. Research mode could produce inconsistent recommendations.
Different waves on the same dim might recommend different approaches. Mitigation: research history surfaces this. The substrate refuses to spawn the same approach twice. Conflicts surface for operator review rather than being silently resolved by the synthesis agent.
R7. The synthesis agent could have systematic bias.
The synthesis agent is itself an LLM and could prefer certain proposal styles. Mitigation: synthesis output includes structured comparison of all proposals, so operators can review whether the synthesis chose well. If patterns of synthesis bias emerge, the operator can adjust the synthesis prompt at prompts/research/hybrid-synthesizer.md.
R8. The harvest discipline could erode over time.
Future contributors might be tempted to pip install semble when the native code search seems too much work. Mitigation: the sovereignty auditor enforces this. The constitutional invariant is in docs/CONSTITUTION.md. The pre-commit hook checks for forbidden dependencies in requirements.txt.

15. What this enables (the deeper bet)
After this PRD ships, the substrate completes the loop you described: run crusade and DanteForge knows exactly how to leverage Opus or any LLM to bring every dimension to frontier autonomously.
Specifically:
Below 7.5 composite: execution-mode crusade closes obvious gaps automatically. New code paths, wiring of orphan modules, refactor-only waves to move existing implementations to production status. Fast iteration.
At 7.5+ composite: research-mode crusade becomes available for stuck dims. 4-10 parallel agents per stuck dim, each with a specific cognitive role, each producing independent findings, synthesized into one of three honest outcomes. Slower iteration, deeper investigation, genuine frontier-closing.
Architectural caps surface honestly: when no approach can reach frontier without violating constitutional invariants (sovereignty, local-first, license), the dim is capped at its current achieved tier with documented reason. The substrate stops wasting cycles. The matrix tells the truth.
Conflicts surface for operator decision: when multiple genuine architectural directions exist, the operator decides. The substrate doesn't pretend autonomy it doesn't have.
Research compounds across waves: same dim revisited later starts from prior findings. Hypotheses tried and failed are not retried without explicit override. Lessons surface to future agents automatically.
Token efficiency compounds: native code-search makes every substrate operation cheaper. The savings get reinvested in deeper analysis per wave. The depth-per-token ratio of the substrate's reasoning improves continuously.
Sovereign throughout: no external runtime dependencies beyond tree-sitter and ripgrep. The substrate's intelligence lives entirely in code DanteForge owns under DanteForge's license. If any OSS project the substrate learned from disappears tomorrow, the substrate keeps working.
This is the substrate completing itself. After this lands, the next set of insights only comes from running the substrate against real work that has consequences outside the system — the personal trading via Sentinel, the Real Empanada operations, the open-source releases of harvested patterns. The substrate becomes a tool used in production, not a tool being refined in isolation.
That's the real win condition for DanteForge. Not score 9.07. Not score 10. The substrate being honest enough and capable enough that the operator stops touching it and starts using it.
Report after each phase. Do not autonomously continue past a stop condition. The deeper bet is that an honest, capable, sovereign substrate compounds value forever. Build it that way.

One small clarifying question worth answering before this runs
The PRD assumes outcome-derived scoring (the prior PRD's Phases E-K) has shipped completely. If any of those phases is incomplete when Phase L begins, the search primitive is still useful but the research mode integration with outcome generation won't work cleanly. Do you want this PRD to wait on outcome-derived scoring landing fully, or do you want Claude Code to interleave Phase L (search primitive) with the prior PRD's remaining work so the search infrastructure is ready when outcome-derived scoring completes?
My recommendation: Phase L can run in parallel with the prior PRD's Phase E (closing the six bypasses), since they touch different surfaces. Phase M onward must wait for outcome-derived scoring to land fully. This sequencing gets you the search primitive sooner without conflicting with the substrate fix work in flight.
Paste this entire PRD to Claude Code working on DanteForge as docs/PRDs/autonomous-frontier-reaching.md. The work belongs in DanteForge. The substrate completes itself there.