# Product Requirements Document: DanteForge + OpenPencil Integration

> **Version:** 0.5.0 "Design-as-Code Edition"
> **Status:** Implementation Complete — Final Verification

---

## Executive Summary

This PRD details the strategic integration of **OpenPencil** — an open-source, AI-native vector design tool — into **DanteForge**, an opinionated agentic development CLI. By executing a structured "harvest-and-fuse" integration model, this initiative establishes the world's first fully autonomous, end-to-end design-to-code pipeline.

The resulting unified system empowers users to leverage natural language prompts to generate version-controlled design specifications, orchestrated by multi-agent teams, and seamlessly compiled into verified, production-ready software architecture.

---

## Table of Contents

1. [Macro-Environmental Context](#1-macro-environmental-context)
2. [Architectural Baseline: DanteForge](#2-architectural-baseline-danteforge)
3. [Architectural Baseline: OpenPencil](#3-architectural-baseline-openpencil)
4. [Strategic Synergy Matrix](#4-strategic-synergy-matrix)
5. [Core Feature Specifications (v0.5.0)](#5-core-feature-specifications-v050)
6. [Architectural Code Modifications](#6-architectural-code-modifications)
7. [Integration Roadmap](#7-integration-roadmap)
8. [Risk Mitigation & Security](#8-risk-mitigation--security)

---

## 1. Macro-Environmental Context

The software development ecosystem has moved decisively past rudimentary code completion into the era of **Agent-Computer Interaction (ACI)**. Enterprise leaders are doubling down on AI agent deployments, focusing on measurable ROI and targeted use cases rather than generic experimentation.

A critical enabler is the **Model Context Protocol (MCP)**, which has rapidly become the standardized architecture for agents to interact with external systems, databases, and APIs. MCP functions as the new user interface for synthetic users, allowing AI agents to dynamically discover available tools, understand their parameters through semantic descriptions, and invoke them securely.

Concurrently, the industry is experiencing a "microservices moment" for AI, characterized by the rise of **multi-agent orchestration**. Instead of relying on a singular, monolithic LLM to process massive contexts, architectures now distribute tasks among specialized sub-agents working in parallel.

The paradigm of **"Design-as-Code"** resolves the architectural disconnect between design and code. By serializing complex visual layouts, typographic scales, and vector graphics into human-readable, Git-friendly JSON files (such as the `.op` format), design artifacts become first-class citizens within the software supply chain.

---

## 2. Architectural Baseline: DanteForge

DanteForge operates as a highly disciplined, agentic development CLI that enforces structured specifications, execution waves, and TDD. Engineered in strict TypeScript, running as ESM-only Node.js (>= 18).

### CLI Command Categories

| Category | Commands | Function |
|---|---|---|
| **Specification & Planning** | `constitution`, `specify`, `clarify`, `plan`, `tasks`, `tech-decide` | Translates ideas into structured artifacts (SPEC.md, PLAN.md) with constitutional enforcement |
| **Execution & Orchestration** | `forge`, `party`, `magic`, `ux-refine`, `design` | Orchestrates LLM agents for code construction, concurrent execution, and visual interfaces |
| **Verification & QA** | `review`, `verify`, `synthesize`, `debug`, `doctor` | Validates project state, enforces test pipelines, merges artifacts into UPR |
| **System & Utilities** | `config`, `import`, `setup`, `update-mcp`, `compact`, `help`, `dashboard`, `lessons` | Manages API keys, MCP connections, and system health |

### Core Modules (12+)

- **prompt-builder.ts** — Sanitizes inputs to neutralize prompt injection
- **verifier.ts** — Hardened anchored regex with "FAIL priority"
- **state.ts** — YAML-based state engine (`.danteforge/STATE.yaml`)
- **handoff.ts** — Phase transition tracking (`spec -> next`, `forge -> next`)
- **llm.ts** — Dynamic SDK loading for Ollama, Grok, Claude, OpenAI, Gemini
- **gates.ts** — Hard verification gates: `requireConstitution`, `requireSpec`, `requirePlan`, `requireTests`, `requireDesign`
- **config.ts** — 0o600 file permissions for API key security

### Agentic Architecture

- **GSD Framework**: Planner, Researcher, Executor, Verifier agents
- **Dante Agents**: PM, Architect, Dev, UX, Scrum Master, Design (6 roles)
- **Git Worktree Isolation**: `src/utils/worktree.ts` sandboxes agent operations

---

## 3. Architectural Baseline: OpenPencil

OpenPencil functions as a high-performance, AI-native vector design ecosystem. Its core engine (`@open-pencil/core`) is entirely decoupled from DOM dependencies, permitting headless execution via Bun or Node.js.

### Rendering Engine

- **CanvasKit** (Skia WASM) — GPU-accelerated vector rendering, Boolean ops, typography, layer effects
- **Yoga WASM** — CSS flexbox/grid layout computation that maps directly to web CSS properties

### 86-Tool MCP Surface

| Domain | Count | Key Capabilities |
|---|---|---|
| **Read Operations** | 11 | `get_selection`, `get_page_tree`, `get_node`, `find_nodes`, `list_fonts` |
| **Creation Engines** | 7 | `createShape`, `render`, `createComponent`, `createInstance`, `createPage` |
| **Property Modification** | 20 | `setFill`, `setStroke`, `setLayout`, `setConstraints`, `setText`, `setOpacity` |
| **Structural Logic** | 17 | `deleteNode`, `cloneNode`, `groupNodes`, `reparentNode`, `flattenNodes` |
| **Design Variables** | 11 | `createVariable`, `bindVariable`, `getCollection`, `listCollections` |
| **Vector & Export** | 14 | `booleanUnion`, `pathScale`, `viewportZoomToFit`, `exportImage`, `exportSvg` |
| **Analysis & Diffing** | 6 | `analyzeColors`, `analyzeTypography`, `analyzeSpacing`, `diffCreate`, `diffShow` |

### AI Adapter

The adapter (`ai-adapter.ts`) dynamically converts internal ToolDef objects into standardized tool configurations, using `valibot` for strict runtime validation schemas. If an agent successfully mutates design state, the adapter triggers an `onFlashNodes` hook for visual feedback.

### The `.op` File Format

The `.op` format serializes the entire scene graph, variable collections, and component logic into pure JSON. This "Design-as-Code" architecture allows design files to be version-controlled, diffed during PRs, and mutated by AI agents programmatically.

---

## 4. Strategic Synergy Matrix

| OpenPencil Origin | DanteForge Target | Strategic Synergy |
|---|---|---|
| `src/services/ai/orchestrator.ts` | `src/harvested/gsd/executor.ts` | **Spatial Task Decomposition**: Breaks UIs into spatial sub-tasks (Header, Nav, Content) for concurrent agent generation |
| `packages/core/src/tools/ai-adapter.ts` | `src/core/mcp-adapter.ts` | **Protocol Bridging**: Maps 86 Valibot-validated tools into DanteForge's prompt building and tool-calling infrastructure |
| `.op` JSON Codec & Token System | `src/core/state.ts` & design modules | **Unified State Management**: Fuses design variables into YAML state tracking |
| `packages/core/src/tools/vector.ts` | CLI Output & Extension Embeds | **Visual Verification Loop**: Headless Skia renders Base64 PNG previews in terminal |
| `packages/core/src/tools/analyze.ts` | `src/cli/commands/verify.ts` | **Strict Design Gates**: Automated layout/spacing/typography audits in verification gates |

---

## 5. Core Feature Specifications (v0.5.0)

### 5.1 The `danteforge design` Command

```
danteforge design <prompt> [--prompt] [--light] [--format jsx|vue|html] [--parallel] [--worktree]
```

- Reads constitutional constraints and tech stack preferences
- Decomposes the prompt into spatial sub-tasks via the OpenPencil orchestrator
- Utilizes 86 MCP tools to construct a `.op` JSON artifact
- Renders a preview (PNG/SVG/HTML) via the headless engine
- Three modes: LLM API, `--prompt` (copy-paste), local fallback (skeleton .op)

### 5.2 Augmented `ux-refine` Pipeline

```
danteforge ux-refine --openpencil
```

- **`--openpencil` flag**: Bypasses Figma MCP entirely
- Parses local `.op` file and validates structure
- Runs `analyzeColors`, `analyzeTypography`, `analyzeSpacing` for consistency checks
- Extracts design tokens to CSS and Tailwind config
- Renders ASCII and HTML previews
- Generates visual/JSON diffs via `diffCreate`

### 5.3 Design Agent & Party Mode

```
danteforge party --design [--worktree]
danteforge party --no-design
```

- New **Design Agent** persona integrated into the 6-agent roster
- `--design` activates Design Agent explicitly
- `--no-design` excludes it for backend-only work
- Design Agent operates in parallel inside isolated Git worktrees
- Spatial orchestrator ensures component generation doesn't block

### 5.4 Automated Token Synchronization

During `danteforge forge` execution:

1. Executor agent invokes OpenPencil's export tools (JSX, Tailwind CSS)
2. Post-step hook runs `analyzeColors` / `analyzeTypography` on `.op` file
3. Design tokens extracted and injected into CSS variables / Tailwind config
4. Absolute parity maintained between design artifact and compiled application

### 5.5 `requireDesign` Hard Gate

Before `forge` can initiate UI code generation:

- Validates `.op` JSON structure (requires `nodes` and `document` fields)
- Runs `analyzeSpacing` and `analyzeClusters` to detect mathematical inconsistencies (e.g., rogue 13px padding in an 8-point grid)
- Halts execution wave on violation, logs failure, requests clarification

---

## 6. Architectural Code Modifications

### 6.1 Submodule Ingestion

OpenPencil ingested into `src/harvested/openpencil/` via harvest-and-fuse:
- **Dependency pruning**: tsup configured to ignore DOM-related packages (Vue, Tailwind web deps)
- **Target**: Only `@open-pencil/core` and `@open-pencil/mcp` packages
- **Result**: CLI remains lightweight, no browser environment emulators needed

### 6.2 Adapter Fusion

- `src/core/mcp-adapter.ts` instantiates OpenPencil's `ai-adapter.ts`
- 86 tools from `registry.ts` mapped into DanteForge's tool registry
- Valibot schemas piped through `prompt-builder.ts` sanitization routines
- All tool invocations protected against prompt injection via `xml-utils.ts`

### 6.3 Skill Registration

New skills in `harvested/dante-agents/skills/`:
- `design-orchestrator` — Spatial UI decomposition orchestration
- `design-token-sync` — CSS/Tailwind token extraction and sync
- `figma-to-op` — Convert Figma exports to `.op` format
- `visual-regression` — Visual regression testing
- `design-system-audit` — Design system consistency auditing

---

## 7. Integration Roadmap

### Week 1: Deep Harvest & MCP Bridging

- Configure Git submodule, prune Vue dependencies via tsup
- Fuse `ai-adapter.ts` into core MCP adapter
- **Gate**: `danteforge verify` — 100% test passage on Node 18/20/22

### Week 2: Orchestrator & Party Mode Injection

- Inject spatial task decomposition into GSD executor
- Finalize Design Agent role and integrate into `party` command
- Generate mock `.op` files for test simulation
- **Gate**: Minimum 50 new tests covering execution loops and tool validation

### Week 3: Codec, Rendering & Exports

- Update `STATE.yaml` schema for design phase tracking
- Implement `requireDesign` hard gate in `gates.ts`
- Wire `exportImage` to output logger with Node.js Buffer for Base64
- Configure `forge` to use JSX/Tailwind export utilities
- **Gate**: OpenPencil smoke tests in CI matrix

### Week 4: Polish, Documentation & Release

- Update AGENTS.md, README.md, CLAUDE.md with new commands
- Verify auditLog records `design -> next` handoffs
- **Gate**: `npm run release:check:strict`, SLSA provenance, tag v0.5.0

---

## 8. Risk Mitigation & Security

### Canvas Performance & Binary Footprint

- CanvasKit (Skia WASM) lazily loaded only when `design` or `ux-refine` commands are invoked
- Standard `forge` tasks unaffected by initialization latency
- Current implementation uses native SVG renderer (zero WASM dependency)

### Git Hygiene for Large JSON Artifacts

- Strict formatting via `.oxfmtrc.json` standards (deterministic indentation, key ordering)
- Automated `.gitignore` management: intermediate `.op` files (`.op.raw`, `.op.wip`) excluded
- Only verifier-approved `.op` files eligible for main branch merge
- 2MB size limit enforced in `op-codec.ts`

### Error Aggregation in Party Mode

- Explicit `success` boolean tracking on every `AgentResult` (not fragile string matching)
- Failed agents logged individually with error details
- `requireDesign` gate serves as ultimate backstop — invalid `.op` triggers `process.exitCode = 1`
- Auto-capture of agent failure lessons for self-improvement

---

## Conclusion

The synthesis of DanteForge and OpenPencil represents a strategic architectural evolution for autonomous, multi-agent engineering. By harvesting OpenPencil's 86-tool MCP manifest, its headless rendering engine, and its strict `.op` JSON format, DanteForge brings the complete software development lifecycle — from structured visual conception to verified code execution — into a unified, local, agentic CLI.
