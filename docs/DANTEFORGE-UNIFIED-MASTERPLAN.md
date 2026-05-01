# DanteForge — The Unified Masterplan
**The Forge. The Time Machine. The Parallel Universes.**

*Written 2026-05-01. This document supersedes all prior vision docs and sprint memos.*
*Canonical reference for every agent, contributor, and product decision in the Dante ecosystem.*

---

## The Vision in One Sentence

**DanteForge is the forge that turns OSS ore into your sword — and the Time Machine lets you smelt three different blades from the same ore and pick the sharpest edge.**

---

## The Forge Metaphor — Why It's Load-Bearing

A blacksmith doesn't create iron. They source the best ore, understand its properties, and forge it into something that didn't exist before. The forge is the transformation — the skill, the heat, the judgment.

DanteForge is the same thing for software:

- **OSS is the ore.** The open-source ecosystem contains thousands of years of accumulated pattern wisdom. We don't reinvent — we smelt. We harvest the best ideas from the best tools and forge them into something more powerful than any of them alone.
- **The convergence loop is the forge.** `magic`, `autoforge`, `forge`, `verify` — these are the heat and the hammer. Structured specs, execution waves, hard gates, multi-agent convergence.
- **The effort levels are the temperature.** `spark` is a quick heat. `inferno` is white-hot. The right temperature for the right material.
- **Your product is the sword.** Purpose-built, sharp, yours.
- **The Time Machine is the memory of every strike.** Every decision recorded, every branch preserved, every alternate blade possible.
- **Ascend is the parallel forge.** Smelt three blades simultaneously from the same ore. Pick the sharpest. Combine the best edges from all three into the optimal fourth.

Everything in DanteForge serves this metaphor or it doesn't belong.

---

## The Four Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 4: THE PARALLEL UNIVERSES — Ascend Synthesis Engine           │
│  Branch 1 decision into N alternatives. Run all to completion.       │
│  Diff outcomes. Synthesize the optimal blade.                        │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 3: THE TIME MACHINE — Decision Memory                         │
│  Every decision = a node. Every node = branchable. Every branch      │
│  = a new timeline. Causal attribution answers "did it matter?"       │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 2: THE FORGE — Convergence Engine                             │
│  spark → ember → blaze → nova → inferno                              │
│  OSS ore becomes working product through structured convergence.     │
├─────────────────────────────────────────────────────────────────────┤
│  LAYER 1: THE ORE — OSS Harvesting Pipeline                          │
│  Source the best patterns from the open-source ecosystem.            │
│  Understand them. Forge them into something better.                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — The Ore: OSS Harvesting

OSS harvesting is not optional. It is the premise of the forge metaphor. A forge without ore is just heat.

The harvesting pipeline finds the best open-source tools, extracts their structural patterns, and feeds them into the convergence engine as raw material.

**Commands in this layer:**
- `danteforge oss` — scan and score OSS candidates
- `danteforge oss-intel` — deep intelligence on a specific repo
- `danteforge harvest` — harvest patterns from a target
- `danteforge harvest-forge` — harvest + immediately forge into the project
- `danteforge harvest-pattern` — extract a named pattern for reuse
- `danteforge local-harvest` — harvest from a local repo
- `danteforge import-patterns` — bring harvested patterns into the workspace
- `danteforge awesome-scan` — scan awesome-lists for harvest candidates
- `danteforge lessons` — what we learned from past harvests (pattern memory)

**Design rule:** Every harvest produces a receipt. Receipts are hash-chained via the evidence chain. You always know where your ore came from and whether it changed.

---

## Layer 2 — The Forge: Convergence Engine

The forge transforms ore and intent into working product. It has five temperatures and a structured workflow backbone.

### The Five Temperatures

| Level | Command | When to Use |
|-------|---------|-------------|
| `spark` | `danteforge spark` | Quick fix, single file, under 5 minutes |
| `ember` | `danteforge ember` | Small feature, 1–3 files, under 30 minutes |
| `blaze` | `danteforge blaze` | Full feature, multi-file, 1–3 hours |
| `nova` | `danteforge nova` | Major refactor or new subsystem, half-day |
| `inferno` | `danteforge inferno` | Full attack on a new dimension, all-day parallel |

These are not arbitrary names. They are a shared vocabulary. "Run it at nova" is a complete instruction.

### The Workflow Backbone

```
specify → clarify → tech-decide → plan → tasks → forge → verify → synthesize
```

Every command in this chain has a role. None are skippable without `--light`. This is the discipline that separates a forge from a script runner.

**Commands in this layer:**
- `specify`, `clarify`, `tech-decide`, `plan`, `tasks` — structured pre-work
- `magic` — the intelligent convergence loop (calls the right temperature internally)
- `forge` — direct forge execution
- `autoforge` — autonomous multi-step forging with decision recording
- `verify` — quality gate with hard pass/fail
- `score`, `assess` — quality signal (feeds into Layer 4 synthesis)
- `synthesize` — crystallize what the forge produced into lessons
- `retro` — what the forge learned

**Design rule:** Every forge run at `blaze` or above records DecisionNodes. Every `verify` pass records a quality signal. These feed Layer 3 and Layer 4.

---

## Layer 3 — The Time Machine: Decision Memory

Every significant decision in a DanteForge workflow is a node. Nodes are chained. Chains are sessions. Sessions can be branched into alternate timelines.

This is not a backup system. It is a **causal reasoning engine.**

### The Core Primitive

```typescript
interface DecisionNode {
  id: string;           // permanent UUID
  parentId: string | null;
  sessionId: string;
  timelineId: string;   // 'main' or a branch UUID
  timestamp: string;

  actor: {
    type: 'human' | 'agent' | 'model-training';
    product: 'danteforge' | 'danteagents' | 'dantecode' | 'danteharvest' | 'dantedojo';
  };

  input: { prompt: string; context: Record<string, unknown>; alternatives?: string[] };
  output: { result: unknown; fileStateRef?: string; success: boolean; costUsd: number; qualityScore?: number };

  hash: string;         // SHA-256 hash chain
  causal?: {
    dependentOn: string[];
    classification?: 'independent' | 'dependent-adaptable' | 'dependent-incompatible';
    counterfactualOf?: string;
  };
}
```

`fileStateRef` is the bridge. It links every decision to the exact git commit SHA of the files at that moment. That is what makes replay possible — you can restore to any node's state byte-identically.

### The Three Operations

**Record** — `magic`, `autoforge`, and `verify` record nodes automatically. No integration code needed.

**Replay** — Pick any past node. Give it a different input. The engine restores files to that exact state, runs the forge from there, records a new timeline, and diffs the two.

```bash
danteforge time-machine replay <nodeId> --input "Use RS256 instead of HS256" --dry-run
```

**Attribute** — For any two timelines diverging from a shared branch point, answer: which downstream decisions were *caused* by the branch, and which would have happened anyway?

```bash
danteforge time-machine node attribute <nodeId> --original <timelineId> --alternate <timelineId>
```

### Causal Classification

- **Independent** — same decision in both timelines. The branch didn't affect it. It didn't matter.
- **Dependent-adaptable** — different decision, same direction. The branch influenced it but both converged.
- **Dependent-incompatible** — completely different decision. The branch caused it. This is load-bearing.

**Commands in this layer:**
- `danteforge time-machine validate` — verify substrate integrity
- `danteforge time-machine replay <nodeId>` — branch and replay
- `danteforge time-machine node list` — view decision history
- `danteforge time-machine node trace <nodeId>` — trace ancestry
- `danteforge time-machine node attribute` — causal classification
- `danteforge time-machine node timeline` — ASCII side-by-side diff of two branches

---

## Layer 4 — The Parallel Universes: Ascend Synthesis

This is the most powerful layer. It is the reason the other three exist.

### The Vision

Take one key decision. Generate N alternative inputs for that decision (e.g., three different architectural choices). Run the full DanteForge convergence loop on each — same everything else, only that one fork is different. Let all N timelines run to completion. You now have N finished products.

Diff all N. The causal attribution engine identifies which decisions in the highest-quality timeline were unique to it — the divergent decisions that drove quality differences. Those are the sharpest edges. Synthesize them into a new timeline that none of the N originals alone would have produced.

```
          ┌─── Timeline A: "Use microservices" ──→ Product A (score: 7.2)
          │
Branch ───┼─── Timeline B: "Use monolith first" ──→ Product B (score: 8.8)
          │
          └─── Timeline C: "Use serverless" ──→ Product C (score: 6.5)
                                                         │
                                     Causal Attribution: │
                                     B's error handling ─┤
                                     A's service contracts─┤
                                     C's deployment config─┤
                                                           ↓
                                              Synthesis → Product D (score: 9.4)
```

Product D is the blade that none of the three forges alone would have produced. It is the synthesis of the three best edges.

### How It Works

1. **Identify the branch point** — a DecisionNode representing a key architectural or approach decision
2. **Generate N alternatives** — either human-provided or LLM-generated variants of the branch input
3. **Spin up N isolated workspaces** — git worktrees, one per alternative
4. **Run the full forge loop on each** — same stopping criteria as `magic`, all nodes recorded to separate timelines
5. **Score all N outcomes** — quality scores, causal attribution, convergence detection
6. **Produce the diff report** — which decisions were timeline-unique vs. convergent across all N
7. **Synthesize** — identify the highest-impact divergent decisions from the highest-quality timeline; optionally produce a synthesis timeline

### The Synthesis Step (The Hard Part)

The synthesis step answers: "Which decisions in Timeline B made it better than A and C?"

This requires:
- Cross-timeline causal attribution (which nodes were divergent)
- Quality-delta attribution (which of those divergent nodes correlate with quality improvement)
- Conflict resolution (what if A's best decision and B's best decision are incompatible)

The synthesis timeline is not guaranteed to be producible automatically — it may require human judgment at conflict points. But the system surfaces exactly where those conflicts are.

### The `ascend` Command (Reimagined)

`ascend` is the command surface for the parallel universe engine. Its current form (drive a single project to 9.0 across competitive dimensions) becomes the fallback mode when no branch point is specified. When a branch point is given, it becomes the parallel universe explorer.

```bash
# Current mode (unchanged): autonomous quality loop
danteforge ascend --target 9.0

# New mode: parallel universe synthesis
danteforge ascend --branch <nodeId> --alternatives 3 --synthesize
danteforge ascend --branch <nodeId> --input "monolith first" --input "microservices" --input "serverless"
```

---

## The Pruning List

These commands exist in the current codebase. They do not serve any of the four layers. They will be removed or archived.

| Command | Why It Existed | Why It Goes |
|---------|---------------|-------------|
| `wiki-ingest`, `wiki-export`, `wiki-lint`, `wiki-query` | Wikipedia competitive intel | Absorbed into `oss-intel`. Not part of the forge loop. |
| `ceo-review-engine` | Executive summary generation | Not a forge primitive. Business tool, not development tool. |
| `canvas-admin-seed`, `canvas-defaults` | UI canvas setup | Admin scaffolding that predates the forge metaphor. |
| `setup-figma`, `ux-refine` | Design tool integration | DanteForge is not a design tool. The forge metaphor does not include Figma. |
| `showcase`, `teach` | Demo/education | Content belongs in README and docs, not as CLI commands. |
| `dossier` | Competitive dossier builder | Absorbed into `oss` + `landscape-cmd`. |
| `ceo-review-engine` | Review layer | No forge role. |

**Rule for future additions:** Before adding a command, name which layer it belongs to and what its role in the ore-to-sword pipeline is. If you can't answer in one sentence, don't add it.

---

## The Ecosystem: Every Product Emits Nodes

The four-layer architecture applies to every Dante product. Each product is a forge that uses different ore and produces different swords — but every decision flows into the same decision graph.

```
DanteHarvest ──→ harvest decisions ─────┐
DanteCode    ──→ code gen decisions ────┤
DanteDojo    ──→ training decisions ────┼──→ DecisionNode JSONL ──→ Time Machine ──→ Ascend
DanteAgents  ──→ agent action decisions─┤
DanteForge   ──→ forge run decisions ───┘
```

A developer in 2027 can ask:

> *"Show me the OSS harvest decision that led to our authentication architecture, replay what would have happened if we hadn't harvested that pattern, and tell me whether the vulnerability we shipped would still exist."*

That answer crosses Layer 1 (harvest), Layer 2 (forge), Layer 3 (replay), and Layer 4 (causal attribution). The question is answerable because every decision in the pipeline was recorded.

---

## The North Star Question

Every feature decision, every command addition, every architectural choice should be tested against this question:

> **Does this make the forge sharper, the ore richer, the memory longer, or the parallel universes more navigable?**

If yes: it belongs. If no: it's a weed.

---

## Build Roadmap

### Phase 0–4: COMPLETE
All Time Machine infrastructure is built and tested. DecisionNode schema, counterfactual replay, causal attribution, ecosystem instrumentation, timeline UI. See `docs/DANTE-VISION-MASTERPLAN.md` for the full status of each phase.

### Phase 5: Evidence (In Progress)
- Full DELEGATE-52 live run: `npm run delegate52:live-full` with $160 cap
- 30+ replayed sessions and 100+ labeled nodes for attribution precision/recall
- Paper tables updated with real numbers

### Phase 6: Pruning
- Archive wiki-ingest/export/lint/query
- Archive ceo-review-engine, canvas-admin-seed, setup-figma, ux-refine, showcase, teach
- Simplify `compete` to its adversarial-scoring core, remove the matrix machinery nobody uses
- Audit every remaining command against the four-layer rule

### Phase 7: Ascend Parallel Universe Engine
- `ascend --branch <nodeId> --alternatives N` — spin up N isolated workspaces
- Run full magic convergence loop in each worktree
- Cross-timeline diff + causal attribution report
- Synthesis recommendation (which divergent decisions from the winning timeline drove quality)
- Optional: synthesis timeline construction with conflict-point surfacing

### Phase 8: The Loop
When Phase 7 is complete, the four layers form a closed loop:
- OSS harvest produces ore
- Forge transforms ore into product
- Time Machine records every decision of the forge
- Ascend runs three parallel forks of the forge and synthesizes the best blade
- The lessons from synthesis feed back into the OSS harvest as new pattern intelligence

That loop is the product.

---

## Appendix: Current Infrastructure Status

| Layer | Component | Status |
|-------|-----------|--------|
| Layer 1 | OSS harvest pipeline | ✅ BUILT |
| Layer 1 | Harvest receipts + evidence chain | ✅ BUILT |
| Layer 2 | spark/ember/blaze/nova/inferno presets | ✅ BUILT |
| Layer 2 | magic/autoforge/forge/verify loop | ✅ BUILT |
| Layer 2 | Decision recording in autoforge | ✅ BUILT |
| Layer 3 | DecisionNode schema + JSONL store | ✅ BUILT |
| Layer 3 | Counterfactual replay engine | ✅ BUILT |
| Layer 3 | Causal attribution (heuristic) | ✅ BUILT |
| Layer 3 | Timeline ASCII UI | ✅ BUILT |
| Layer 3 | Ecosystem adapters (DA/DC/Harvest/Dojo) | ✅ BUILT |
| Layer 3 | Attribution precision/recall (real corpus) | ⏳ PENDING — Phase 5 |
| Layer 4 | Ascend (single-dimension loop) | ✅ BUILT (current form) |
| Layer 4 | Ascend parallel universe mode | 🔲 NOT YET — Phase 7 |
| Layer 4 | Cross-timeline synthesis | 🔲 NOT YET — Phase 7 |
| Pruning | Archive dead commands | 🔲 NOT YET — Phase 6 |

---

*This document is the canonical vision for DanteForge. All prior vision docs, sprint memos, and masterplans are superseded by this one. Every agent, contributor, and product decision should reference this document first.*

*Last updated: 2026-05-01*
