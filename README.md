# DanteForge

[![npm version](https://img.shields.io/badge/npm-0.17.0-blue)](https://www.npmjs.com/package/danteforge)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)

> **The forge that turns OSS ore into your sword — and the Time Machine that lets you smelt three different blades and pick the sharpest edge.**

---

## What Is DanteForge?

DanteForge is an AI development CLI built around one central metaphor: **the forge.**

A blacksmith doesn't create iron. They source the best ore, understand its properties, and forge it into something that didn't exist before. DanteForge does the same thing for software:

- **OSS is the ore.** The open-source ecosystem contains decades of accumulated pattern wisdom. DanteForge harvests the best ideas from the best tools and forges them into something more powerful than any of them alone.
- **The convergence loop is the forge.** Structured specs, execution waves, hard quality gates, multi-agent orchestration — that's the heat and the hammer.
- **The effort levels are the temperature.** `spark` is a quick heat. `inferno` is white-hot. Right temperature for the right job.
- **Your product is the sword.** Purpose-built, sharp, yours.
- **The Time Machine is the memory of every strike.** Every decision recorded, every branch preserved, every alternate blade possible.
- **Ascend is the parallel forge.** Smelt three blades simultaneously from the same ore. Pick the sharpest. Combine the best edges into the optimal fourth.

---

## The Four Layers

DanteForge is built in four distinct layers. Each serves a specific role in going from raw idea to finished product.

### Layer 1 — The Ore: OSS Harvesting

OSS harvesting is not optional. It is the premise of the forge metaphor. A forge without ore is just heat.

DanteForge finds the best open-source tools, extracts their structural patterns, and feeds them into the convergence engine as raw material. Every harvest produces a cryptographic receipt so you always know where your ore came from.

```bash
danteforge oss                    # discover and score OSS candidates
danteforge harvest "CLI patterns" # harvest patterns from a target
danteforge harvest-forge          # harvest + immediately forge into your project
```

### Layer 2 — The Forge: Five Temperatures

The forge transforms ore and intent into working product. Five intensity levels, one mental model:

| Level | Command | When |
|-------|---------|------|
| Spark | `danteforge spark` | Quick fix, single file, 5 min |
| Ember | `danteforge ember` | Small feature, 30 min |
| Blaze | `danteforge blaze` | Full feature, a few hours |
| Nova | `danteforge nova` | Major refactor or new subsystem, half-day |
| Inferno | `danteforge inferno` | Full attack on a new dimension, all-day |

"Run it at nova" is a complete instruction. The vocabulary is intentional.

Every forge run records its decisions. Every verify pass records a quality signal. These feed the Time Machine and the Parallel Universe engine.

### Layer 3 — The Time Machine: Decision Memory

Every significant decision in a DanteForge workflow is recorded as a node. Nodes are chained. Chains can be branched into alternate timelines.

This is **not a backup system.** It is a causal reasoning engine.

Pick any past decision. Give it a different input. DanteForge restores your files to that exact moment in time, runs the forge from there, records a new timeline, and diffs the two. The causal attribution engine then answers: which downstream decisions were *caused* by your change, and which would have happened anyway?

```bash
danteforge time-machine node list              # view your decision history
danteforge time-machine node trace <nodeId>   # trace why something happened
danteforge time-machine replay <nodeId> --input "try this instead" --dry-run
```

Real example: your agent wrote code you don't like. Instead of starting over, trace back to the exact decision that caused it. Replay with a different instruction. See precisely what would have changed — and what wouldn't have.

**What makes this possible:** Every decision node carries a `fileStateRef` — a git commit SHA linking the decision to the exact file state at that moment. DanteForge can restore any past state byte-identically, which means every branch starts from a verified, uncorrupted baseline.

We validated this on DELEGATE-52: 48 different real-world document types (accounting spreadsheets, protein data, satellite files, screenplays, recipes...), each touched by the AI 10 times in a row. **Zero unmitigated divergences.** Every file came back byte-identical every time.

### Layer 4 — The Parallel Universes: Ascend Synthesis

This is the most powerful layer. It is the reason the other three exist.

Take one key decision. Generate three alternative approaches to that decision. Run the full DanteForge convergence loop on each — same everything else, only that one fork is different. Let all three timelines run to completion.

You now have three finished products.

```
           ┌── Timeline A: "Use microservices"   → Product A (score: 7.2)
           │
Branch ────┼── Timeline B: "Use monolith first"  → Product B (score: 8.8)
           │
           └── Timeline C: "Use serverless"      → Product C (score: 6.5)
                                                          │
                                      Causal Attribution: │
                                      B's error handling ─┤
                                      A's service contracts─┤
                                                           ↓
                                             Synthesis → Product D (score: 9.4)
```

Product D is the blade none of the three would have produced alone. It's the synthesis of the three best edges.

```bash
danteforge ascend --target 9.0                              # autonomous quality loop
danteforge ascend --branch <nodeId> --alternatives 3        # parallel universe mode (coming Phase 7)
```

---

## Quick Start

```bash
npm install -g danteforge
danteforge go
```

First run: 3-question setup wizard → score → top 3 gaps.
Every run after: shows current score, recommends one next action, asks to confirm.

```bash
danteforge spark "your idea"           # plan without any API key
danteforge config --set-key "claude:<key>"  # add a key when ready
danteforge nova "build auth system"    # full forge run
danteforge verify                      # quality gate
```

---

## Works With

DanteForge exposes an MCP server that connects to any AI assistant:

- **Claude Code** — full MCP integration + plugin manifest + slash commands
- **Codex CLI** — native workflow slash commands via `~/.codex/commands`
- **Cursor** — MCP server + `.cursor/mcp.json` config
- **Windsurf** — MCP server via stdio

```json
{ "danteforge": { "command": "danteforge", "args": ["mcp-server"] } }
```

---

## The Research Foundation

The Time Machine is grounded in a research paper:

**"Reversible Decision Graphs: Counterfactual Reasoning Over Human-AI Collaboration Histories"**

Core claim: when every decision in a human-AI pipeline is recorded as a node in a hash-chained graph with associated file state, counterfactual replay becomes tractable — and the question "which decisions actually mattered?" becomes empirically answerable rather than speculative.

The implications extend beyond software: drug discovery, materials science, protein engineering, climate modeling — any domain where decisions compound and the cost of a wrong turn is high.

See [`docs/papers/time-machine-empirical-validation-v1.md`](docs/papers/time-machine-empirical-validation-v1.md) for the full paper draft.
See [`docs/DANTEFORGE-UNIFIED-MASTERPLAN.md`](docs/DANTEFORGE-UNIFIED-MASTERPLAN.md) for the full vision and build roadmap.

---

## The Unified Decision Schema

Every product in the Dante ecosystem emits this structure:

```typescript
interface DecisionNode {
  id: string;           // permanent UUID — immutable
  parentId: string | null;
  sessionId: string;
  timelineId: string;   // 'main' or a counterfactual branch UUID
  timestamp: string;

  actor: {
    type: 'human' | 'agent' | 'model-training';
    product: 'danteforge' | 'danteagents' | 'dantecode' | 'danteharvest' | 'dantedojo';
  };

  input: { prompt: string; context: Record<string, unknown>; alternatives?: string[] };
  output: { result: unknown; fileStateRef?: string; success: boolean; costUsd: number; qualityScore?: number };

  hash: string;         // SHA-256 hash chain — tamper-evident
  causal?: {
    classification?: 'independent' | 'dependent-adaptable' | 'dependent-incompatible';
    counterfactualOf?: string;
  };
}
```

DanteCode, DanteAgents, DanteHarvest, and DanteDojo all emit compatible JSONL into the same decision graph. The Time Machine works across the entire ecosystem.

---

## The North Star

A developer in 2027 opens their tool and asks:

> *"Show me the decision that caused our auth vulnerability. What would our codebase look like if we'd made the secure choice instead? Would we have caught it in code review anyway?"*

The system answers in seconds. It shows the exact node. It replays the alternate timeline. It tells them whether they would have shipped the same vulnerability regardless — and if so, traces further back to find the decision that actually mattered.

That is DanteForge's reason for existing.

---

## The Ecosystem

```
DanteHarvest ──→ harvest decisions ─────┐
DanteCode    ──→ code gen decisions ────┤
DanteDojo    ──→ training decisions ────┼──→ DecisionNode JSONL ──→ Time Machine ──→ Ascend
DanteAgents  ──→ agent action decisions─┤
DanteForge   ──→ forge run decisions ───┘
```

---

## Install

```bash
npm install -g danteforge
```

Or from source:

```bash
git clone https://github.com/dantericardo88/danteforge.git
cd danteforge
npm ci && npm run verify:all && npm link
```

---

## Key Commands

```bash
# Entry point
danteforge go                     # smart entry: score + recommended next action

# The five forge temperatures
danteforge spark "goal"           # planning only, zero tokens
danteforge ember "goal"           # light execution
danteforge blaze "goal"           # full feature
danteforge nova "goal"            # major build
danteforge inferno "goal"         # maximum power + OSS harvest

# Quality
danteforge score                  # fast 0-10 score
danteforge verify                 # hard quality gate
danteforge assess                 # full 8-dimension report vs competitors

# OSS Harvesting
danteforge oss                    # discover OSS candidates
danteforge harvest "pattern"      # harvest and store patterns
danteforge harvest-forge          # harvest + forge immediately

# Time Machine
danteforge time-machine node list                     # view decision history
danteforge time-machine node trace <nodeId>           # trace causality
danteforge time-machine replay <nodeId> --input "..."  # branch and replay
danteforge time-machine node timeline                  # side-by-side diff

# Autonomous loop
danteforge ascend --target 9.0    # run until all quality dimensions hit target
danteforge magic "goal"           # balanced daily driver
danteforge autoforge "goal"       # deterministic pipeline with decision recording
```

---

## LLM Providers

```bash
danteforge config --set-key "claude:sk-..."
danteforge config --set-key "openai:sk-..."
danteforge config --set-key "grok:xai-..."
danteforge config --set-key "gemini:..."
```

Supports: Claude, OpenAI, Grok, Gemini, Ollama (local). Secrets stored in `~/.danteforge/config.yaml`.

---

## Verification

```bash
npm run verify          # typecheck + lint + anti-stub scan + tests
npm run verify:all      # + build + VS Code extension
npm run release:check   # full release gate
```

---

## Links

- [Unified Vision & Masterplan](docs/DANTEFORGE-UNIFIED-MASTERPLAN.md)
- [Time Machine Masterplan](docs/DANTE-VISION-MASTERPLAN.md)
- [Research Paper Draft](docs/papers/time-machine-empirical-validation-v1.md)
- [Integration Guide](docs/INTEGRATION-GUIDE.md)
- [Release History](docs/Release-History.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

---

## License

MIT — see [LICENSE](LICENSE)
