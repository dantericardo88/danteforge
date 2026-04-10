# Changelog

All notable changes to DanteForge are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [0.15.0] — 2026-04-08 (Evidence Ready Edition)

### Added
- Reliability hardening: circuit breaker wired into callLLM (was dead code), safeWrite logger (broken pipe safe), SIGTERM handler for Docker/k8s, provider fallback chain
- Security hardening: shell command denylist (sanitizeShellCommand), autoforge command allowlist (17 commands), MCP path traversal protection (sanitizePath in resolveCwd), YAML bomb protection (1MB state file limit), prompt injection stripping (stripPromptInjectionMarkers), protected file list expanded 7→12
- dispatchProviderCall extraction from callLLM — enables provider fallback chain without switch duplication
- dispatchWithRetry over-counting fix — recordFailure only on retry exhaustion, not per-attempt
- Real E2E subprocess tests: --version semver check, verify --json with seeded state
- examples/todo-app: working walkthrough project with constitution, spec, and initialized state

### Changed
- Logger: all 7 raw process.stderr/stdout.write() calls replaced with safeWrite()
- SIGTERM registered alongside SIGINT in autoforge-loop (non-win32, symmetric cleanup)
- MCP handlers: _sanitize injection seam threaded through all 25 resolveCwd calls via McpServerDeps
- Protected paths: added llm.ts, prompt-builder.ts, mcp-server.ts, input-validation.ts, circuit-breaker.ts
- State validation: currentPhase enforced as non-negative integer, workflowStage validated against known stages

### Fixed
- Circuit breaker was never called from callLLM — dead providers hammered indefinitely
- dispatchWithRetry opened circuits after 1 failed call chain (3 attempts = 3 failures = threshold met)
- Logger crashed process on broken pipe (7 unguarded .write() calls)
- SIGTERM not handled — Docker/k8s/systemd graceful shutdown failed
- resolveCwd tests used raw Unix paths that failed Windows sanitization
- post-forge-audit tests assumed old 7-file protected list
- help-engine test used string currentPhase rejected by state validation

## [0.14.0] — 2026-04-07

### Added
- Reliability test suite: 18 tests covering circuit breaker integration, SIGTERM handler, safeWrite
- Coverage completion sprint: all 16 runMagicPlanStep arms tested, structure-executor branches, ship.ts + debug.ts injection seams
- LLM error paths test suite: 15 tests covering normalizeProviderError, fetchProviderJson edge cases, per-provider empty responses

### Changed
- .c8rc.json thresholds: lines 84%, branches 79%, functions 88%
- Test count: 4210→4286, coverage: 85.5% lines / 79.1% branches / 89.4% functions

## [0.13.0] — 2026-04-07

### Added
- Security hardening sprint: 55 new tests across 8 groups
- Shell command sanitization with SHELL_METACHARACTERS denylist
- Autoforge ALLOWED_AUTOFORGE_COMMANDS allowlist (17 commands validated before spawnSync)
- State file size guard (MAX_STATE_FILE_SIZE_BYTES = 1MB)
- validateStateSchema auto-repairs corrupt fields (unknown stage, negative phase, oversized auditLog)
- Artifact size guard (MAX_ARTIFACT_SIZE_BYTES = 512KB)
- stripPromptInjectionMarkers: filters [SYSTEM], "Ignore previous", "You are now" patterns
- Lessons index size limit (512KB) with injection stripping

### Changed
- MCP resolveCwd now applies sanitizePath with fail-safe fallback to process.cwd()
- Safe self-edit PROTECTED_PATHS expanded from 7 to 12 files

## [0.12.0] — 2026-04-06

### Added
- v0.23.0 test hardening: fixed slow tests caused by real LLM calls in unit tests
- _sevenLevelsAnalysis, _captureFailureLessons, _isLLMAvailable injection seams for autoforge/executor
- autoforge-step-cases.test.ts (14 tests), autoforge-guidance-markdown.test.ts (12 tests)
- run-agent-llm.test.ts (3 tests), variable-executors-errors.test.ts (16 tests)

### Fixed
- autoforge.test.ts: 717s→1.7s (eliminated real Ollama calls via injection seams)
- executor-state.test.ts: 304s→1.5s (same fix)
- Coverage truth: previous "81.23%" was from partial run; true full-suite = 79.07%

## [0.11.0] — 2026-04-05

### Added
- Enterprise Phase 1: structured audit trail, SBOM generation (validate-sbom.mjs)
- TypeScript strict mode compliance across all source files
- CI live-canary workflow for scheduled provider validation
- GitHub Actions release workflow with semver tag trigger and artifact uploads

### Changed
- Build pipeline: tsup with obfuscation, dev-sync opt-in (removed hardcoded path)

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
