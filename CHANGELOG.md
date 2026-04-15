# Changelog

All notable changes to DanteForge are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [0.17.0] — 2026-04-13 (Sprint 30 — 5 Exceptional Flows)

### Added
- **Flow 1 — Daily Driver**: `danteforge score` (pure-fs, <5 sec, no LLM) + `danteforge prime` (PRIME.md session brief) + `danteforge teach` (correction capture → PRIME.md auto-update) + `danteforge go` (daily driver: self-improve --max-cycles 5 --min-score 9.0) + `proof --since` (score arc report with HTML).
- **Flow 2 — OSS Harvest**: `danteforge harvest-pattern <pattern>` — focused OSS pattern discovery with Y/N confirmation loop, score delta after each implementation, lesson capture.
- **Flow 3 — Multi-Agent**: `_onAgentUpdate` seam in party-mode for live per-agent progress callbacks; post-inferno `prime()` auto-update in magic.ts; `useWhen` field in all 5 WORKFLOWS with updated workflow IDs matching the 5 flows.
- **Flow 4 — Spec-to-Ship**: `danteforge build <spec>` — guided wizard with stage detection (skips completed), optional `--interactive` confirmation, entry/exit score comparison.
- **Flow 5 — Competitive Leapfrog**: `compete --auto` via `actionAutoSprint()` — picks top gap, runs inferno, scores post-sprint, updates matrix, prints victory message when self-score exceeds competitor.
- `scoreHistory?: ScoreHistoryEntry[]` rolling array in `DanteState` with `appendScoreHistory()` pure helper.
- `buildScoreArc()` pure function in proof.ts for `--since` mode.
- 6 new slash command files: `commands/score.md`, `prime.md`, `teach.md`, `go.md`, `harvest-pattern.md`, `build.md`.
- +55 tests (4045 → 4100 projected).

### Changed
- `danteforge flow` workflows updated to reflect the 5 new flows (daily-driver, oss-harvest, multi-agent, spec-to-ship, competitive-leapfrog). Each workflow now has a `useWhen` field.
- `compete` action type extended with `'auto'` variant.
- Version: 0.16.0 → 0.17.0 across all 4 version-stamped files.

## [0.16.0] — 2026-04-13 (Credibility & Guided Path Edition)

### Added
- `danteforge showcase` command — runs the harsh scorer against any project (default: examples/todo-app) and generates `docs/CASE_STUDY.md` with a full 18-dimension scorecard and improvement opportunities. First reproducible external proof.
- `danteforge assess` now tracks session progress: baseline score is stored in STATE.yaml on first run; subsequent runs show "▲ +1.4 since session start" delta line. `--set-baseline` flag resets the baseline.
- `danteforge flow --interactive` is now a real numbered menu picker instead of a static text printout. Select your workflow and get the exact commands to run, copy-pasteable.
- `danteforge self-improve` auto-exports `docs/IMPROVEMENT_REPORT.md` after every run — cycle-by-cycle score arc, before/after summary, and verdict.
- `docs/CASE_STUDY.md` shipped in repo — generated from showcase run against examples/todo-app with real PDSE scores.
- 19 new tests covering all 4 new features (assess-delta: 5, flow-interactive: 5, showcase: 5, self-improve-report: 4).

### Changed
- Version synchronized: package.json + vscode-extension/package.json both at 0.16.0.

## [0.15.1] — 2026-04-13 (Sprint 27+28 Backfill)

### Added
- Sprint 27: Session-start matrix validation — `hooks/session-start.mjs` validates staleness of STATE.yaml on Claude Code session open; autoforge resume command restores paused loops from snapshot.
- Sprint 28: Termination governor wired into `autoforge-loop.ts` — `evaluateTermination()` now called after every cycle; loop exits BLOCKED on plateau (same verdict 3+ cycles), diminishing returns, regression detection. Injection seam `_evaluateTermination` added to `AutoforgeLoopDeps`.
- Sprint 28: `danteforge benchmark` — replaced 3-line stub with full 18-dimension scorecard. Supports `--dimension`, `--compare`, `--format table|json`.
- Sprint 28: Community adoption scoring wired — `fetchCommunityMetrics()` hits GitHub + npm APIs (best-effort, 5s timeout). `computeCommunityAdoptionScore()` scores stars/downloads/contributors. Score is no longer hardcoded 15.
- Sprint 28: `readCoveragePercent()` reads `.danteforge/coverage-summary.json`; testing dimension now blends maturity score (40%) with real coverage % (60%).
- Sprint 28: `danteforge init` detects running IDE from env vars (Cursor, Windsurf, Codex, Copilot, Continue) and offers immediate skill installation.
- Sprint 28: Postinstall now routes new users to `danteforge init` instead of `setup assistants`.

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
