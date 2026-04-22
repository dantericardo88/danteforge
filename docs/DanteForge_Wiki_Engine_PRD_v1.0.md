# DanteForge Wiki Engine — Product Requirements Document

**Version:** 1.0 | **ID:** PRD-DF-WIKI-001
**Date:** April 2026
**Author:** Ricky | **Classification:** Internal / Strategic

---

## 1. Executive Summary

This PRD defines the **Wiki Engine**, a persistent, self-evolving knowledge layer that integrates into the DanteForge Intelligent Autonomous Loop (IAL). Inspired by Andrej Karpathy's LLM Wiki concept and adapted to DanteForge's constitutional governance architecture, the Wiki Engine transforms DanteForge from a session-scoped coding tool into a system with institutional memory that compounds intelligence across every project and every session.

The current DanteForge architecture has a `memory-engine.ts` (keyword search, 200K token budget, LLM-assisted compaction) and a `context-injector.ts` (progressive 3-tier injection). These work within a single project session. The Wiki Engine sits above them as a compiled, cross-linked, continuously-maintained knowledge base that bridges sessions, projects, and even codebases — while respecting the constitutional invariant boundary that makes DanteForge architecturally distinct from every competitor.

**Target outcome:** Within one week of active use, every DanteForge session operates as if a senior engineer has read and internalized the full context of every prior decision, architectural pattern, failure mode, and design constraint across all projects in the workspace.

---

## 2. Problem Statement

### 2.1 Current Pain Points

| Pain Point | Current Behavior | Impact |
|---|---|---|
| **Session amnesia** | `memory-engine.ts` persists entries to `.danteforge/memory.json` but re-synthesizes context from raw entries on every prompt via `context-injector.ts` | High token waste; degraded reasoning quality as project complexity grows |
| **No cross-project knowledge** | Each project has its own `.danteforge/` directory with isolated state, memory, and lessons | Patterns discovered in Project A are invisible when working on Project B |
| **Flat memory, no structure** | Memory entries are categorized (correction/error/decision/insight/command) but not interlinked or hierarchically organized | Cannot answer relational queries like "which architectural decisions affect the PDSE scoring engine?" |
| **PDSE score opacity** | Scores are computed, persisted to `AUTOFORGE_SCORES.md`, and used for routing, but no historical trend analysis or cross-session comparison exists | The suspicious PDSE score jump identified in v0.8.0 review had no automated detection mechanism |
| **Lessons are append-only** | `lessons.md` grows via `/lessons` command but is never synthesized, deduplicated, or structurally organized | Redundant lessons accumulate; critical insights get buried under noise |
| **Constitutional doc drift** | Constitution is checked during PDSE scoring (section checklists) but not cross-referenced against implementation patterns or architectural drift over time | Constitutional violations can accumulate undetected across sessions |

### 2.2 Why RAG Alone Cannot Solve This

Traditional Retrieval-Augmented Generation re-synthesizes context on every query from raw source material. This means:

- Every session pays the full token cost of retrieval
- The LLM reasons over unstructured fragments rather than compiled knowledge
- There is no mechanism for the knowledge base to self-improve
- Contradictions between sources are discovered at query-time rather than resolved proactively

The Wiki Engine inverts this by compiling knowledge once into structured, interlinked Markdown that is continuously improved by a lint/evolution cycle, making every subsequent session faster and more accurate.

---

## 3. Architectural Vision

### 3.1 Three-Tier Knowledge Architecture

The Wiki Engine introduces a three-tier knowledge architecture that sits alongside and above the existing DanteForge artifact system:

| Tier | Location | Ownership | Mutability | Purpose |
|---|---|---|---|---|
| **T1: Constitutional Invariants** | `.danteforge/constitution/` | Human (CEO-authored) | **IMMUTABLE by LLM** | One-Door Doctrine, Evidence Chain Integrity, Fail-Closed Safety, KiloCode discipline, anti-stub enforcement. Never LLM-editable. |
| **T2: Compiled Wiki** | `.danteforge/wiki/` | LLM-maintained, human-auditable | LLM-editable with audit trail | Entity pages, architectural decisions, module relationships, PDSE history, cross-project patterns, dependency maps. The compiled knowledge layer. |
| **T3: Raw Source Material** | `.danteforge/raw/` | Human + system-generated | Append-only | PRDs, code review outputs, retro outputs, harvest tracks, design artifacts, external research, web clips. Immutable source-of-truth. |

### 3.2 Critical Constitutional Boundary

The most important architectural decision in this PRD is the **immutability boundary between Tier 1 and Tier 2**. This is where DanteForge diverges fundamentally from the Karpathy LLM Wiki concept:

- The LLM Wiki concept treats all knowledge as self-evolving. DanteForge treats constitutional invariants as **cryptographically immutable**.
- Tier 1 documents (`CONSTITUTION.md`, One-Door Doctrine, Evidence Chain Integrity, Fail-Closed Safety rules) are SHA-256 hashed and checked at every autoforge cycle. Any modification triggers a `BLOCKED` state.
- Tier 2 (the wiki) is LLM-maintained but every edit is logged to an append-only audit journal (`.danteforge/wiki/.audit-log.jsonl`) with timestamps, diffs, and the triggering event.
- Tier 3 (raw sources) is append-only. Once ingested, raw material is never modified — only reprocessed.

This three-tier architecture means that abliteration attacks, prompt injection, or LLM hallucination **cannot corrupt the governance layer**, even as the knowledge layer self-evolves. This is the structural advantage identified in the CAISI/CSIS safety advocacy work and it must be preserved.

### 3.3 Integration into the IAL Pipeline

The Wiki Engine integrates into the existing Autoforge v2 Intelligent Autonomous Loop at four touchpoints:

| Touchpoint | When | What Happens |
|---|---|---|
| **Context Injection (enhanced)** | Every LLM call via `context-injector.ts` | Before building progressive context tiers, the injector queries the wiki index for entity pages, decision history, and related patterns relevant to the current prompt. Wiki results fill a new **Tier 0** (highest priority) in the progressive context builder. |
| **Post-Execution Ingestion** | After every forge/verify/retro/harvest cycle | Execution artifacts (code review results, test outputs, reflection verdicts, PDSE scores) are written to `raw/` and queued for wiki ingestion. |
| **PDSE Score History** | During `scoreAllArtifacts()` | PDSE scores are logged to a wiki entity page (`wiki/pdse-history.md`) with per-artifact trend data. Score jumps exceeding a configurable delta threshold trigger an automatic anomaly flag. |
| **Wiki Lint Cycle** | Triggered by `/autoforge` at every 5th cycle, or manually via `/wiki-lint` | The self-evolution step: scans the entire wiki for contradictions, stale cross-references, missing entity links, and opportunities to synthesize higher-level patterns. Produces a `LINT_REPORT.md`. |

---

## 4. Detailed Requirements

### 4.1 New Core Module: wiki-engine.ts

A new core module that manages the full wiki lifecycle. This module must be under 500 lines per file (KiloCode discipline) and is expected to decompose into 4–5 files:

| File | Responsibility | Est. LOC |
|---|---|---|
| `wiki-engine.ts` | Public API: `ingest()`, `query()`, `lint()`, `getEntityPage()`, `getHistory()`. Orchestrates all wiki operations. | ~350 |
| `wiki-indexer.ts` | Builds and maintains `wiki/index.md`, the master entity index with cross-links. Manages the bidirectional link graph. | ~400 |
| `wiki-ingestor.ts` | Processes `raw/` files into `wiki/` entity pages. Handles deduplication, conflict resolution, and entity extraction via LLM. | ~450 |
| `wiki-linter.ts` | Self-evolution engine. Scans for contradictions, stale info, missing links, orphaned pages. Produces `LINT_REPORT.md` and applies auto-fixes. | ~400 |
| `wiki-schema.ts` | TypeScript types, validation schemas, and configuration constants for all wiki data structures. | ~200 |

### 4.2 Wiki Entity Page Format

Every wiki page follows a standardized Markdown format with YAML frontmatter for machine-readable metadata:

```yaml
---
entity: "autoforge-loop"
type: module | decision | pattern | tool | concept
created: 2026-04-06T00:00:00Z
updated: 2026-04-06T00:00:00Z
sources:
  - raw/pdse-scores-2026-04.json
  - raw/retro-sprint-12.md
links:
  - pdse-config
  - autoforge
  - completion-tracker
constitution-refs:
  - evidence-chain-integrity
  - fail-closed
tags: [scoring, pipeline, quality-gate]
---

# Autoforge Loop

## Summary
[Compiled summary of this entity]

## Architecture
[How this module fits into the broader system]

## Decisions
[Chronological log of architectural decisions affecting this entity]

## History
[Timestamped entries from source ingestion events]
```

### 4.3 New CLI Commands

| Command | Description | Integration Point |
|---|---|---|
| `/wiki-ingest` | Ingest all new files in `raw/` into compiled wiki pages. Runs entity extraction, deduplication, and cross-linking. | Manual trigger or post-forge hook |
| `/wiki-lint` | Run self-evolution scan on the entire wiki. Fix contradictions, update stale links, synthesize new patterns. | Manual trigger or every 5th autoforge cycle |
| `/wiki-query <topic>` | Search the wiki for entity pages, decisions, and patterns related to a topic. Returns structured results with source provenance. | Interactive use during development |
| `/wiki-status` | Display wiki health metrics: page count, link density, orphan pages, staleness score, last lint timestamp. | Dashboard integration |
| `/wiki-export` | Export the compiled wiki as a standalone site (Obsidian-compatible vault or static HTML). | Knowledge sharing and backup |

### 4.4 Enhanced Context Injection

The existing `context-injector.ts` receives a significant upgrade. The current three-tier progressive context system (Tier 1: corrections/errors, Tier 2: decisions/insights, Tier 3: command summaries) gains a new Tier 0 that sits above all others:

| Tier | Priority | Source | Content |
|---|---|---|---|
| **Tier 0 (NEW)** | Highest | Wiki Engine | Entity pages matching the current task context, relevant architectural decisions, PDSE trend data for the artifact being scored, related constitutional references |
| Tier 1 | High | Memory Engine | Error corrections and critical lessons (unchanged) |
| Tier 2 | Medium | Memory Engine | Recent decisions and insights (unchanged) |
| Tier 3 | Low | Memory Engine | Historical command summaries (unchanged) |

The token budget allocation shifts from the current flat `DEFAULT_MAX_BUDGET` of 4,000 tokens to a dynamic budget: up to 2,000 tokens for Tier 0 wiki content (configurable), with the remaining budget allocated to Tiers 1–3 using the existing progressive fill algorithm.

### 4.5 PDSE Score Anomaly Detection

A new subsystem integrated into the PDSE scoring pipeline that addresses the v0.8.0 suspicious score jump finding:

- Every PDSE score result is appended to `wiki/pdse-history.md` as a structured entry with timestamp, artifact name, dimension scores, overall score, and the autoforge decision.
- After each scoring cycle, the anomaly detector computes the delta between the current score and the trailing 5-cycle moving average for each artifact.
- If any single-cycle delta exceeds a configurable threshold (default: **15 points** on the 0–100 scale), an anomaly flag is raised.
- Anomaly flags are: (a) recorded to the wiki audit log, (b) injected into the next autoforge guidance as a `REVIEW_REQUIRED` blocking issue, and (c) surfaced in `/wiki-status` output.
- The detection uses only simple arithmetic — no LLM call required — keeping it deterministic and zero-cost.

---

## 5. Implementation Plan

The implementation follows a four-phase approach, designed so that each phase delivers standalone value and can be shipped independently.

### 5.1 Phase 1: Foundation (Week 1–2)

**Deliverable:** Core wiki data structures, filesystem layout, and basic ingest/query cycle.

| Task | File(s) | Dependencies | Est. Hours |
|---|---|---|---|
| Define wiki TypeScript types and schemas | `src/core/wiki-schema.ts` | None | 4 |
| Implement wiki filesystem layout (`.danteforge/wiki/`, `raw/`, `constitution/`) | `src/core/wiki-engine.ts` | `wiki-schema.ts` | 6 |
| Build raw-to-wiki ingestor with LLM entity extraction | `src/core/wiki-ingestor.ts` | `wiki-engine.ts`, `llm.ts` | 12 |
| Build wiki indexer with bidirectional link graph | `src/core/wiki-indexer.ts` | `wiki-schema.ts` | 10 |
| Implement `/wiki-ingest` CLI command | `src/cli/commands/wiki-ingest.ts`, `commands/wiki-ingest.md` | `wiki-ingestor.ts` | 4 |
| Implement `/wiki-query` CLI command | `src/cli/commands/wiki-query.ts`, `commands/wiki-query.md` | `wiki-engine.ts` | 4 |
| Write unit tests (target: 90% coverage) | `tests/core/wiki-*.test.ts` | All above | 12 |
| Constitutional hash verification integration | `src/core/wiki-engine.ts` | constitution flow | 6 |

### 5.2 Phase 2: IAL Integration (Week 3–4)

**Deliverable:** Wiki plugged into the autoforge loop and context injection pipeline.

| Task | File(s) | Dependencies | Est. Hours |
|---|---|---|---|
| Add Tier 0 wiki context to `context-injector.ts` | `src/core/context-injector.ts` | `wiki-engine.ts` | 8 |
| Add post-execution wiki ingestion hooks to `autoforge-loop.ts` | `src/core/autoforge-loop.ts` | `wiki-ingestor.ts` | 6 |
| Implement PDSE score history tracking in wiki | `src/core/pdse.ts`, `wiki-engine.ts` | `wiki-schema.ts` | 6 |
| Build PDSE anomaly detector | `src/core/pdse-anomaly.ts` | `pdse.ts`, `wiki-engine.ts` | 8 |
| Wire anomaly flags into `AutoforgeGuidance` | `src/core/autoforge-loop.ts` | `pdse-anomaly.ts` | 4 |
| Implement `/wiki-status` command | `src/cli/commands/wiki-status.ts` | `wiki-engine.ts`, `wiki-indexer.ts` | 4 |
| Integration tests with mock autoforge cycles | `tests/core/wiki-integration.test.ts` | All above | 10 |

### 5.3 Phase 3: Self-Evolution (Week 5–6)

**Deliverable:** Wiki lint cycle, self-healing, and automatic cross-link maintenance.

| Task | File(s) | Dependencies | Est. Hours |
|---|---|---|---|
| Build wiki linter: contradiction detection | `src/core/wiki-linter.ts` | `wiki-engine.ts`, `llm.ts` | 10 |
| Build wiki linter: stale reference detection | `src/core/wiki-linter.ts` | `wiki-indexer.ts` | 6 |
| Build wiki linter: missing link discovery | `src/core/wiki-linter.ts` | `wiki-indexer.ts` | 6 |
| Build wiki linter: pattern synthesis (LLM-assisted) | `src/core/wiki-linter.ts` | `llm.ts` | 8 |
| Wire lint cycle into autoforge (every 5th cycle) | `src/core/autoforge-loop.ts` | `wiki-linter.ts` | 4 |
| Implement `/wiki-lint` CLI command | `src/cli/commands/wiki-lint.ts` | `wiki-linter.ts` | 4 |
| Implement lint audit trail (`.audit-log.jsonl`) | `src/core/wiki-linter.ts` | `wiki-schema.ts` | 4 |
| Tests for lint cycle edge cases | `tests/core/wiki-linter.test.ts` | All above | 10 |

### 5.4 Phase 4: Cross-Project + Export (Week 7–8)

**Deliverable:** Global wiki layer spanning multiple projects, Obsidian export, and dashboard integration.

| Task | File(s) | Dependencies | Est. Hours |
|---|---|---|---|
| Implement global wiki at `~/.danteforge/wiki/` for cross-project knowledge | `src/core/wiki-engine.ts` | Phase 1–3 complete | 10 |
| Build merge strategy: local wiki + global wiki deduplication | `src/core/wiki-engine.ts` | `wiki-indexer.ts` | 8 |
| Implement `/wiki-export` (Obsidian vault format) | `src/cli/commands/wiki-export.ts` | `wiki-engine.ts` | 6 |
| Add wiki metrics to `/dashboard` command | `src/cli/commands/dashboard.ts` | `wiki-engine.ts` | 4 |
| Cross-project pattern promotion (local → global) | `src/core/wiki-engine.ts` | `wiki-linter.ts` | 8 |
| End-to-end integration tests | `tests/e2e/wiki-e2e.test.ts` | All phases | 12 |
| Documentation: `WIKI_ENGINE.md` user guide | `docs/WIKI_ENGINE.md` | All phases | 6 |

---

## 6. Data Flow Specification

### 6.1 Ingest Pipeline

The ingest pipeline converts raw source material into compiled wiki knowledge through a deterministic, auditable process:

1. Raw material lands in `.danteforge/raw/` (manual drop, post-forge hook, or post-retro hook).
2. `wiki-ingestor.ts` detects new/modified files in `raw/` by comparing against a manifest (`.danteforge/raw/.manifest.json`).
3. For each new file, the ingestor calls the LLM with a structured extraction prompt that identifies entities, decisions, relationships, and tags.
4. Extracted entities are matched against existing wiki pages using fuzzy string matching (Levenshtein distance, threshold configurable).
5. New entities create new wiki pages; matched entities update existing pages with a new History entry and updated cross-links.
6. `wiki-indexer.ts` rebuilds the master index (`wiki/index.md`) with all entity cross-references.
7. The ingest event is logged to `.danteforge/wiki/.audit-log.jsonl`.

### 6.2 Query Pipeline

Queries flow through a two-stage retrieval process:

1. **Stage 1 (fast, zero-LLM):** Search the wiki index for entity pages matching the query keywords. Return frontmatter-scored results ranked by relevance (keyword match + recency + link density).
2. **Stage 2 (optional, LLM-assisted):** If Stage 1 returns fewer than 3 results and the query appears complex, invoke the LLM to identify implicit entity relationships that keyword matching would miss.

This two-stage approach ensures that the common case (well-indexed queries) is fast and free, while edge cases still get high-quality results.

### 6.3 Lint/Evolution Cycle

The self-evolution cycle runs in four passes:

1. **Contradiction scan:** For each entity page with multiple source entries, check if any claims conflict. Flag for human review or auto-resolve if one source is strictly newer.
2. **Staleness scan:** Flag any wiki page whose most recent source update is older than 30 days (configurable) and whose entity is referenced by active project artifacts.
3. **Link integrity:** Verify all `[[wikilinks]]` resolve to existing pages. Create stub pages for orphaned links. Flag pages with zero inbound links for potential removal.
4. **Pattern synthesis:** Aggregate decision history entries across the wiki and prompt the LLM to identify recurring patterns worth promoting to dedicated pattern entity pages.

---

## 7. Constitutional Compliance Matrix

Every feature in this PRD has been validated against DanteForge's constitutional invariants:

| Constitutional Invariant | How Wiki Engine Complies |
|---|---|
| **One-Door Doctrine** | All wiki modifications flow through a single write path in `wiki-engine.ts`. No alternative mutation paths exist. The audit log captures every change. |
| **Evidence Chain Integrity** | Every wiki entity page maintains a `sources[]` array linking back to `raw/` files. No wiki claim exists without provenance. The `audit-log.jsonl` is append-only. |
| **Fail-Closed Safety** | If the wiki engine encounters a corrupted index, missing manifest, or hash mismatch on a constitutional document, it fails to `BLOCKED` state rather than proceeding with degraded knowledge. |
| **KiloCode Discipline** | All wiki module files are designed to stay under 500 lines. The 5-file decomposition ensures each file has a single clear responsibility. |
| **Anti-Stub Enforcement** | Wiki pages generated by the ingestor must pass the existing `ANTI_STUB_PATTERNS` check from `drift-detector.ts`. No TODO/FIXME/placeholder content in compiled wiki output. |
| **Verify Before Commit** | Wiki changes are validated (schema check, link integrity, constitutional hash verification) before being written to disk. Invalid updates are rejected. |

---

## 8. Scoring Dimensions and Success Metrics

### 8.1 PDSE Integration

The Wiki Engine adds a new optional scoring dimension to the existing PDSE `ScoreDimensions` interface:

| Dimension | Weight | What It Measures |
|---|---|---|
| **wikiCoverage (NEW)** | 0–10 | Percentage of entities referenced in current project artifacts that have corresponding wiki pages. 0 = no wiki, 10 = full coverage. |
| completeness | 0–20 | Unchanged from current implementation |
| clarity | 0–20 | Unchanged |
| testability | 0–20 | Unchanged |
| constitutionAlignment | 0–20 | Unchanged, but now also checks Tier 1 constitutional hash integrity |
| integrationFitness | 0–10 | Unchanged |
| freshness | 0–10 | Unchanged |

### 8.2 Wiki Health Dashboard Metrics

| Metric | Target | Measurement |
|---|---|---|
| Entity page count | >50 after 1 week of active use | Count of `.md` files in `wiki/` |
| Link density | >3.0 avg links per page | Total links / page count |
| Orphan page ratio | <5% | Pages with zero inbound links / total pages |
| Staleness score | <10% pages stale | Pages with no source update in 30+ days / total |
| Lint pass rate | >95% clean | Pages with zero lint issues / total pages |
| Anomaly detection rate | 100% of >15pt jumps flagged | Flagged anomalies / actual anomalies (tested via synthetic injection) |
| Context injection hit rate | >80% of prompts receive Tier 0 content | Prompts with wiki context injected / total prompts |
| Token savings | >30% reduction in re-synthesis tokens | Baseline token usage vs. wiki-enhanced token usage |

---

## 9. Risk Analysis

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Wiki diverges from actual codebase state | HIGH | Medium | Lint cycle staleness detection; post-forge ingestion hooks ensure wiki stays current; PDSE freshness scoring penalizes stale wiki references |
| LLM entity extraction produces low-quality pages | MEDIUM | Medium | Anti-stub enforcement on all wiki output; reflection engine evaluates extraction quality; human review flag for low-confidence extractions |
| Wiki grows too large for efficient querying | LOW | Low | Index-first query design means search scales with index size, not wiki size; compaction already proven in memory-engine at 200K token budget |
| Constitutional hash collision or false positive | HIGH | Very Low | SHA-256 collision is computationally infeasible; false positives only occur if file is actually modified, which is the correct behavior |
| Cross-project wiki merge conflicts | MEDIUM | Medium | Phase 4 merge strategy uses entity-level last-write-wins with conflict detection and human review queue for ambiguous cases |
| Token cost of lint/evolution cycle | MEDIUM | Medium | Lint cycle is batched (every 5th autoforge cycle); budget-capped at configurable max tokens per lint run; heuristic-only mode available for zero-LLM linting |

---

## 10. Compatibility and Migration

### 10.1 Backward Compatibility

The Wiki Engine is **fully additive**. No existing DanteForge behavior changes unless the wiki is initialized:

- All existing commands (`/autoforge`, `/magic`, `/forge`, `/party`, etc.) continue to work identically if no `.danteforge/wiki/` directory exists.
- `context-injector.ts` Tier 0 returns empty results if the wiki is not initialized, falling through to the existing Tier 1–3 behavior.
- PDSE scoring omits the `wikiCoverage` dimension if the wiki is not present, maintaining the current 0–100 scale.
- The existing `memory-engine.ts` and `memory-store.ts` are **not modified**. The wiki operates alongside them as a higher-level compiled layer.

### 10.2 Migration Path for Existing Projects

For projects that already have `.danteforge/` state and memory:

1. Run `/wiki-ingest --bootstrap` to seed the wiki from existing artifacts: `CONSTITUTION.md`, `SPEC.md`, `PLAN.md`, `TASKS.md`, `lessons.md`, `memory.json`, and any `harvest/` tracks.
2. The bootstrap process reads existing memory entries and promotes high-value ones (corrections, decisions with detail) to wiki entity pages.
3. Constitutional documents are copied to `.danteforge/constitution/` and hashed. Original `.danteforge/CONSTITUTION.md` continues to be the authoritative source for PDSE scoring.
4. No existing files are modified or moved during bootstrap.

---

## 11. Testing Strategy

| Test Category | Coverage Target | Approach |
|---|---|---|
| Unit tests (`wiki-schema`, `wiki-indexer`, `wiki-linter`, `wiki-engine`) | 90%+ | Jest with injection seams matching existing DanteForge test patterns. Mock LLM calls. Test all edge cases: empty wiki, corrupted manifest, hash mismatches. |
| Integration tests (context injection, autoforge hooks) | 85%+ | End-to-end autoforge cycle with wiki enabled. Verify Tier 0 context appears in prompts. Verify PDSE anomaly detection fires on synthetic score spikes. |
| Constitutional boundary tests | **100%** | Attempt to modify Tier 1 documents via wiki-engine API. Verify `BLOCKED` state. Attempt to bypass audit log. Verify hash verification catches tampering. |
| Performance tests | Regression baseline | Measure context injection latency with wiki (10, 100, 1000 page wikis). Verify <50ms overhead for index query. Verify lint cycle completes in <60s for 500-page wiki. |

---

## 12. Future Extensions (Post-v1.0)

- **Council of Minds integration:** Wiki pages annotated with which model (Claude, Grok, ChatGPT, Gemini) contributed which knowledge. Model disagreement tracked as a wiki-level signal, not just a session-level one.
- **Obsidian live sync:** Bi-directional sync between `.danteforge/wiki/` and an Obsidian vault for visual graph exploration, manual editing, and mobile access.
- **MCP server exposure:** Expose the wiki query API as an MCP server tool, allowing other AI tools in the ecosystem to query DanteForge's institutional knowledge.
- **Cross-repository wiki federation:** For multi-repo projects (e.g., Real Empanada frontend + backend + marketing), a federated wiki layer that spans repositories.
- **SquashIT persona knowledge:** Wiki entity pages for GhettoMod AI personas and debate patterns, enabling SquashIT's Personality Engine to draw from DanteForge-compiled knowledge.
- **Automated competitive intelligence:** `/oss` and `/harvest` outputs auto-ingested into wiki competitor entity pages, feeding the Acuña-method competitive analysis.

---

## 13. Acceptance Criteria

The Wiki Engine PRD is considered complete when **all** of the following criteria are met:

1. A new DanteForge project can run `/wiki-ingest --bootstrap` and produce a wiki with entity pages for all existing artifacts in under 60 seconds.
2. The autoforge loop, when run with `--auto`, automatically ingests execution artifacts and maintains the wiki without human intervention.
3. Context injection measurably improves code generation quality (measured by fewer PDSE score regressions per session compared to baseline).
4. PDSE score anomalies of 15+ points are detected with 100% recall and surfaced in autoforge guidance within the same cycle.
5. Constitutional documents in Tier 1 cannot be modified by any wiki operation, verified by tamper-injection tests.
6. The wiki lint cycle, when run on a 200-page wiki, completes in under 90 seconds and produces a valid `LINT_REPORT.md`.
7. Cross-project patterns discovered in one project's wiki are available to other projects via the global wiki layer.
8. All new code passes existing test suite without regression, plus new wiki-specific tests achieve 90%+ coverage.
9. All module files comply with KiloCode discipline (under 500 lines per file).
10. The full implementation adds zero breaking changes to any existing DanteForge command or workflow.

---

## Appendix A: Codebase Reference — Existing Files Affected

These are the existing DanteForge source files that this PRD touches. No existing files are deleted or rewritten — all changes are additive modifications:

| File | Modification |
|---|---|
| `src/core/context-injector.ts` | Add Tier 0 wiki query before existing tier construction. Add wiki-engine import. Modify `injectContext()` to accept optional wiki budget parameter. |
| `src/core/autoforge-loop.ts` | Add post-execution wiki ingestion hook after forge/verify/retro steps. Wire PDSE anomaly flags into `AutoforgeGuidance`. Trigger wiki lint on every 5th cycle via `shouldTriggerMetaEvolution()` pattern. |
| `src/core/pdse.ts` | After `scoreAllArtifacts()`, append results to wiki PDSE history. Import and call anomaly detector. |
| `src/core/pdse-config.ts` | Add optional `wikiCoverage` to `ScoreDimensions` interface. |
| `src/core/completion-tracker.ts` | Include wiki health in completion percentage calculation (optional, gated on wiki existence). |
| `src/cli/commands/dashboard.ts` | Add wiki health metrics section to dashboard output. |
| `src/cli/commands/index.ts` | Register new wiki-* commands in the command index. |

## Appendix B: New Files Created

| File | Purpose |
|---|---|
| `src/core/wiki-schema.ts` | TypeScript types, interfaces, and constants for all wiki data structures |
| `src/core/wiki-engine.ts` | Public API: `ingest()`, `query()`, `lint()`, `getEntityPage()`, `getHistory()` |
| `src/core/wiki-indexer.ts` | Bidirectional link graph builder and master index maintainer |
| `src/core/wiki-ingestor.ts` | Raw-to-wiki entity extraction, deduplication, and page generation |
| `src/core/wiki-linter.ts` | Self-evolution engine: contradictions, staleness, link integrity, pattern synthesis |
| `src/core/pdse-anomaly.ts` | PDSE score anomaly detection with moving-average delta analysis |
| `src/cli/commands/wiki-ingest.ts` | CLI command for `/wiki-ingest` |
| `src/cli/commands/wiki-lint.ts` | CLI command for `/wiki-lint` |
| `src/cli/commands/wiki-query.ts` | CLI command for `/wiki-query` |
| `src/cli/commands/wiki-status.ts` | CLI command for `/wiki-status` |
| `src/cli/commands/wiki-export.ts` | CLI command for `/wiki-export` |
| `commands/wiki-ingest.md` | Command markdown for `/wiki-ingest` |
| `commands/wiki-lint.md` | Command markdown for `/wiki-lint` |
| `commands/wiki-query.md` | Command markdown for `/wiki-query` |
| `commands/wiki-status.md` | Command markdown for `/wiki-status` |
| `commands/wiki-export.md` | Command markdown for `/wiki-export` |
| `tests/core/wiki-schema.test.ts` | Unit tests for wiki schema validation |
| `tests/core/wiki-engine.test.ts` | Unit tests for wiki engine public API |
| `tests/core/wiki-indexer.test.ts` | Unit tests for wiki indexer and link graph |
| `tests/core/wiki-ingestor.test.ts` | Unit tests for wiki ingestor with mock LLM |
| `tests/core/wiki-linter.test.ts` | Unit tests for wiki linter all four passes |
| `tests/core/pdse-anomaly.test.ts` | Unit tests for PDSE anomaly detector |
| `tests/core/wiki-integration.test.ts` | Integration tests for autoforge + wiki pipeline |
| `tests/e2e/wiki-e2e.test.ts` | End-to-end tests for full wiki lifecycle |
| `docs/WIKI_ENGINE.md` | User-facing documentation |

---

*END OF DOCUMENT*
