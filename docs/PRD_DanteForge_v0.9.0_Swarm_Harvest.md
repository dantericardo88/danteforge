# DanteForge v0.9.0 PRD — "Swarm Edition"
## Titan Harvest V2 Integration: Patterns from Ruflo

> **Version**: 1.0 | **Author**: Council of Minds (Claude Builder) | **Date**: 2026-03-23
> **Codename**: Swarm Edition
> **Harvest Source**: ruvnet/ruflo (v3.5, 23.9k stars, MIT License)
> **Doctrine**: Titan Harvest V2 — Pattern Learning Only. Zero copied code. Constitutional Lock-In.

---

## 1. Executive Summary

DanteForge v0.8.0 is a workflow orchestration CLI that sits above execution agents. Ruflo is a runtime swarm orchestration framework that spawns and coordinates parallel Claude Code instances. They solve **complementary problems**: DanteForge decides **what** to build (specs, plans, gates, verification); Ruflo decides **how** to execute (parallel agents, token routing, shared memory).

This PRD harvests 8 patterns from Ruflo and integrates them into DanteForge's existing architecture, transforming party mode from "simulated multi-agent via API calls" to "actual parallel agent execution with intelligent cost routing." The result is DanteForge as both the **brain** (workflow orchestration) and the **nervous system** (swarm execution) of AI-assisted development.

### Success Metrics

| Metric | v0.8.0 Baseline | v0.9.0 Target | Measurement |
|--------|-----------------|---------------|-------------|
| Token cost per forge wave | 100% (baseline) | ≤40% of baseline | `execution-telemetry.ts` cost tracking |
| Party mode agent parallelism | Sequential (1 at a time) | True parallel (up to 8) | Process count during party |
| Time-to-forge for 5-task phase | ~15 min (sequential) | ≤6 min (parallel) | Wall clock, audit log timestamps |
| LLM calls skippable by local transforms | 0% | ≥20% of simple edits | Tier-1 intercept rate in telemetry |
| Context window utilization | Untracked | ≤60% per agent | Token estimator per-agent reports |
| PDSE overall score | 86-90% | ≥92% | PDSE scoring engine |

### Scope Boundary

**IN SCOPE**: Pattern harvesting from Ruflo, token optimization, parallel execution, model routing, MCP server exposure, context compression, telemetry.

**OUT OF SCOPE**: Byzantine fault tolerance, WASM kernels, hive-mind queen agents, LoRA fine-tuning, HNSW vector search, IPFS plugin registry, neural training pipelines. These are either marketing over-claims in Ruflo or architectural complexity that violates DanteForge's Ruthless Deletion principle.

---

## 2. Token Optimization Deep Dive

### 2.1 How Ruflo Reduces Tokens

Ruflo claims 75-80% token reduction and 250% effective subscription capacity extension. After analysis, the actual mechanisms that produce real savings are:

1. **3-Tier Model Routing**: Simple transforms (var→const, add types) use local WASM at $0 cost. Medium tasks route to Haiku (~$0.0002). Only complex reasoning hits Sonnet/Opus (~$0.003-$0.015). This is the single biggest cost lever.

2. **Context Compression**: Ruflo's Token Optimizer compresses context by ~32% before sending to LLM, stripping redundant whitespace, comments, and non-essential file content. Agents receive scoped context, not the full project state.

3. **Background Workers Skip LLM**: Ruflo's daemon workers (mapping, auditing, optimizing, documenting) run locally without consuming LLM tokens. Only tasks requiring reasoning hit the API.

4. **Headless Budget Caps**: Each `claude -p` instance has a `--max-budget-usd` flag that hard-caps spend per agent. Runaway agents get killed at the budget fence.

5. **Batch Operations**: All related operations go in a single message — one prompt with 10 file writes beats 10 prompts with 1 write each. This avoids re-sending system prompts and conversation history.

6. **Session Memory Persistence**: Agents don't re-explain context across sessions. Memory store avoids the "here's what we're working on" preamble that eats 500-2000 tokens per interaction.

### 2.2 How DanteForge Already Reduces Tokens (Existing Advantages)

DanteForge's token savings story is architecturally different and in many ways **more aggressive** than Ruflo's:

1. **Offline-First Planning**: `constitution`, `specify`, `clarify`, `plan`, `tasks` can all run locally without any LLM call. Ruflo has no equivalent — it requires an LLM for all planning.

2. **Scoped Wave Execution**: DanteForge breaks work into phases with 2-5 tasks each. Each wave sends only the relevant task context, not the full project. Ruflo sends full swarm context to every agent.

3. **Hard Gates Prevent Wasted Cycles**: Gates block execution before tokens are spent. If SPEC.md doesn't exist, `forge` won't even attempt an LLM call. Ruflo has no gate system — agents can burn tokens on work that violates unwritten constraints.

4. **Context Rot Detection**: The harvested `context-rot.ts` from GSD detects when context is stale and truncates it before sending. This prevents the "long conversation = huge context" problem.

5. **Prompt Mode (`--prompt`)**: Generates copy-paste prompts locally for $0, letting users paste into whatever LLM interface they prefer. Ruflo has no offline prompt generation.

6. **Self-Improving Lessons**: The lessons system means agents don't repeat mistakes. Each mistake costs tokens once, not repeatedly.

### 2.3 The Combined Strategy (v0.9.0)

Merge both approaches into a **6-layer token defense**:

```
Layer 1: SKIP — Local transforms, no LLM needed (NEW from Ruflo pattern)
Layer 2: GATE — Hard gates block premature execution (EXISTING)
Layer 3: SCOPE — Per-agent context filtering + compression (ENHANCED)
Layer 4: ROUTE — Cheapest capable model per task (NEW from Ruflo pattern)
Layer 5: CAP — Per-agent budget fences (NEW from Ruflo pattern)
Layer 6: LEARN — Lessons prevent repeat mistakes (EXISTING, enhanced)
```

**Target**: Combined 60-80% reduction vs. naive "send everything to Opus" baseline.

---

## 3. Harvested Patterns — Specification

### Pattern 1: Headless Agent Spawning

**Source**: Ruflo's `claude -p` pipe mode for parallel headless Claude Code instances.

**What DanteForge Gains**: True parallel agent execution in party mode. Currently, party mode runs agents sequentially via API calls. With headless spawning, DanteForge can fork actual Claude Code processes that run simultaneously.

**Implementation Spec**:

Create `src/core/headless-spawner.ts`:

```
Interface HeadlessAgentConfig {
  role: AgentRole;              // pm, architect, dev, ux, design, scrum-master
  prompt: string;               // The agent's task prompt
  model?: string;               // haiku | sonnet | opus (default from model-profile)
  maxBudgetUsd?: number;        // Per-agent spend cap
  allowedTools?: string[];      // Tool restrictions per role
  timeoutMs?: number;           // Kill after N ms
  sessionId?: string;           // For session continuity
  cwd?: string;                 // Working directory (worktree path)
}

Interface HeadlessAgentResult {
  role: AgentRole;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  tokenUsage?: { input: number; output: number; cost: number };
}

Function spawnHeadlessAgent(config: HeadlessAgentConfig): Promise<HeadlessAgentResult>
Function spawnParallelAgents(configs: HeadlessAgentConfig[]): Promise<HeadlessAgentResult[]>
```

**Behavior**:
- Detect if `claude` CLI is available on PATH. If not, fall back to existing API-based party mode.
- Spawn via `child_process.spawn('claude', ['-p', '--model', model, '--max-budget-usd', budget, '--output-format', 'stream-json', prompt])`.
- Capture stdout/stderr. Parse stream-json for token usage telemetry.
- Each agent runs in its own git worktree (existing `worktree.ts` utility).
- Respect `DANTEFORGE_MAX_PARALLEL_AGENTS` env var (default: 4, max: 8).
- Write agent results to `.danteforge/party-results/<role>-<timestamp>.json`.
- Record all spawns in audit log.

**Integration Points**:
- `party-mode.ts`: Replace sequential `runPMAgent() → runArchitectAgent() → runDevAgent()` chain with `spawnParallelAgents()` for independent agents, sequential for dependent ones.
- `subagent-isolator.ts`: Generate the scoped prompt per role (already implemented), pass to spawner.
- `execution-telemetry.ts`: Aggregate token usage across all headless agents.

**Gate**: `requireSpec` + `requirePlan` before spawning any headless agents. `--light` bypass allowed but audit-logged.

**Anti-Stub**: Complete implementation. No placeholder process spawning. Must handle: process crash, timeout, budget exceeded, claude CLI not found, worktree creation failure.

**Tests**: ≥12 tests covering spawn, parallel execution, timeout, budget cap, fallback to API mode, worktree isolation, result aggregation, audit logging.

---

### Pattern 2: 3-Tier Model Routing

**Source**: Ruflo's Tier 1 (WASM, $0) → Tier 2 (Haiku, cheap) → Tier 3 (Sonnet/Opus, expensive) routing.

**What DanteForge Gains**: Automatic cost routing where simple operations never hit an LLM. DanteForge already has `model-profile-engine.ts` for model selection; this adds a "Tier 0" local transform layer and a complexity classifier.

**Implementation Spec**:

Create `src/core/task-router.ts`:

```
Type TaskTier = 'local' | 'light' | 'heavy';

Interface RoutingDecision {
  tier: TaskTier;
  model: string | null;           // null for local tier
  reason: string;
  estimatedCostUsd: number;
  estimatedTokens: { input: number; output: number };
}

Interface TaskSignature {
  taskType: 'transform' | 'generate' | 'review' | 'architect' | 'verify';
  fileCount: number;
  totalLinesChanged: number;
  hasTestRequirement: boolean;
  hasArchitecturalDecision: boolean;
  hasSecurityImplication: boolean;
  complexityScore: number;         // 0-100, computed from task analysis
}

Function classifyTask(task: DanteTask, context: ScoringContext): TaskSignature
Function routeTask(signature: TaskSignature, profile: ModelProfile): RoutingDecision
```

**Tier Definitions**:

| Tier | Handler | Cost | Criteria | Examples |
|------|---------|------|----------|----------|
| `local` | `local-transforms.ts` | $0 | complexityScore < 15, no reasoning needed | Add types, fix imports, rename variables, format code, add error handling boilerplate |
| `light` | Haiku / cheapest configured model | ~$0.0002/call | complexityScore 15-45, single-file, no architecture | Write a test for an existing function, add JSDoc, implement a simple CRUD endpoint |
| `heavy` | Sonnet / Opus / configured default | ~$0.003-0.015/call | complexityScore > 45, multi-file, architecture, security | Design a new module, refactor across files, security review, API design |

Create `src/core/local-transforms.ts`:

```
Type TransformType =
  | 'add-types'
  | 'add-error-handling'
  | 'add-jsdoc'
  | 'fix-imports'
  | 'var-to-const'
  | 'add-logging'
  | 'remove-console'
  | 'async-await-conversion'
  | 'add-null-checks';

Function applyLocalTransform(filePath: string, transform: TransformType): Promise<TransformResult>
Function detectApplicableTransforms(filePath: string): Promise<TransformType[]>
```

**Behavior**:
- Local transforms use regex + AST-free heuristics (consistent with drift-detector's zero-AST approach).
- The router is called before every `callLLM()` invocation. If the task routes to `local`, the LLM is never called.
- Routing decisions are logged to execution telemetry with `tier`, `model`, `estimatedCost`, and `actualCost`.
- Users can override routing with `--model <name>` flag (forces tier to `heavy` with specified model).
- The `autoforge` loop uses routing decisions to estimate wave cost before execution.

**Integration Points**:
- `llm.ts`: Add `routeBeforeCall()` check. If task routes to `local`, return local transform result directly.
- `autoforge.ts`: Use router to estimate cost of next wave. Display estimated cost in `--dry-run` output.
- `model-profile-engine.ts`: Feed model profiles to router for tier assignment.
- `magic-presets.ts`: Each preset level maps to routing aggressiveness: `spark` = always local/light where possible, `inferno` = always heavy.

**Tests**: ≥15 tests covering classification, routing decisions, local transform application, cost estimation, override behavior, integration with each preset level.

---

### Pattern 3: Per-Agent Context Compression

**Source**: Ruflo's Token Optimizer achieving ~32% context reduction via `getCompactContext()`.

**What DanteForge Gains**: Smaller context windows per agent = fewer tokens = lower cost + better focus. DanteForge already has role-based context filtering in `subagent-isolator.ts`; this adds a compression layer on top.

**Implementation Spec**:

Create `src/core/context-compressor.ts`:

```
Interface CompressionResult {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  reductionPercent: number;
  strategies: string[];            // Which strategies were applied
}

Interface CompressionConfig {
  stripComments: boolean;          // Remove code comments (default: true for dev agent, false for reviewer)
  collapseWhitespace: boolean;     // Normalize whitespace (default: true)
  truncateFileContent: boolean;    // Only include first/last N lines of large files (default: true)
  maxFileLines: number;            // Lines to include per file (default: 50 first + 50 last)
  stripImports: boolean;           // Remove import blocks, keep only names (default: true for non-dev)
  summarizeTests: boolean;         // Replace test bodies with signatures (default: true for non-tester)
  maxContextTokens: number;        // Hard cap on total context tokens (default: 8000)
}

Function compressContext(context: string, config: CompressionConfig): CompressionResult
Function getAgentCompressionConfig(role: AgentRole): CompressionConfig
```

**Strategy Pipeline** (applied in order):
1. **Whitespace normalization**: Collapse multiple blank lines, normalize indentation.
2. **Comment stripping**: Remove single-line and block comments (configurable per role).
3. **Import summarization**: Replace `import { A, B, C, D, E } from './module.js'` with `// imports: A, B, C, D, E from module`.
4. **File truncation**: For files >100 lines, include first 50 + last 50 with `// ... (N lines omitted)` marker.
5. **Test body summarization**: Replace test implementations with `it('test name', () => { /* ... */ })`.
6. **Hard token cap**: If still over `maxContextTokens`, progressively drop lowest-priority sections.

**Role-Specific Configs**:
- **PM**: Strip all code, keep only spec + plan + task names. Target: ≤3000 tokens.
- **Architect**: Keep file tree + interfaces + types. Strip implementations. Target: ≤5000 tokens.
- **Dev**: Keep full code for task-relevant files, compressed code for others. Target: ≤8000 tokens.
- **UX**: Keep only component names + design tokens. Target: ≤3000 tokens.
- **Reviewer**: Keep full code for review targets, compressed for context. Target: ≤6000 tokens.

**Integration Points**:
- `subagent-isolator.ts`: Apply `compressContext()` after `buildSubagentContext()` and before passing to LLM or headless spawner.
- `prompt-builder.ts`: Apply compression to all prompts that include file content.
- `context-injector.ts`: Apply compression before context injection.

**Tests**: ≥10 tests covering each strategy, role-specific configs, token counting accuracy, progressive truncation, edge cases (empty files, binary content).

---

### Pattern 4: Agent Dependency DAG Scheduler

**Source**: Ruflo's worker dependency levels (Level 0 → Level 1 → Level 2 → Level 3).

**What DanteForge Gains**: Intelligent parallel execution where independent agents run simultaneously and dependent agents wait for their prerequisites. Currently party mode runs all agents, but doesn't optimize for parallelism.

**Implementation Spec**:

Create `src/core/agent-dag.ts`:

```
Interface AgentNode {
  role: AgentRole;
  dependsOn: AgentRole[];          // Which agents must complete before this one starts
  priority: number;                // Tiebreaker for same-level agents
}

Interface ExecutionLevel {
  level: number;
  agents: AgentRole[];             // Agents that can run in parallel at this level
}

Interface DAGPlan {
  levels: ExecutionLevel[];
  estimatedParallelism: number;    // Max agents running simultaneously
  estimatedDurationMs: number;     // Based on historical agent durations
  criticalPath: AgentRole[];       // Longest dependency chain
}

Function buildDefaultDAG(): AgentNode[]
Function computeExecutionLevels(nodes: AgentNode[]): DAGPlan
Function executeDAG(plan: DAGPlan, spawner: HeadlessSpawner): Promise<DAGResult>
```

**Default DAG**:
```
Level 0: [pm]                          — No dependencies, runs first
Level 1: [architect]                   — Depends on PM output
Level 2: [dev, ux, design]            — Depends on Architect, can run in parallel
Level 3: [scrum-master]               — Depends on all Level 2 agents
```

**Behavior**:
- `executeDAG()` spawns all Level 0 agents, waits for completion, then spawns Level 1, etc.
- Within a level, agents run in parallel via `spawnParallelAgents()`.
- If an agent fails, downstream agents that depend on it are marked `BLOCKED`.
- DAG can be customized per project via `.danteforge/party-dag.yaml`.
- Execution telemetry records actual vs. estimated parallelism.

**Integration Points**:
- `party-mode.ts`: Replace flat agent list with DAG execution.
- `headless-spawner.ts`: Used as the execution engine for each level.
- `autoforge.ts`: Use DAG to estimate party mode duration.

**Tests**: ≥10 tests covering level computation, parallel execution, failure propagation, custom DAG loading, critical path calculation.

---

### Pattern 5: Per-Agent Budget Fences

**Source**: Ruflo's `--max-budget-usd` per headless instance.

**What DanteForge Gains**: Hard cost caps per agent prevent any single agent from consuming disproportionate tokens. Combined with model routing, this creates a cost envelope that's predictable before execution starts.

**Implementation Spec**:

Extend `src/core/execution-telemetry.ts`:

```
Interface BudgetFence {
  agentRole: AgentRole;
  maxBudgetUsd: number;
  currentSpendUsd: number;
  isExceeded: boolean;
  warningThresholdPercent: number;  // Warn at this % of budget (default: 80%)
}

Interface WaveBudget {
  totalBudgetUsd: number;
  perAgentBudgets: Record<AgentRole, number>;
  estimatedTotalCost: number;
  actualTotalCost: number;
}

Function computeWaveBudget(plan: DAGPlan, routingDecisions: RoutingDecision[]): WaveBudget
Function checkBudgetFence(role: AgentRole, fence: BudgetFence): { proceed: boolean; warning?: string }
```

**Default Budgets by Preset**:

| Preset | Total Wave Budget | PM | Architect | Dev | UX | Design | Scrum |
|--------|------------------|-----|-----------|-----|-----|--------|-------|
| spark | $0.05 | $0.005 | $0.01 | $0.02 | $0.005 | $0.005 | $0.005 |
| ember | $0.15 | $0.01 | $0.03 | $0.06 | $0.02 | $0.02 | $0.01 |
| magic | $0.50 | $0.05 | $0.10 | $0.20 | $0.05 | $0.05 | $0.05 |
| blaze | $1.50 | $0.10 | $0.30 | $0.60 | $0.20 | $0.20 | $0.10 |
| inferno | $5.00 | $0.30 | $1.00 | $2.00 | $0.70 | $0.70 | $0.30 |

**Behavior**:
- Budget is computed before wave execution and displayed in `--dry-run`.
- During execution, each LLM call updates the agent's `currentSpendUsd`.
- At 80% budget, a warning is logged. At 100%, the agent is terminated gracefully.
- Budget overages are recorded in the audit log with the agent role and task that exceeded.
- Users can override budgets via `--budget <usd>` flag or `.danteforge/budget.yaml`.

**Integration Points**:
- `headless-spawner.ts`: Pass `--max-budget-usd` to headless Claude instances.
- `llm.ts`: Check budget fence before every API call. Reject if exceeded.
- `magic-presets.ts`: Each preset defines default budgets.
- `autoforge.ts`: Display estimated cost before autonomous execution.

**Tests**: ≥8 tests covering budget computation, fence enforcement, warning thresholds, graceful termination, override behavior, preset mapping.

---

### Pattern 6: Complexity-Based Auto-Escalation

**Source**: Ruflo's auto-swarm detection based on task complexity signals.

**What DanteForge Gains**: Automatic escalation from solo mode to party mode based on task analysis, making magic presets self-selecting. Users don't need to manually choose between `spark` and `inferno`.

**Implementation Spec**:

Create `src/core/complexity-classifier.ts`:

```
Interface ComplexitySignals {
  fileCount: number;                // Number of files to modify
  moduleCount: number;              // Number of distinct modules/directories
  hasNewModule: boolean;            // Creating a new module from scratch
  hasArchitecturalChange: boolean;  // Modifying interfaces, types, or module boundaries
  hasSecurityImplication: boolean;  // Auth, crypto, permissions, input validation
  hasTestRequirement: boolean;      // Tests need to be written or updated
  hasDatabaseChange: boolean;       // Schema, migration, query changes
  hasAPIChange: boolean;            // Endpoint addition/modification
  estimatedLinesOfCode: number;     // Estimated total lines to write/modify
  dependencyDepth: number;          // How many modules depend on changed files
}

Type RecommendedPreset = 'spark' | 'ember' | 'magic' | 'blaze' | 'inferno';

Interface ComplexityAssessment {
  signals: ComplexitySignals;
  score: number;                    // 0-100
  recommendedPreset: RecommendedPreset;
  reasoning: string;
  shouldUseParty: boolean;
  estimatedDurationMinutes: number;
  estimatedCostUsd: number;
}

Function assessComplexity(tasks: DanteTask[], state: DanteState): ComplexityAssessment
```

**Scoring Matrix**:

| Signal | Weight | Threshold → Preset |
|--------|--------|-------------------|
| fileCount | 15 | 1-2 → spark, 3-5 → ember, 6-10 → magic, 11-20 → blaze, 21+ → inferno |
| hasNewModule | 10 | true → +2 preset levels |
| hasArchitecturalChange | 15 | true → minimum magic |
| hasSecurityImplication | 10 | true → minimum blaze |
| estimatedLinesOfCode | 15 | <50 → spark, <200 → ember, <500 → magic, <1000 → blaze, 1000+ → inferno |
| dependencyDepth | 10 | 0 → spark, 1-2 → ember, 3+ → magic |
| hasTestRequirement | 10 | true → +1 preset level |
| hasAPIChange | 8 | true → minimum ember |
| hasDatabaseChange | 7 | true → minimum ember |

**Behavior**:
- Called automatically by `autoforge` before each wave.
- In `--auto` mode, the recommended preset is used without prompting.
- In interactive mode, the recommendation is displayed: "Complexity: 67/100 → Recommended: blaze. Proceed? [Y/n]"
- Users can override with explicit `--level` flag.
- Assessment is recorded in STATE.yaml audit log.

**Integration Points**:
- `autoforge.ts`: Call `assessComplexity()` before wave execution.
- `autoforge-loop.ts`: Use assessment to select preset automatically in `--auto` mode.
- `magic-presets.ts`: Map assessment to preset configuration.

**Tests**: ≥10 tests covering scoring edge cases, preset mapping, override behavior, assessment recording.

---

### Pattern 7: MCP Server Exposure

**Source**: Ruflo registering as an MCP server with 259 tools accessible to Claude Code.

**What DanteForge Gains**: External agents (Claude Code, Codex, any MCP client) can query DanteForge's project state, check gate status, trigger workflow transitions, and read PDSE scores programmatically. This turns DanteForge from a CLI-only tool into a coordination service.

**Implementation Spec**:

Create `src/core/mcp-server.ts`:

```
Interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (input: unknown) => Promise<unknown>;
}

Function createDanteForgeMCPServer(): MCPServer
Function registerMCPTools(server: MCPServer): void
```

**Exposed MCP Tools** (15 tools, focused and useful — not 259 surface-level registrations):

| Tool | Description | Category |
|------|-------------|----------|
| `danteforge_state` | Read current project state (phase, stage, tasks) | State |
| `danteforge_score` | Get PDSE score for an artifact | Scoring |
| `danteforge_score_all` | Get all artifact scores + overall | Scoring |
| `danteforge_gate_check` | Check if a specific gate would pass | Gates |
| `danteforge_next_steps` | Get recommended next workflow steps | Workflow |
| `danteforge_task_list` | List tasks for current phase | Tasks |
| `danteforge_artifact_read` | Read a specific artifact (SPEC, PLAN, etc.) | Artifacts |
| `danteforge_lessons` | Read current lessons.md | Learning |
| `danteforge_memory_query` | Query memory engine | Memory |
| `danteforge_verify` | Run verification checks | Verification |
| `danteforge_handoff` | Trigger a workflow handoff | Workflow |
| `danteforge_budget_status` | Check current wave budget status | Cost |
| `danteforge_complexity` | Assess task complexity | Routing |
| `danteforge_route_task` | Get routing recommendation for a task | Routing |
| `danteforge_audit_log` | Read recent audit log entries | Audit |

**Behavior**:
- MCP server starts via `danteforge mcp start` (new CLI command).
- Runs on stdio transport (compatible with Claude Code's `claude mcp add`).
- All reads are safe (no state mutation). Write operations (`handoff`, `verify`) require explicit confirmation.
- Each tool call is audit-logged.
- Server respects the same hard gates as the CLI — can't skip constitution via MCP.

**Integration Points**:
- `src/cli/commands/mcp-server.ts`: New command to start the MCP server.
- `src/cli/index.ts`: Register `mcp-server` command.
- All existing core modules: Reuse their functions as MCP tool handlers.

**Setup for users**:
```bash
# Register DanteForge as an MCP server in Claude Code
claude mcp add danteforge -- npx danteforge mcp start

# Or for Codex
codex mcp add danteforge -- npx danteforge mcp start
```

**Tests**: ≥12 tests covering each tool, input validation, gate enforcement via MCP, audit logging, error handling for invalid inputs.

---

### Pattern 8: Token Tracking Telemetry Dashboard

**Source**: Ruflo's `analysis token-usage`, `analysis claude-cost`, and real-time session monitoring.

**What DanteForge Gains**: Visibility into where tokens are being spent, which agents are most expensive, and how routing decisions affect cost over time. DanteForge already has `execution-telemetry.ts` and `token-estimator.ts`; this connects them into a reporting pipeline.

**Implementation Spec**:

Extend `src/core/execution-telemetry.ts`:

```
Interface TokenReport {
  sessionId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byAgent: Record<AgentRole, { inputTokens: number; outputTokens: number; costUsd: number; callCount: number }>;
  byTier: Record<TaskTier, { callCount: number; totalTokens: number; costUsd: number }>;
  byModel: Record<string, { callCount: number; totalTokens: number; costUsd: number }>;
  savedByLocalTransforms: { callCount: number; estimatedSavedTokens: number; estimatedSavedUsd: number };
  savedByCompression: { originalTokens: number; compressedTokens: number; savedPercent: number };
  savedByGates: { blockedCallCount: number; estimatedSavedTokens: number };
  timestamp: string;
}

Function generateTokenReport(telemetry: ExecutionTelemetry): TokenReport
Function displayTokenReport(report: TokenReport): void       // CLI formatted output
Function persistTokenReport(report: TokenReport): Promise<string>  // Save to .danteforge/reports/
```

Create `src/cli/commands/cost.ts`:

```bash
# Show current session cost
danteforge cost

# Show cost breakdown by agent
danteforge cost --by-agent

# Show cost breakdown by model tier
danteforge cost --by-tier

# Show savings from local transforms + compression + gates
danteforge cost --savings

# Show historical cost across sessions
danteforge cost --history
```

**Behavior**:
- Every `callLLM()` invocation records input/output tokens and cost.
- Every local transform records an "avoided LLM call" metric.
- Every gate block records an "avoided execution" metric.
- Every compression records original vs. compressed token counts.
- Reports are persisted to `.danteforge/reports/cost-<timestamp>.json`.
- `danteforge cost --savings` shows a summary: "This session saved $X.XX by routing N calls locally, compressing context by M%, and blocking K premature executions."

**Integration Points**:
- `llm.ts`: Record token usage after every API call.
- `local-transforms.ts`: Record avoided calls.
- `context-compressor.ts`: Record compression ratios.
- `gates.ts`: Record gate blocks.
- `autoforge.ts`: Display cost estimate and actual cost at wave boundaries.

**Tests**: ≥8 tests covering report generation, persistence, display formatting, savings calculation accuracy.

---

## 4. Implementation Waves

### Wave 1: Token Routing Foundation (Estimated: 4-6 hours)

**Files to create**:
- `src/core/task-router.ts` (Pattern 2)
- `src/core/local-transforms.ts` (Pattern 2)
- `src/core/context-compressor.ts` (Pattern 3)
- `tests/task-router.test.ts`
- `tests/local-transforms.test.ts`
- `tests/context-compressor.test.ts`

**Files to modify**:
- `src/core/llm.ts` — Add routing check before API calls
- `src/core/subagent-isolator.ts` — Apply compression after context building
- `src/core/prompt-builder.ts` — Apply compression to file content in prompts
- `src/core/model-profile-engine.ts` — Feed profiles to router
- `src/core/magic-presets.ts` — Map presets to routing aggressiveness

**Verification**: `npm run verify` passes. New tests pass. Local transforms produce valid code edits on sample files. Compression achieves ≥25% reduction on typical DanteForge artifacts.

### Wave 2: Parallel Execution Engine (Estimated: 6-8 hours)

**Files to create**:
- `src/core/headless-spawner.ts` (Pattern 1)
- `src/core/agent-dag.ts` (Pattern 4)
- `tests/headless-spawner.test.ts`
- `tests/agent-dag.test.ts`

**Files to modify**:
- `src/harvested/dante-agents/party-mode.ts` — Use DAG + spawner instead of sequential execution
- `src/core/subagent-isolator.ts` — Generate prompts compatible with headless mode
- `src/utils/worktree.ts` — Ensure worktree creation supports parallel agents

**Verification**: `npm run verify` passes. Party mode spawns parallel processes (or falls back to API gracefully). DAG computes correct levels. Worktrees are created and cleaned up.

### Wave 3: Budget + Cost Controls (Estimated: 3-4 hours)

**Files to create**:
- `src/core/complexity-classifier.ts` (Pattern 6)
- `src/cli/commands/cost.ts` (Pattern 8)
- `tests/complexity-classifier.test.ts`
- `tests/cost-command.test.ts`

**Files to modify**:
- `src/core/execution-telemetry.ts` — Add budget fences, token reports (Patterns 5, 8)
- `src/core/llm.ts` — Enforce budget fence before API calls
- `src/core/autoforge.ts` — Use complexity assessment, display cost estimates
- `src/core/autoforge-loop.ts` — Auto-select preset based on complexity
- `src/core/magic-presets.ts` — Add budget definitions per preset
- `src/cli/index.ts` — Register `cost` command

**Verification**: `npm run verify` passes. Budget fences enforce caps. Complexity classifier produces reasonable preset recommendations. Cost command displays accurate reports.

### Wave 4: MCP Server + Integration (Estimated: 4-6 hours)

**Files to create**:
- `src/core/mcp-server.ts` (Pattern 7)
- `src/cli/commands/mcp-server.ts`
- `tests/mcp-server.test.ts`

**Files to modify**:
- `src/cli/index.ts` — Register `mcp-server` command
- `package.json` — Add `danteforge mcp start` as a bin entry point
- `README.md` — Document MCP server setup
- `docs/Operational-Readiness-v0.9.0.md` — New operational readiness doc
- `.danteforge/CONSTITUTION.md` — Remove TODO/TBD/stub references that tank PDSE score

**Verification**: `npm run verify` passes. MCP server starts and responds to tool calls. Claude Code can register DanteForge as an MCP server. All 15 tools return correct data. `release:check` passes.

---

## 5. File Manifest

### New Files (14)

| File | Pattern | Purpose |
|------|---------|---------|
| `src/core/task-router.ts` | 2 | Task complexity classification + tier routing |
| `src/core/local-transforms.ts` | 2 | Zero-cost code transforms (skip LLM) |
| `src/core/context-compressor.ts` | 3 | Per-agent context compression pipeline |
| `src/core/headless-spawner.ts` | 1 | Parallel headless Claude Code spawning |
| `src/core/agent-dag.ts` | 4 | Dependency-ordered parallel agent scheduling |
| `src/core/complexity-classifier.ts` | 6 | Auto-escalation from solo to party mode |
| `src/core/mcp-server.ts` | 7 | DanteForge as MCP tool server |
| `src/cli/commands/mcp-server.ts` | 7 | CLI command for MCP server |
| `src/cli/commands/cost.ts` | 8 | Token cost reporting command |
| `tests/task-router.test.ts` | 2 | ≥15 tests |
| `tests/local-transforms.test.ts` | 2 | ≥8 tests |
| `tests/context-compressor.test.ts` | 3 | ≥10 tests |
| `tests/headless-spawner.test.ts` | 1 | ≥12 tests |
| `tests/agent-dag.test.ts` | 4 | ≥10 tests |
| `tests/complexity-classifier.test.ts` | 6 | ≥10 tests |
| `tests/mcp-server.test.ts` | 7 | ≥12 tests |
| `tests/cost-command.test.ts` | 8 | ≥8 tests |
| `docs/Operational-Readiness-v0.9.0.md` | — | Release readiness doc |

### Modified Files (17)

| File | Changes |
|------|---------|
| `src/core/llm.ts` | Add routing check, budget fence enforcement, token recording |
| `src/core/subagent-isolator.ts` | Apply context compression after context building |
| `src/core/prompt-builder.ts` | Apply compression to file content in prompts |
| `src/core/model-profile-engine.ts` | Feed profiles to task router |
| `src/core/magic-presets.ts` | Add budget definitions, routing aggressiveness, auto-escalation |
| `src/core/execution-telemetry.ts` | Budget fences, token reports, savings tracking |
| `src/core/autoforge.ts` | Complexity assessment, cost estimates, auto-preset selection |
| `src/core/autoforge-loop.ts` | Auto-select preset in --auto mode |
| `src/harvested/dante-agents/party-mode.ts` | DAG-based parallel execution via headless spawner |
| `src/utils/worktree.ts` | Support parallel worktree creation for headless agents |
| `src/core/context-injector.ts` | Apply compression before injection |
| `src/cli/index.ts` | Register `cost` and `mcp-server` commands |
| `package.json` | Version bump to 0.9.0, MCP server bin entry |
| `README.md` | Document new capabilities, MCP setup, cost command |
| `.danteforge/CONSTITUTION.md` | Fix anti-stub violations (TODO/TBD references) |
| `.danteforge/SPEC.md` | Fix anti-stub violations (stub references) |
| `.danteforge/TASKS.md` | Fix anti-stub violations (shim references) |

---

## 6. Constitution Alignment

| Principle | How This PRD Complies |
|-----------|----------------------|
| Zero Ambiguity | Every pattern has typed interfaces, explicit behavior specs, and test counts |
| Local-First | Local transforms (Tier 0) and context compression run offline with $0 cost |
| Atomic Commits | Each wave is independently shippable and verifiable |
| Verify Before Commit | Each wave ends with `npm run verify` gate |
| Fail-Closed | Budget fences kill agents at cap. Missing `claude` CLI falls back to API mode. Gate enforcement applies to MCP tools |
| Audit Trails | All spawns, routing decisions, budget overages, and MCP calls are audit-logged |
| Scale-Adaptive | Complexity classifier auto-escalates solo → party mode |
| Anti-Stub Doctrine | This PRD requires complete implementations. No TODO, FIXME, TBD, placeholder, or stub markers in shipped code |
| Titan Harvest V2 | Pattern learning only. Zero code copied from Ruflo. Constitutional lock-in on all new modules |
| KiloCode | All new files target <500 LOC. Complete implementations, no stubs |

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `claude` CLI not available on user's system | High | Medium | Graceful fallback to API-based party mode. Detect at runtime, not build time |
| Headless agents produce conflicting edits | Medium | High | Git worktree isolation per agent. Merge step with conflict detection after DAG execution |
| Budget fences kill agents mid-task | Medium | Medium | Graceful shutdown: agent saves partial work before termination. Resume capability via session IDs |
| Local transforms produce invalid code | Low | High | Every transform is validated by regex pattern matching. Never applied to files outside task scope. Revert capability |
| MCP server exposes sensitive project state | Low | Medium | Read-only by default. Write operations require explicit confirmation. No secrets in MCP responses |
| Context compression removes essential information | Medium | Medium | Role-specific compression configs. Architect and reviewer get more context. Configurable via `.danteforge/compression.yaml` |
| Complexity classifier recommends wrong preset | Medium | Low | User can always override. Classification is logged. Lessons system learns from overrides |

---

## 8. Version Bump Checklist

Before shipping v0.9.0:

- [ ] `package.json` version → `0.9.0`
- [ ] `vscode-extension/package.json` version → `0.9.0`
- [ ] `.claude-plugin/plugin.json` version → `0.9.0`
- [ ] `.claude-plugin/marketplace.json` version → `0.9.0`
- [ ] `.danteforge/CONSTITUTION.md` — zero TODO/TBD/stub references
- [ ] `.danteforge/SPEC.md` — zero stub references
- [ ] `.danteforge/TASKS.md` — zero shim references
- [ ] `npm run verify:all` passes
- [ ] `npm run release:check` passes
- [ ] `npm run release:check:strict` passes
- [ ] All PDSE scores ≥90
- [ ] `docs/Operational-Readiness-v0.9.0.md` complete
- [ ] README updated with MCP server setup and cost command documentation
- [ ] New test count: existing 790+ plus ≥95 new tests = 885+ total
- [ ] Anti-stub scan clean across all new and modified files

---

## 9. Glossary

| Term | Definition |
|------|-----------|
| **Tier 0 / local** | Operations handled entirely by local code transforms, no LLM call |
| **Tier 1 / light** | Operations routed to cheapest configured LLM (Haiku-class) |
| **Tier 2 / heavy** | Operations requiring full reasoning model (Sonnet/Opus-class) |
| **Budget Fence** | Hard dollar cap per agent that terminates execution when exceeded |
| **DAG** | Directed Acyclic Graph — dependency ordering for parallel agent execution |
| **Headless Spawning** | Running Claude Code in non-interactive pipe mode (`claude -p`) |
| **Context Compression** | Reducing token count of agent context via stripping, summarization, and truncation |
| **MCP Server** | Model Context Protocol server that exposes DanteForge tools to external agents |
| **Complexity Classifier** | Heuristic that analyzes task signals and recommends a magic preset level |
| **Token Report** | Structured breakdown of where tokens were spent and where they were saved |

---

*End of PRD. This document is implementation-ready for Claude Code execution.*
*Titan Harvest V2 compliant: patterns only, zero copied code, constitutional lock-in.*
