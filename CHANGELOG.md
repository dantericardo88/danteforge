# Changelog

All notable changes to DanteForge are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [0.10.0] — 2026-04-05

### Added
- 18-dimension scoring matrix (expanded from 12): specDrivenPipeline, convergenceSelfHealing, tokenEconomy, ecosystemMcp, enterpriseReadiness, communityAdoption
- 27-competitor benchmark universe (expanded from 17): Kiro, Codex CLI, Gemini CLI, GitHub Copilot CLI, Goose, Replit Agent, Zencoder, Qodo 2.0, Dagger, Kilo Code
- DanteError hierarchy: DanteError base + ConfigError, ValidationError, FileError, NetworkError, CLIError, LLMError, BudgetError
- withErrorBoundary() wrapper — all 42 CLI commands now produce structured error output with remedies
- formatAndLogError() — consistent error formatting with remedy line
- audit-export command — reads STATE.yaml audit log, supports JSON/CSV/Markdown output and --since date filter
- StepTracker — [N/total] step progress format across long-running commands
- workflow command — visual 11-stage pipeline with current position indicator
- input-validation module — sanitizePath (path traversal), validateProviderName, validateSubcommand
- logger.errorWithRemedy() — red [ERR] line + yellow Remedy: line
- premium tier enforcement scaffolding — free/pro/enterprise gate definitions

### Changed
- Scoring weights rebalanced across 18 dimensions (sum = 1.0)
- assess report now shows all 18 dimensions with competitor gap analysis
- completion-target updated to reference 18-dimension mode
- init command now uses interactive step-by-step wizard with spinner feedback
- Error output standardized: all errors route through formatAndLogError

### Fixed
- Windows path sanitization: path.normalize(base) + path.sep for reliable traversal detection
- DanteState optional field access: safe dynamic access pattern for new scoring dimensions

## [0.9.0] — 2026-03-23 (Swarm Edition)

### Added
- Token routing: 3-tier local/light/heavy task classification
- Parallel execution engine: headless-spawner + agent-dag (Kahn topological sort)
- Budget controls: complexity-classifier, BudgetFence, execution telemetry, cost command
- MCP server: 15 tools via @modelcontextprotocol/sdk
- Circuit breaker: per-provider CLOSED/OPEN/HALF_OPEN state with exponential backoff
- State cache: TTL-based in-memory cache for loadState/saveState
- LLM pipeline: decomposed callLLM into 6 pipeline stages
- Nova preset: between blaze and inferno, 9 steps, ~$3.00 budget
- Canvas preset: design-first, 5 steps, ~$0.75 budget
- Convergence loops: verify→repair cycles baked into all magic presets (spark=0...inferno=3)
- 7 Levels Deep root cause engine: per-step failure analysis in autoforge

### Changed
- Magic presets expanded to 7: spark, ember, canvas, magic, blaze, nova, inferno
- All 6 providers get token usage tracking via onUsage callback
- autoforge loop now uses complexity-classifier for task routing decisions

### Fixed
- party-mode.ts god-file decomposed (40%→78% coverage)
- subagent-isolator injection seams added (60%→95% coverage)
- verifier injection seams added (77%→98% coverage)
- safe-self-edit.ts rewritten to fail-closed deny policy by default

## [0.8.0] — 2026-03-15

### Added
- OpenPencil design-as-code engine: 86-tool registry, .op codec, SVG renderer, token extractor
- Figma MCP integration: push/pull design context via Figma MCP server
- Verify receipts: JSON+MD evidence files written to .danteforge/evidence/verify/
- Safe self-edit policy: fail-closed by default with audit trail
- VS Code extension: shells out to CLI with status bar integration
- QA runner: baseline capture, regression detection, quality score reporting

### Changed
- Workflow pipeline: constitution → specify → clarify → tech-decide → plan → tasks → design → forge → ux-refine → verify → synthesize
- All providers dynamically loaded (Ollama, Grok, Claude, OpenAI, Gemini)

## [0.5.0] — 2026-02-01 (Initial Release)

### Added
- Core pipeline: constitution → specify → clarify → plan → tasks → forge → verify → synthesize
- 8-dimension maturity scoring: functionality, testing, errorHandling, security, uxPolish, documentation, performance, maintainability
- 17-competitor benchmark baseline
- Hard gates: requireConstitution, requireSpec, requirePlan, requireTests
- Skills system: YAML frontmatter SKILL.md files, runtime discovery
- LLM providers: Ollama (default), Grok, Claude, OpenAI, Gemini
- Three-mode execution: LLM API, --prompt copy-paste, local fallback
- Lessons system: appendLesson, auto-compact, feeds into forge/party
- Party mode: multi-agent orchestration with worktree isolation
- Retro engine: sprint retrospective generation
- Reflection engine: evidence-based verdict with gate checks
