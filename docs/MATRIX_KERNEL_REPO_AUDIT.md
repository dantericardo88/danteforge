# Matrix Kernel — Phase 0 Repo Audit

> Audit date: 2026-05-11
> Audited against: DanteForge Matrix Kernel PRD (v1, sections 1–32)
> Auditor: Claude Code (autonomous /loop pass)

## TL;DR

**~70% of the Matrix Kernel infrastructure already exists in DanteForge.** The Matrix Kernel build is dominated by **integration work**, not greenfield. Specifically:

- ✅ Decision substrate (Time Machine, DecisionNode, proof engine, evidence chain) — production-grade, reusable as-is
- ✅ Worktree + agent isolation — `src/utils/worktree.ts` already exists
- ✅ Scoring + competitive matrix — `compete-matrix.ts` is the foundation; do NOT fork
- ✅ Matrix Development Engine — `matrix-development-engine.ts` already has claim/propose/merge logic
- ✅ Gates + policy infrastructure — `gates.ts` + `policy-gate.ts` are reusable for Verification/Merge/Taste Courts
- 🟡 Stub `matrix.ts` CLI command exists (3.2KB) — extend, don't replace
- ❌ Six explicit graphs (Project/Dimension/Work/Dependency/Lease/Evidence) — must be built as new schemas wrapping existing primitives
- ❌ Conflict Radar — must be built new
- ❌ Safe Parallelism Calculator + Simulation Mode — must be built new
- ❌ Verification Court, Red Team, Taste Gate, Merge Court — orchestration shells must be new (but consume existing gates)
- ❌ Structured Agent Mailbox — must be built new
- ❌ VS Code Matrix War Room — placeholder only

## Existing Modules — Status Table

### ✅ READY — Reuse As-Is

| Module | Path | Size | Why it matters |
|--------|------|------|----------------|
| Time Machine core | `src/core/time-machine.ts` | 31 KB | Snapshot/replay; PRD §9.6 Evidence Graph anchor |
| Decision Node schema | `src/core/decision-node.ts` | 12 KB | Hash-chained JSONL; PRD-wide audit substrate |
| Decision Node store + recorder | `src/core/decision-node-*.ts` (8 files) | ~50 KB | Append-only, multi-actor; bridge to DanteAgents exists |
| Time Machine provenance | `src/core/time-machine-provenance.ts` | (modified this session) | Line-level + session-graph queries — PRD replay needs |
| Time Machine replay | `src/core/time-machine-replay.ts` | (exists) | Counterfactual branching — PRD §32 "Time Machine can replay the Matrix run" |
| Proof engine + evidence chain | `src/core/proof-engine.ts` + `@danteforge/evidence-chain` (npm) | 26 KB + ext | SHA-256 + Merkle hash chain — PRD §6 #19 audit |
| Worktree manager | `src/utils/worktree.ts` | 6.5 KB | `createAgentWorktree()` — PRD §9.5/§17/§18 |
| Compete matrix | `src/core/compete-matrix.ts` | 33 KB | Dimensions/scoring/sprints — PRD §9.2 Dimension Graph |
| Competitor scanner | `src/core/competitor-scanner.ts` | 43 KB | Frontier discovery — PRD §10 Frontier Intelligence |
| Harsh scorer | `src/core/harsh-scorer.ts` | 43 KB | 20-dim rubric — PRD §11 scoring model |
| Adversarial scorer | `src/core/adversarial-scorer-dim.ts` | (exists) | PRD §20 Red Team Verifier raw material |
| Matrix development engine | `src/core/matrix-development-engine.ts` | 15 KB | Already has claim/propose/merge pattern (predecessor to Lease Graph + Merge Court) |
| Matrix CLI stub | `src/cli/commands/matrix.ts` | 3.2 KB | `matrix status/claim/propose/merge` — extend with all PRD §24 commands |
| Gates infrastructure | `src/core/gates.ts` | 8.6 KB | `requireConstitution/Spec/Plan/Tests` — Verification Court raw material |
| Policy gate | `src/core/policy-gate.ts` | 5.5 KB | Allow/block/requireApproval lists — Taste Gate raw material |
| Agent guard script | `scripts/check-agent-guard.mjs` | 11 KB | Frozen-file + ownership enforcement |
| Agent ownership manifest | `.danteforge/agent-ownership.json` | — | Workstream→file map — PRD §9.5 Lease Graph foundation |
| Agent DAG scheduler | `src/core/agent-dag.ts` | 12.7 KB | Already has DAG topological-sort scheduling — PRD §14 Agent Scheduler core |
| Completion tracker | `src/core/completion-tracker.ts` | 9 KB | Phase-based progress — PRD §22 Merge Court ranking input |
| File-size gate | `scripts/check-file-size.mjs` | (exists) | LOC enforcement (DanteSanitize v2 supplements) |
| DanteSanitize v2 | `src/core/sanitize-*.ts` (10 files) | ~2000 LOC | Just shipped; reuse for Verification Court no-stub scanner |
| CLI registry | `src/cli/index.ts` + `register-*.ts` | — | Lazy-load pattern; Matrix Kernel registers new commands here |

### 🟡 PARTIAL — Exists but needs extension

| Module | Path | What's there | What's missing |
|--------|------|--------------|----------------|
| Reflection engine | `src/core/reflection-engine.ts` (13 KB) | `ReflectionVerdict` types, evidence gates | Wiring into Verification Court output |
| Canvas quality scorer | `src/core/canvas-quality-scorer.ts` | Canvas fidelity scoring | Generalize for non-canvas evidence |
| VS Code extension | `vscode-extension/` | Directory + manifest | Matrix War Room views (PRD §25) entirely missing |

### ❌ MISSING — Matrix Kernel must build

| Component | PRD section | New code size estimate |
|-----------|-------------|------------------------|
| Project Graph builder | §9.1 | ~300 LOC + types |
| Dimension Graph extender | §9.2 (over compete-matrix) | ~150 LOC |
| Work Packet generator | §9.3 | ~400 LOC + tests |
| Dependency Graph builder | §9.4 | ~250 LOC |
| Lease Graph wrapper | §9.5 (over agent-guard) | ~200 LOC |
| Evidence Graph wrapper | §9.6 (over Time Machine + proof) | ~150 LOC |
| Conflict Radar | §16 | ~400 LOC |
| Safe Parallelism Calculator | §12 | ~200 LOC |
| Simulation Mode | §13 | ~250 LOC |
| Structured Agent Mailbox | §15 | ~200 LOC |
| Verification Court | §19 | ~300 LOC (orchestrator only; gates exist) |
| Red Team Verifier | §20 | ~150 LOC + prompt templates |
| Product Taste Gate | §21 | ~100 LOC (over policy-gate) |
| Merge Court | §22 | ~350 LOC |
| Retrospective generator | §23 | ~200 LOC |
| Fake + GenericShell adapters | §18 | ~150 LOC each |
| Codex / Claude / DanteCode / Ruflo adapters | §18 | ~250 LOC each |
| VS Code Matrix War Room | §25 | Multi-week (defer to last phase) |

**Total new code estimate: ~4,000 LOC (excluding VS Code UI), spread across ~20–25 modules, every file under 500 LOC by Matrix Kernel constitution.**

## ⚠️ Critical Reuse Warnings

1. **DO NOT fork `compete-matrix.ts`.** It IS a matrix implementation. The Matrix Kernel's Dimension Graph must extend its dimension taxonomy, not replace it. Use `loadMatrix()`, `updateDimensionScore()`, `computeGapPriority()` as primitives.

2. **DO NOT duplicate DecisionNode or Time Machine.** `decision-node.ts` is the canonical schema across the Dante ecosystem (DanteForge, DanteAgents, DanteCode). Every Matrix Kernel event must `append()` to the existing JSONL store, not create a parallel record.

3. **DO NOT duplicate the proof engine.** `@danteforge/evidence-chain` (external npm package) handles SHA-256 + Merkle. Matrix Kernel's Evidence Graph wraps it, never replaces it.

4. **DO NOT bypass `agent-guard.json` and `agent-ownership.json`.** The PRD's Lease Graph must read from these files; Matrix Kernel writes leases that respect them.

5. **DO NOT create a parallel DAG scheduler.** `agent-dag.ts` already does Kahn's topological sort. The Matrix Kernel's Agent Scheduler must use it as a primitive.

6. **DO NOT re-implement the worktree creation.** `src/utils/worktree.ts:createAgentWorktree()` already exists with proper injection seams. The PRD §17 Worktree Manager is an orchestration layer over it.

## Integration Map — Matrix Kernel modules → Existing primitives

| Matrix Kernel Module | Existing primitive(s) to reuse | New code needed |
|----------------------|-------------------------------|-----------------|
| **Project Graph** | `competitor-scanner.ts` (for OSS), `inspectSourceFileSizes()` | Repo walker, AST symbol extractor, ownership inference |
| **Dimension Graph** | `compete-matrix.ts`, `harsh-scorer.ts`, `adversarial-scorer-dim.ts` | Dimension synthesis from goal; rubric registry |
| **Work Packet** | `decision-node.ts` (append on creation), `compete-matrix.ts` sprint records | Work Packet schema, ownership-aware generator |
| **Dependency Graph** | `agent-dag.ts` (topological sort) | Edge inference from Work Packet paths + ownership |
| **Lease Graph** | `agent-ownership.json`, `agent-guard.json`, `worktree.ts`, `sanitize-locks.ts` (file locks!) | Lease schema, conflict pre-check, lifecycle FSM |
| **Evidence Graph** | `time-machine.ts`, `decision-node.ts`, `@danteforge/evidence-chain` | Graph schema linking Work Packet→Lease→Run→Gate→Merge |
| **Conflict Radar** | Sanitize's file-tracking, agent-guard frozen-paths, AST symbol graph | Conflict detector engine, severity classifier |
| **Safe Parallelism Calculator** | `agent-dag.ts`, Lease Graph, Conflict Radar | Wave optimizer, recommendation engine |
| **Simulation Mode** | Above + dry-run pattern from sanitize-engine | Materialization-free planner |
| **Worktree Manager** | `worktree.ts`, `sanitize-locks.ts` | Lease→worktree binding, snapshot/cleanup orchestrator |
| **Structured Mailbox** | `decision-node.ts` (messages as nodes!) | Message router, ack tracker |
| **Verification Court** | `gates.ts`, `sanitize` no-stub patterns, test runner, `reflection-engine.ts` | Court orchestrator over existing gates |
| **Red Team Verifier** | `adversarial-scorer-dim.ts`, LLM router | Adversarial prompt template, risk-triggered runner |
| **Taste Gate** | `policy-gate.ts` (allow/block/approval), gates.ts | UX/naming/CLI change detector |
| **Merge Court** | `matrix-development-engine.ts` merge logic, gates, post-merge verify | Candidate queue, ranking, rollback |
| **Retrospective** | `completion-tracker.ts`, `decision-node.ts` history | Aggregator + LLM summary |
| **Fake/Shell Adapters** | `worktree.ts`, `decision-node-recorder.ts` | Process spawner + event streamer |
| **Real Provider Adapters** | `decision-node-danteagents-bridge.ts` (DanteAgents); MCP server (Claude); CLI bridge (Codex/DanteCode) | Provider-specific lifecycle |
| **Matrix CLI** | `src/cli/commands/matrix.ts` (existing stub), `register-late-commands.ts` | All 30+ PRD §24 subcommands |
| **VS Code Matrix War Room** | `vscode-extension/` shell | All views from PRD §25 |

## Recommended Build Order (revised from PRD §27)

Given the high reuse opportunity, the PRD's 14-phase order is correct but can be compressed:

**Phase 1 (contracts)** — 1 week
Schemas for all 6 graphs. New file: `src/matrix/types/` (10 type files, each ~50–150 LOC).

**Phase 2 (Project Graph)** — 3 days
Repo walker + AST extractor. Reuse `inspectSourceFileSizes`, sanitize-boundary's `buildSymbolGraph()`.

**Phase 3 (Dimension Graph + Frontier)** — 3 days
Thin wrapper over `compete-matrix` + `competitor-scanner`. Add dimension synthesis prompt.

**Phase 4 (Work Packets + Dependency Graph)** — 1 week
New generator. Use `agent-dag` for topological sort.

**Phase 5 (Ownership Map + Lease Manager)** — 1 week
Wrap `agent-ownership.json` + `agent-guard.json`. Use `sanitize-locks` patterns for file locks.

**Phase 6 (Conflict Radar)** — 1 week
Net new. Largest single new module (~400 LOC across types/detector/classifier).

**Phase 7 (Safe Parallelism + Simulation)** — 4 days
Combines Phases 4+5+6. Materialization-free dry-run.

**Phase 8 (Worktree + Fake Agents)** — 3 days
Wrap `worktree.ts`; build FakeAgentAdapter + GenericShellAdapter.

**Phase 9 (Verification Court)** — 4 days
Orchestrator over existing gates + sanitize scanners.

**Phase 10 (Red Team + Taste Gate)** — 3 days
Adversarial prompt template + UX-change detector.

**Phase 11 (Merge Court)** — 1 week
Largest orchestration module. Reuses `matrix-development-engine` merge logic.

**Phase 12 (Retrospective)** — 2 days
Aggregator over existing telemetry.

**MVP (PRD §28)** = Phases 1–12. Achievable in ~6 weeks with consistent focus.

**Phase 13 (Real Adapters)** = +2 weeks per adapter.

**Phase 14 (VS Code War Room)** = +4 weeks (most work).

## What This Audit Does NOT Recommend

- **No big-bang rewrite.** Every module above must be additive. Existing tests must continue passing.
- **No parallel matrix system.** The existing `compete-matrix` + `matrix-development-engine` IS the matrix system. Matrix Kernel adds the orchestration layer on top.
- **No new evidence/proof system.** Everything goes through DecisionNode + Time Machine + proof-engine.
- **No 50-agent run at MVP.** Per PRD §28, prove the loop with 3 fake agents first.

## Open Questions for Founder

These should be answered before Phase 1 begins:

1. **Constitution enforcement strictness:** PRD §6 says "Agents propose. DanteForge disposes." Should the constitution be enforced via runtime guards (engine refuses) or audit-only (record violations, surface in retrospective)?

2. **VS Code War Room timing:** Build alongside CLI (per PRD §14 phase) or strictly after CLI MVP works (recommended here)?

3. **OSS license posture for clean-room implementations:** PRD §10 mentions "clean-room notes" — what's the proof bar? Manual founder review? Automated license scanner?

4. **Provider adapter priority:** Codex, Claude Code, DanteCode, Ruflo, CrewAI — which 2–3 ship first?

5. **Live LLM usage budget:** Sprint 8's `--max-tokens 200k` default — too aggressive? Too lenient for Matrix Kernel runs that could use 50× more?

## Phase 0 Acceptance (per PRD §27)

- ✅ No duplicate Time Machine proposed
- ✅ No duplicate evidence system proposed
- ✅ No duplicate gate system proposed
- ✅ Existing modules reused where possible (see Integration Map)
- ✅ Clear add/edit file map exists (see Recommended Build Order)
- ✅ Deliverable written to `docs/MATRIX_KERNEL_REPO_AUDIT.md`

Phase 0 complete. Ready to begin Phase 1 (Matrix Kernel Contracts).
