# DanteForge System Architecture

## System Overview

DanteForge is an agentic development CLI that orchestrates structured software development workflows through a deterministic state machine, LLM integration, and multi-agent collaboration. The system exposes dozens of commands across pipeline, automation, design, intelligence, and tooling categories. It is ESM-only TypeScript with a deliberately small runtime dependency footprint.

## Directory Structure

```
src/
  cli/                          Commander.js CLI entry and command handlers
    commands/                   Individual command modules (one async function per file)
  core/                         Shared infrastructure
    state.ts                    YAML-based project state (.danteforge/STATE.yaml)
    config.ts                   User-level config (~/.danteforge/config.yaml)
    llm.ts                      Multi-provider LLM client (Ollama, Grok, Claude, OpenAI, Gemini)
    gates.ts                    Hard gates (requireConstitution, requireSpec, etc.)
    workflow-enforcer.ts        State machine for pipeline transitions
    skills.ts                   YAML frontmatter skill discovery
    completion-tracker.ts       PDSE scoring and completion percentages
    pdse.ts / pdse-config.ts    Planning Document Scoring Engine
    autoforge.ts                Deterministic pipeline orchestration
    ship-engine.ts              Release planning and changelog generation
    safe-self-edit.ts           Protected file gate with audit logging
    harvest-engine.ts           Titan Harvest V2 track runner
    autoresearch-engine.ts      Autonomous metric-driven optimization
    oss-researcher.ts           License-gated OSS pattern harvesting
    prompt-builder.ts           Template-based prompt generation
    token-estimator.ts          Token counting and cost estimation
    logger.ts                   Structured logging with level control
    handoff.ts                  Artifact handoff between pipeline stages
  harvested/                    Pattern-harvested subsystems
    gsd/                        Wave executor, context-rot hooks, XML utils
    spec/                       Clarify engine, templates
    dante-agents/               5 agent roles, party mode, skills/, help engine
    openpencil/                 Design-as-Code engine (.op codec, tool registry, renderer)
  utils/                        Git worktree isolation
hooks/                          Claude Code session-start hooks
vscode-extension/               VS Code integration (shells out to CLI)
.claude-plugin/                 Plugin manifests
```

## Workflow Pipeline

The repo-level operator pipeline and the persisted state machine are related but not identical. The full operator pipeline includes planning/reporting steps such as `tech-decide`, `retro`, and `ship`, while `workflowStage` tracks the execution-critical subset that is enforced in state.

Repo-level pipeline:

<!-- DANTEFORGE_REPO_PIPELINE:START -->
```text
review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship
```
<!-- DANTEFORGE_REPO_PIPELINE:END -->

Persisted workflow state machine:

<!-- DANTEFORGE_STATE_MACHINE:START -->
```
initialized -> review -> constitution -> specify -> clarify -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize
```
<!-- DANTEFORGE_STATE_MACHINE:END -->

- **review** â€” Scan an existing repo and capture the current baseline
- **constitution** â€” Establish project principles and constraints
- **specify** â€” Write the specification artifact
- **clarify** â€” LLM-assisted spec refinement with interactive Q&A
- **tech-decide** â€” Record or confirm the stack decisions that shape implementation
- **plan** â€” Generate an execution plan scored by PDSE
- **tasks** â€” Break the plan into discrete work items
- **design** â€” Produce design artifacts (.op format for Design-as-Code)
- **forge** â€” Execute tasks via multi-agent orchestration (party mode)
- **ux-refine** â€” Push live UI to Figma for visual iteration via MCP
- **verify** â€” Run quality gates (typecheck, lint, tests, anti-stub scan)
- **synthesize** â€” Generate summary artifacts and handoff documents
- **retro / ship** â€” Close the loop with project learning and release planning once verification is complete

Build first, then refine visually. UX-refine runs after forge because you need live UI to push to Figma.

## Three-Mode Execution

Every command supports three execution modes, enabling use across diverse environments:

1. **Direct API** â€” Requires `isLLMAvailable() === true`. The command calls the configured LLM provider directly and writes artifacts to the project state.

2. **`--prompt` mode** â€” Generates copy-paste prompt text in `.danteforge/prompts/`. The user can paste this into any LLM interface manually.

3. **Local fallback** â€” Deterministic offline artifact generation using templates and heuristics. No network access required.

This three-mode design ensures DanteForge remains functional without API keys, in air-gapped environments, and during provider outages.

## Configuration Hierarchy

Configuration is resolved in the following precedence order (highest to lowest):

1. **Environment variables** â€” `DANTEFORGE_HOME`, provider API keys (`OLLAMA_HOST`, `GROK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`)
2. **User-level config** â€” `~/.danteforge/config.yaml` stores API keys, default provider, and user preferences
3. **Project state** â€” `./.danteforge/STATE.yaml` tracks the current project phase, tasks, audit log, and pipeline progress

User-level config is never committed to source control. Project state is project-scoped and may be committed.

## Key Patterns

### Hard Gates

Gates prevent out-of-order execution and enforce workflow discipline. Each gate checks a prerequisite before allowing a command to proceed:

- `requireConstitution` â€” Blocks commands that depend on project principles
- `requireSpec` â€” Blocks commands that depend on a written specification
- `requirePlan` â€” Blocks commands that depend on an execution plan
- `requireTests` â€” Blocks commands that depend on passing tests

Gates can be bypassed with `--light` for rapid prototyping, but this is logged in the audit trail.

### Anti-Stub Doctrine

No `TODO`, `FIXME`, or `TBD` markers are permitted in shipped implementation paths. The anti-stub scan runs as part of `verify` and release checks. PDSE Clarity scoring floors artifact quality when stub markers appear.

### PDSE Scoring

The Planning Document Scoring Engine evaluates planning artifacts across 6 dimensions, producing a quality rubric that drives completion tracking and gates release readiness.

### Titan Harvest V2

Constitutional pattern harvesting with hash-verifiable immutable tracks. Every 5 harvest tracks triggers a meta-evolution prompt for framework self-improvement.

### Safe Self-Edit

The safe self-edit protocol guards protected file paths behind a gate. All edits to protected paths are recorded in an NDJSON audit log, ensuring traceability.

### Lessons System

`.danteforge/lessons.md` captures corrections and failures discovered during execution. Lessons auto-compact over time and are injected into forge, party mode, and tech-decide prompts for self-improving behavior.

## Extension Points

### Skills

Skills are discovered at runtime from `SKILL.md` files with YAML frontmatter. Each skill defines its name, description, trigger conditions, and prompt template. Skills live in `src/harvested/dante-agents/skills/<name>/SKILL.md`.

### LLM Providers

New providers are added via dynamic SDK loading in `src/core/llm.ts`. The provider interface is uniform: each provider implements a common `chat()` contract. Currently supported: Ollama (default/local), Grok, Claude, OpenAI, Gemini.

### Commands

New commands are registered through Commander.js in `src/cli/index.ts`. Each command is a single async function in `src/cli/commands/`. Commands automatically inherit three-mode execution, state access, and gate enforcement.
