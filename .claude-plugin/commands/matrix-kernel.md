---
name: danteforge-matrix-kernel
description: "Closed-loop verified multi-agent engineering control plane — maps a project, decomposes work, simulates safe parallelism, leases isolated agents, verifies output, and merges only what passed every gate"
---

# /danteforge-matrix-kernel — Matrix Kernel Control Plane

When the user invokes `/danteforge-matrix-kernel [args]`, run the Matrix Kernel — DanteForge's verified multi-agent engineering control plane.

## What It Is

The Matrix Kernel is the substrate that lets many AI agents work in parallel on the same project without losing truth, architecture, or control. It implements the constitutional discipline: **agents propose, DanteForge disposes**.

Core loop:
**Observe → Map → Decompose → Simulate → Lease → Execute → Verify → Merge → Rescore → Learn → Repeat**

## What's Shipped (MVP)

**Planning loop (user-runnable):**
```bash
danteforge matrix-kernel init                    # bootstrap .danteforge/matrix/
danteforge matrix-kernel map-project [--cwd P]   # build Project Graph (Phase 2)
danteforge matrix-kernel synthesize-dimensions   # build Dimension Graph (Phase 3)
danteforge matrix-kernel work-packets            # generate Work Packets (Phase 4)
danteforge matrix-kernel simulate --max-agents N # plan + safe parallelism + cost (Phase 7)
danteforge matrix-kernel status                  # show current report inventory
danteforge matrix-kernel leases-list             # list current leases
```

**Execution loop (Phase 13a + 13b — wired to CLI):**
```bash
danteforge matrix-kernel run-wave 1 [--adapter fake|claude|codex|gemini|grok]   # dispatch a planned wave
danteforge matrix-kernel verify <leaseId> [--all]             # Verification Court
danteforge matrix-kernel red-team <leaseId> [--mock]          # adversarial review (live LLM by default)
danteforge matrix-kernel taste-gate <leaseId>                 # detect UX-change requiring approval
danteforge matrix-kernel taste-gate approve <id> [--by N]     # resolve a taste gate
danteforge matrix-kernel taste-gate reject <id> [--notes T]
danteforge matrix-kernel merge-court                          # arbitrate all candidates
danteforge matrix-kernel retrospective                        # generate run retrospective
danteforge matrix-kernel report                               # render final markdown report
```

**Live-LLM testing (opt-in, costs real money):**
```bash
DANTEFORGE_LIVE_LLM=1 npm run test:matrix-live      # validates Red Team + ClaudeCodeAdapter against real Claude
```

## The Constitutional Discipline (PRD §6)

1. Agents propose. DanteForge disposes.
2. No agent may merge.
3. No agent may work without a Work Packet.
4. No agent may edit without a Lease.
5. No Lease may be issued without conflict analysis.
6. No wave may run without safe parallelism calculation.
7. No branch may enter Merge Court without Verification Court.
8. No score may increase without evidence.
9. No protected path may be changed without explicit approval.
10. No duplicate subsystem may be created when an existing subsystem owns the responsibility.

## Six Kernel Graphs

| Graph | Purpose | Schema |
|-------|---------|--------|
| Project Graph | What exists in the repo | `src/matrix/types/project-graph.ts` |
| Dimension Graph | What excellence requires | `src/matrix/types/dimension-graph.ts` |
| Work Graph | What needs to be done | `src/matrix/types/work-graph.ts` |
| Dependency Graph | What depends on what | `src/matrix/types/dependency-graph.ts` |
| Lease Graph | Who owns what during a run | `src/matrix/types/lease.ts` |
| Evidence Graph | What has been proven | `src/matrix/types/evidence.ts` |

## When to Use

- **Discovery** — run `map-project` then `synthesize-dimensions` to see the project as the Matrix Kernel sees it
- **Planning** — run `simulate --max-agents 10` to see how many agents could safely run in parallel + worst-case cost estimate
- **Verification of the substrate itself** — run `tests/matrix-golden-flow.test.ts` to confirm the entire loop works end-to-end with fake agents

## What's NOT Yet Wired (Phase 13)

Real provider adapters (Codex, Claude Code, DanteCode, Ruflo, CrewAI) are deferred to a follow-up pass. The `AgentAdapter` interface in `src/matrix/adapters/adapter-interface.ts` is built and proven with `FakeAgentAdapter` + `GenericShellAdapter`; real-LLM dispatch is integration work, not architectural work.

The execution-loop CLI subcommands (`run-wave`, `verify`, `red-team`, `merge-court`) are deferred until the real adapters land.

## Pointers

- **Code:** `src/matrix/` (types, engines, courts, adapters, util)
- **Tests:** `tests/matrix/*.test.ts` (130+ unit tests) + `tests/matrix-golden-flow.test.ts` (18-assertion MVP proof)
- **Audit (historical):** `docs/MATRIX_KERNEL_REPO_AUDIT.md`
- **PRD reference:** the 32-section Matrix Kernel PRD authored by the founder

## Output

```
[matrix-kernel] Mapping project at C:\Projects\DanteForge...
[matrix-kernel] Mapped: 540 nodes (507 files, 33 modules, 8 protected)
[matrix-kernel] Wrote .danteforge/matrix/matrix.project-graph.json

[matrix-kernel] Synthesized 19 dimensions, 28 competitors
[matrix-kernel] Top gaps:
  community_adoption                  self=1.5  gap=7.5
  agent_activity_provenance           self=8.2  gap=0.8
  ...

[matrix-kernel] Simulation Plan — 2 wave(s)
  Requested agents:    10
  Safe agents now:     1
  Recommended wave:    1
  High-conflict:       1
  Total tokens (est):  18,000
  USD range:           $0.05–$0.27
```
