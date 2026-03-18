# DanteForge v0.7.0 — Product Requirements Document
**Status:** Canonical Forge Input | **Version:** 0.7.0 | **Date:** 2026-03-13
**Author:** DanteForge Architecture Council | **Supersedes:** v0.6.0 GA Hardening PRD

---

## D1. EXECUTIVE SUMMARY

### Vision

DanteForge v0.6.0 proved the pipeline. Every stage writes an artifact. Every artifact gets validated. The workflow enforcer never lets you lie about completion. That was the right foundation to build on.

v0.7.0 makes the pipeline intelligent and autonomous. The operator no longer babysits the loop — DanteForge scores every planning artifact on a rubric, tracks project completion as a live percentage, and drives itself forward until the entire PRD is shipped. When it gets stuck it tells you exactly why and what to do. When it finishes, it opens the PR.

This release is the difference between a structured development assistant and a force-multiplier that works while you sleep.

### Three Transformative Bets

**Bet 1 — Browser-Native QA via GStack Integration**
The current verify stage is static: does the file exist? v0.7.0 adds runtime verification. A zero-token-overhead Playwright daemon (inherited from gstack's /browse and /qa skills) navigates live apps, captures screenshots as evidence, runs health-score passes, and writes regression baselines. The QA health score (0–100) flows directly into the completion tracker. Web projects cannot reach "verified" without an 80+ health score.

**Bet 2 — Intelligent Planning Document Scoring (PDSE)**
Every artifact — CONSTITUTION.md, SPEC.md, CLARIFY.md, PLAN.md, TASKS.md — is scored by the Planning Document Scoring Engine across six dimensions: Completeness, Clarity, Testability, Constitution Alignment, Integration Fitness, Freshness. A score below 50 blocks the pipeline. A score of 50–69 triggers targeted remediation suggestions. A score of 70+ lets Autoforge advance. The operator gets a precise numeric explanation for every gate, not a binary pass/fail.

**Bet 3 — Autonomous Project Completion Loop (Autoforge v2 IAL)**
The --auto flag turns Autoforge into an Intelligent Autonomous Loop. It runs until overall project completion reaches 95% or hits a BLOCKED state. It re-runs commands in --refine mode when scores are low, auto-selects the next stage, invokes QA after forge waves, and triggers the ship pipeline when done. Every decision is written to the audit log. SIGINT stops it gracefully. The operator's only required inputs are the initial goal and final --force override if needed.

### Operator Impact

Target persona: the solo founder / 1-person agentic team running DanteForge over a real product codebase. Today they run 8–12 commands manually, inspect each artifact, decide what to do next. v0.7.0 collapses that to: `danteforge autoforge "build X" --auto`. They check back to review BLOCKED items and approve the ship.

### Success Metrics for v0.7.0 Release

1. `danteforge autoforge "build X" --auto` completes a full planning → forge → verify → synthesize cycle unattended on the DanteForge self-referential project.
2. PDSE scores 5 known-good artifacts at ≥ 80 and 5 known-bad artifacts at ≤ 55 without manual tuning.
3. `danteforge browse goto https://example.com && danteforge browse screenshot` executes in < 5 seconds on a machine with the gstack binary installed.
4. `danteforge qa --url https://staging.example.com` produces a JSON health report with score ≥ 0 within 60 seconds.
5. Total test count ≥ 512 with zero failures on `npm test`.
6. All existing v0.6.0 command surfaces are unchanged (no flag renames, no removed flags).

---

## D2. FULL FEATURE SPECIFICATION

---

### FEATURE 1: Browser Automation (`danteforge browse`)

#### User Story
As a solo founder running DanteForge on a web project, I want to inspect and interact with my live staging environment from within the DanteForge pipeline so that verification is based on real runtime behavior, not just file existence.

#### Acceptance Criteria
1. `danteforge browse goto https://staging.myapp.com` navigates the headless browser and returns status within 5 seconds on first call (daemon cold start) and < 500ms on subsequent calls.
2. `danteforge browse screenshot` saves a PNG to `.danteforge/evidence/screenshot-{timestamp}.png` and prints the file path to stdout.
3. `danteforge browse snapshot --diff` stores the accessibility tree baseline on first call; on second call returns a unified diff showing what changed.
4. If the gstack browse binary is not found, the command exits with code 1 and prints: `Browse binary not found. Install with: danteforge browse --install` with platform-specific instructions.
5. `danteforge browse diff https://staging.example.com https://production.example.com` produces a text diff of the two pages' accessibility trees.
6. Multi-workspace isolation works: two concurrent `danteforge party` sessions use separate browser daemon ports derived from worktree context.
7. `danteforge verify --live --url https://staging.myapp.com` runs `browse goto + snapshot --diff` as a substage and appends screenshot paths to the verify output and STATE.yaml audit log.
8. All browse commands operate on localhost daemon only — no external telemetry, satisfying local-first constitution principle.

#### Technical Design

**New files:**
- `src/cli/commands/browse.ts` — commander.js command registration, delegates to adapter
- `src/core/browse-adapter.ts` — binary detection, invocation, response parsing
- `src/harvested/gstack-harvest/skills/browser-inspect/SKILL.md` — harvested + DanteForge-wrapped skill
- `src/harvested/gstack-harvest/skills/browser-inspect/checklist.md` — QA checklist reference

**Modified files:**
- `src/cli/index.ts` — register `browse` command, add `--live --url <url>` to `verify` and `ux-refine`
- `src/cli/commands/verify.ts` — add `--live` flag, call `invokeBrowse` at verify substage
- `src/cli/commands/ux-refine.ts` — add `--live` flag, call `invokeBrowse` for UX evidence capture
- `src/core/autoforge.ts` → `src/core/autoforge-loop.ts` — invoke browser substage for web projects

**TypeScript interfaces (src/core/browse-adapter.ts):**
```typescript
export type BrowseSubcommand =
  | 'goto' | 'screenshot' | 'text' | 'html' | 'links' | 'forms'
  | 'accessibility' | 'click' | 'fill' | 'select' | 'snapshot'
  | 'js' | 'eval' | 'css' | 'attrs' | 'console' | 'network'
  | 'dialog' | 'cookies' | 'storage' | 'perf' | 'diff'
  | 'chain' | 'cookie-import' | 'tabs' | 'newtab' | 'closetab';

export interface BrowseAdapterConfig {
  binaryPath: string;
  port?: number;           // default: 9400, or derived from worktree context
  workspaceId?: string;    // for multi-workspace isolation
  timeoutMs?: number;      // default: 10000
  evidenceDir?: string;    // default: .danteforge/evidence/
}

export interface BrowseResult {
  success: boolean;
  stdout: string;
  exitCode: number;
  evidencePath?: string;  // set when screenshot/pdf was written
  errorMessage?: string;
}

export async function detectBrowseBinary(): Promise<string | null>;
export async function invokeBrowse(
  subcommand: BrowseSubcommand,
  args: string[],
  config: BrowseAdapterConfig
): Promise<BrowseResult>;
export function getBrowsePort(worktreeId?: string): number;
export function getBrowseInstallInstructions(platform: NodeJS.Platform): string;
```

**Commander registration (src/cli/index.ts addition):**
```typescript
program
  .command('browse <subcommand> [args...]')
  .description('Browser automation — navigate, screenshot, inspect live apps')
  .option('--url <url>', 'Target URL (shorthand for goto)')
  .option('--install', 'Install the gstack browse binary for this platform')
  .option('--port <port>', 'Override browse daemon port', '9400')
  .action(browseCommand);
```

#### Constitution Compliance
- Local-first: daemon binds to localhost only, no remote endpoints, bearer token in chmod 600 state file.
- Fail-closed: binary absence = exit code 1 with actionable message, never silently continues.
- Zero-ambiguity: evidence screenshots are written to .danteforge/evidence/ with ISO timestamp filenames, paths logged to audit.

#### Integration Touchpoints
- `verify --live`: calls `invokeBrowse('goto', [url])` then `invokeBrowse('snapshot', ['--diff'])` after all artifact checks pass.
- `ux-refine --live`: calls `invokeBrowse('screenshot')` and `invokeBrowse('accessibility')` to produce visual evidence for UX review.
- Autoforge loop: detects `projectType: 'web'` in STATE.yaml, includes browse substage in verification phase.
- PDSE Testability dimension: presence of `.danteforge/evidence/*.png` improves Testability score for web projects.

---

### FEATURE 2: Structured QA with Health Scores (`danteforge qa`)

#### User Story
As an operator shipping a web application, I want DanteForge to run a structured QA pass on my live app and give me a numeric health score with ranked issues so that I know exactly what is broken before I ship, and Autoforge can gate the release on quality.

#### Acceptance Criteria
1. `danteforge qa --url https://staging.myapp.com` produces `.danteforge/qa-report.json` within 90 seconds containing: `{ score: number, issues: Issue[], screenshots: string[], timestamp: string }`.
2. `danteforge qa --url ... --type regression --baseline .danteforge/qa-baseline.json` compares against a prior baseline and reports regressions as a diff.
3. `danteforge qa --url ... --type quick` runs a reduced pass (navigation + screenshot + accessibility check only) in under 30 seconds.
4. `STATE.yaml` is updated with `qaHealthScore` and `qaLastRun` after every successful QA run.
5. `danteforge qa --save-baseline` writes `.danteforge/qa-baseline.json` from the current report — establishing the regression baseline.
6. If the health score is below 80 and `--fail-below 80` is set, the command exits with code 1.
7. Autoforge invokes `danteforge qa` automatically after each `forge` wave when `projectType: 'web'` is in STATE.yaml.
8. QA report issues are ranked: Critical (blocks ship), High, Medium, Informational.
9. If browse binary is absent, `danteforge qa` exits code 1 with install instructions — identical to `danteforge browse` binary-missing behavior.

#### Technical Design

**New files:**
- `src/cli/commands/qa.ts` — commander.js registration, orchestrates browse + scoring
- `src/core/qa-runner.ts` — QA pass orchestration (full, quick, regression modes)
- `src/core/qa-scorer.ts` — converts browse outputs to health score + ranked issues
- `src/harvested/gstack-harvest/skills/qa-lead/SKILL.md` — harvested + wrapped QA skill
- `src/harvested/gstack-harvest/skills/qa-lead/checklist.md` — QA issue checklist

**Modified files:**
- `src/core/state.ts` — add `qaHealthScore`, `qaBaseline`, `qaLastRun`, `projectType` to DanteForgeState
- `src/core/autoforge-loop.ts` — call qa runner after forge wave when projectType === 'web'
- `src/core/pdse.ts` — use qaHealthScore in Testability dimension scoring

**TypeScript interfaces (src/core/qa-runner.ts):**
```typescript
export type QARunMode = 'full' | 'quick' | 'regression';

export interface QAIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'informational';
  category: string;
  description: string;
  element?: string;
  screenshotPath?: string;
  remediation: string;
}

export interface QAReport {
  score: number;           // 0–100
  mode: QARunMode;
  url: string;
  timestamp: string;
  issues: QAIssue[];
  screenshots: string[];
  regressions?: QAIssue[];  // set when mode === 'regression'
  baselineCompared?: string; // path to baseline used
}

export interface QARunOptions {
  url: string;
  mode: QARunMode;
  baselinePath?: string;
  saveBaseline?: boolean;
  failBelow?: number;
  evidenceDir: string;
  browseConfig: BrowseAdapterConfig;
}

export async function runQAPass(options: QARunOptions): Promise<QAReport>;
export async function saveQABaseline(report: QAReport, path: string): Promise<void>;
export function computeQAScore(issues: QAIssue[]): number;
```

**Commander registration:**
```typescript
program
  .command('qa')
  .description('Structured QA pass with health score on live app')
  .requiredOption('--url <url>', 'Staging or production URL to test')
  .option('--type <mode>', 'QA mode: full | quick | regression', 'full')
  .option('--baseline <path>', 'Baseline JSON for regression comparison')
  .option('--save-baseline', 'Save current report as new baseline')
  .option('--fail-below <score>', 'Exit code 1 if score below threshold', '0')
  .action(qaCommand);
```

#### Constitution Compliance
- Fail-closed: score below threshold with `--fail-below` = exit code 1, Autoforge treats as BLOCKED if qaScore < 80 and isWebProject.
- Evidence chain: all QA screenshots and JSON reports stored in `.danteforge/` with timestamps.
- Local-first: QA runs entirely through local browse daemon — no external reporting services.

#### Integration Touchpoints
- Autoforge loop: inserted between `forge` wave completion and `verify` stage for web projects.
- PDSE: `qaHealthScore` contributes to Testability dimension of verification phase score.
- `verify --live`: appends QA health score to verify output if qa-report.json exists and is fresh (< 24h).
- completionTracker: `verification.qaScore` field sourced directly from latest qa-report.json.

---

### FEATURE 3: Retrospectives with Metrics (`danteforge retro`)

#### User Story
As a solo founder who has just shipped a project phase, I want DanteForge to analyze what happened — commits, test coverage, LOC, lessons — and give me a scored retrospective with a delta from the last retro so that I can track whether my process is improving over time.

#### Acceptance Criteria
1. `danteforge retro` produces `.danteforge/retros/retro-{timestamp}.json` and a human-readable `.danteforge/retros/retro-{timestamp}.md` after every invocation.
2. The retro JSON includes: `{ timestamp, commitCount, locAdded, locRemoved, testCoveragePercent, lessonsAdded, score, delta, praise, growthAreas }`.
3. When a prior retro JSON exists in `.danteforge/retros/`, the new retro includes a `delta` field showing improvement or regression against the most recent prior retro.
4. `danteforge retro --summary` prints a one-page text summary of the last 5 retros with trend indicators (↑ improving, ↓ regressing, → stable).
5. Autoforge invokes `danteforge retro` automatically at the `synthesize` stage.
6. `lessons-index.ts` is updated to include retro delta data alongside manual lesson entries.
7. Retro JSON contains no PII — no author names, email addresses, or external identifiers. Only commit hashes (truncated to 8 chars) and aggregate metrics.
8. `STATE.yaml` is updated with `retroDelta` (numeric, positive = improving) after every retro run.

#### Technical Design

**New files:**
- `src/cli/commands/retro.ts` — commander.js registration
- `src/core/retro-engine.ts` — git analysis, metric computation, delta comparison, JSON/MD generation
- `src/harvested/gstack-harvest/skills/retro/SKILL.md` — harvested + wrapped retro skill

**Modified files:**
- `src/core/state.ts` — add `retroDelta: number`, `retroLastRun: string` to DanteForgeState
- `src/core/lessons-index.ts` — add `indexRetroMetrics(retroPath: string)` function
- `src/core/autoforge-loop.ts` — invoke retro after synthesize stage

**TypeScript interfaces (src/core/retro-engine.ts):**
```typescript
export interface RetroMetrics {
  commitCount: number;
  locAdded: number;
  locRemoved: number;
  testCoveragePercent: number | null;
  lessonsAdded: number;
  wavesCompleted: number;
}

export interface RetroReport {
  timestamp: string;
  metrics: RetroMetrics;
  score: number;          // 0–100 composite
  delta: number | null;   // null if no prior retro
  praise: string[];       // 2–4 bullet points
  growthAreas: string[];  // 2–4 bullet points
  priorRetroPath: string | null;
}

export async function runRetro(cwd: string): Promise<RetroReport>;
export async function loadPriorRetro(retroDir: string): Promise<RetroReport | null>;
export function computeRetroScore(metrics: RetroMetrics): number;
export function computeRetroDelta(current: RetroReport, prior: RetroReport): number;
export async function writeRetroFiles(report: RetroReport, retroDir: string): Promise<{ jsonPath: string; mdPath: string }>;
```

**Commander registration:**
```typescript
program
  .command('retro')
  .description('Project retrospective with metrics, delta scoring, and trend tracking')
  .option('--summary', 'Print trend summary of last 5 retros')
  .option('--cwd <path>', 'Project directory', process.cwd())
  .action(retroCommand);
```

#### Constitution Compliance
- PIPEDA: no PII stored — commit hashes truncated, no author names or emails in any output.
- Local-first: all analysis is git-local, no external services called.
- Audit trail: each retro run appended to STATE.yaml audit log with timestamp and score.

#### Integration Touchpoints
- Autoforge loop: called after `synthesize` stage; retroDelta written to STATE.yaml.
- PDSE: synthesis phase completion includes `retroDelta !== null` as a completeness check.
- lessons-index: `indexRetroMetrics()` called after retro write, merging growth areas into lessons corpus.
- completionTracker: `synthesis.retroDelta` sourced from STATE.yaml `retroDelta` field.

---

### FEATURE 4: Founder/CEO Intent Elevation (`--ceo-review` flag)

#### User Story
As a founder, I want DanteForge to challenge my specification before I build it — to ask whether I'm solving the right problem at the right level — so that I don't spend 40 forge waves implementing a locally optimal solution to a strategically irrelevant problem.

#### Acceptance Criteria
1. `danteforge specify "<goal>" --ceo-review` runs an additional LLM pass before writing SPEC.md that applies the 10-star product framework: asks "what would the best possible version of this look like?" and rewrites the spec to aim at that.
2. `danteforge plan --ceo-review` applies the same elevation to the PLAN.md — questioning whether the plan's phases reflect the highest-leverage order of work.
3. When Autoforge detects that the goal string contains ≥ 3 ambiguity signals (words: "something", "kind of", "maybe", "probably", "might", "could", "a bit", "somehow"), it automatically applies `--ceo-review` to the specify stage and logs the decision to the audit log.
4. The CEO review output is appended as a `## CEO Review Notes` section to SPEC.md, not replacing the spec — so the operator can see both the original framing and the elevated version.
5. `danteforge brainstorm --ceo-review` activates the CEO review elevation at the divergent thinking phase.
6. PDSE Clarity scoring gives a +5 bonus (capped at dimension max) when `## CEO Review Notes` is present in SPEC.md.
7. If `--ceo-review` is passed but no LLM is configured (`--prompt` mode), the command prints the CEO review prompt to stdout for manual execution and writes it to `.danteforge/CEO_REVIEW_PROMPT.md`.

#### Technical Design

**New files:**
- `src/harvested/gstack-harvest/skills/ceo-review/SKILL.md` — harvested + wrapped CEO review skill
- `src/core/ceo-review-engine.ts` — ambiguity detection, elevation prompt construction, LLM invocation

**Modified files:**
- `src/cli/commands/specify.ts` — add `--ceo-review` flag
- `src/cli/commands/plan.ts` — add `--ceo-review` flag
- `src/cli/commands/brainstorm.ts` (commands/brainstorm.md) — add CEO review to divergent phase
- `src/core/autoforge-loop.ts` — ambiguity detection logic, auto-apply CEO review
- `src/core/pdse.ts` — CEO Review Notes bonus in Clarity scoring

**TypeScript interfaces (src/core/ceo-review-engine.ts):**
```typescript
export const AMBIGUITY_SIGNALS = [
  'something', 'kind of', 'maybe', 'probably', 'might', 'could',
  'a bit', 'somehow', 'sort of', 'roughly', 'approximately', 'TBD',
  'figure out', 'not sure', 'unclear'
] as const;

export interface CEOReviewResult {
  originalGoal: string;
  elevatedVision: string;
  challengingQuestions: string[];
  tenStarVersion: string;
  ambiguitySignalsFound: string[];
  wasAutoTriggered: boolean;
}

export function detectAmbiguitySignals(text: string): string[];
export function shouldAutoCEOReview(goal: string): boolean;
export async function runCEOReview(goal: string, specContent: string, llm: LLMClient): Promise<CEOReviewResult>;
export function formatCEOReviewSection(result: CEOReviewResult): string;
```

**Commander registration additions:**
```typescript
// specify command — add flag:
.option('--ceo-review', 'Apply founder/CEO intent elevation before writing SPEC.md')

// plan command — add flag:
.option('--ceo-review', 'Apply CEO-level strategic review before writing PLAN.md')
```

#### Constitution Compliance
- Zero-ambiguity: the feature's explicit purpose is to reduce ambiguity in specs — directly enforces the constitution's first principle.
- Non-destructive: CEO review is appended to artifacts, never replaces operator-written content.
- Prompt-mode fallback: if no LLM, writes the prompt for human execution — no silent degradation.

#### Integration Touchpoints
- Autoforge loop: ambiguity detection runs on initial goal string before first `specify` invocation.
- brainstorm: CEO review activates at divergent thinking phase via `--ceo-review` flag.
- PDSE: Clarity dimension gets +5 bonus for CEO Review Notes presence.

---

### FEATURE 5: Paranoid Systemic Review + Ship Automation (`danteforge ship`)

#### User Story
As an operator ready to ship, I want a single command that runs a two-pass security and quality audit, bumps the version intelligently, generates a CHANGELOG from the diff, creates bisectable commits, pushes, and opens a PR — so that shipping is a one-command act with full traceability.

#### Acceptance Criteria
1. `danteforge ship` runs a two-pass review before any git operations: Pass 1 (CRITICAL) covers SQL injection risks, LLM output trust boundaries, auth bypass risks. Pass 2 (INFORMATIONAL) covers race conditions, N+1 queries, missing error boundaries.
2. For each CRITICAL issue found, the operator is prompted: (A) Fix now, (B) Acknowledge and ship anyway, (C) False positive — skip. Choosing A applies the fix, choosing B or C adds a `## Known Issues` section to the PR body.
3. Version bump is auto-decided: < 50 lines changed → MICRO, 50+ lines → PATCH, major features or breaking changes → ask the operator for MINOR or MAJOR.
4. CHANGELOG is auto-generated from `git diff` and commit history — operator is never asked to describe changes manually.
5. Commits are split for bisectability: infrastructure → models/services → controllers/views → VERSION + CHANGELOG.
6. `danteforge ship --dry-run` runs all checks and generates the commit plan but does not push or create the PR.
7. Autoforge invokes `danteforge ship --dry-run` as the final gate when `overall_completion >= 95%`.
8. `danteforge ship` integrates with DanteForge's existing `npm run verify` and `npm run release:check` — both must pass before any git operations.
9. The PR body includes: Summary bullets, Pre-Landing Review findings, Test plan with pass/fail counts.
10. Enhanced `agents/code-reviewer.md` uses the two-pass CRITICAL/INFORMATIONAL structure for all code review agent invocations.

#### Technical Design

**New files:**
- `src/cli/commands/ship.ts` — commander.js registration, orchestrates all 8 ship steps
- `src/core/ship-engine.ts` — version bumping, CHANGELOG generation, commit splitting, PR creation
- `src/core/paranoid-review.ts` — two-pass audit logic, issue categorization, interactive resolution
- `src/harvested/gstack-harvest/skills/paranoid-review/SKILL.md` — harvested + wrapped review skill
- `src/harvested/gstack-harvest/skills/paranoid-review/checklist.md` — CRITICAL/INFORMATIONAL checklist

**Modified files:**
- `agents/code-reviewer.md` — restructure with PASS 1 CRITICAL / PASS 2 INFORMATIONAL structure
- `src/core/autoforge-loop.ts` — invoke `ship --dry-run` at loop completion

**TypeScript interfaces (src/core/ship-engine.ts):**
```typescript
export type BumpLevel = 'micro' | 'patch' | 'minor' | 'major';

export interface ShipPlan {
  bumpLevel: BumpLevel;
  newVersion: string;
  changelogEntry: string;
  commitGroups: CommitGroup[];
  reviewFindings: ReviewFinding[];
  prTitle: string;
  prBody: string;
}

export interface CommitGroup {
  message: string;
  files: string[];
  type: 'infrastructure' | 'models' | 'controllers' | 'version-changelog';
}

export async function runShip(options: ShipOptions): Promise<void>;
export async function buildShipPlan(cwd: string, dryRun: boolean): Promise<ShipPlan>;
export function autoDecideBumpLevel(linesChanged: number): BumpLevel | null;
export async function generateChangelog(cwd: string): Promise<string>;
export async function splitCommits(plan: ShipPlan, cwd: string): Promise<void>;
export async function createPR(plan: ShipPlan, cwd: string): Promise<string>;
```

**TypeScript interfaces (src/core/paranoid-review.ts):**
```typescript
export type ReviewSeverity = 'critical' | 'informational';
export type ReviewResolution = 'fix' | 'acknowledge' | 'false-positive';

export interface ReviewFinding {
  severity: ReviewSeverity;
  category: string;
  filePath: string;
  lineNumber?: number;
  description: string;
  recommendation: string;
  resolution?: ReviewResolution;
}

export interface ReviewResult {
  critical: ReviewFinding[];
  informational: ReviewFinding[];
  summary: string;
}

export async function runParanoidReview(diffText: string, llm: LLMClient): Promise<ReviewResult>;
export async function resolveFindings(findings: ReviewFinding[]): Promise<ReviewFinding[]>;
```

**Commander registration:**
```typescript
program
  .command('ship')
  .description('Paranoid review + version bump + CHANGELOG + bisectable commits + PR')
  .option('--dry-run', 'Run all checks and generate plan without pushing')
  .option('--skip-review', 'Skip pre-landing review (emergency only, logged to audit)')
  .option('--branch <name>', 'Target branch for PR', 'main')
  .action(shipCommand);
```

#### Constitution Compliance
- Fail-closed: CRITICAL issues without resolution block ship (unless explicitly acknowledged with audit trail).
- Audit trail: all paranoid review findings, resolutions, and ship decisions written to STATE.yaml audit log.
- Atomic commits: commit splitting enforces atomic, bisectable units — directly supports constitution principle.

#### Integration Touchpoints
- Autoforge loop: `ship --dry-run` is the completion gate; full `ship` is operator-triggered after 95% completion.
- verify: ship respects existing `npm run verify` and `npm run release:check` as prerequisites.
- agents/code-reviewer.md: paranoid review structure replaces the existing two-stage review prompts.

---

### FEATURE 6: Autoforge v2 — Intelligent Autonomous Loop (IAL)

#### User Story
As a solo founder, I want to give DanteForge a goal and have it plan, build, test, verify, and ship the project autonomously — pausing only when a genuine decision requires me — so that I can operate at the speed of a team.

#### Acceptance Criteria
1. `danteforge autoforge "build X" --auto` runs the full pipeline (review → constitution → specify → clarify → plan → tasks → forge → verify → synthesize) unattended until `overall_completion >= 95%` or a BLOCKED state.
2. `danteforge autoforge --score-only` scores all existing artifacts and writes `.danteforge/AUTOFORGE_GUIDANCE.md` without executing any pipeline stages.
3. When any artifact scores below 70, Autoforge re-runs its generating command with `--refine` mode, injecting the PDSE score and remediation suggestions as context. After 3 failed refine attempts, the artifact is marked BLOCKED.
4. `STATE.yaml` is updated after every loop cycle with the current `completionTracker` including overall %, per-phase %, and `projectedCompletion` string.
5. `.danteforge/AUTOFORGE_GUIDANCE.md` is written after every cycle with: overall %, current bottleneck, blocking issues with specific remediation commands, recommended next action, auto-advance eligibility, estimated steps to completion.
6. SIGINT (Ctrl+C) during `--auto` run triggers graceful shutdown: current step completes or aborts cleanly, STATE.yaml is written, exit code 0 with message "Autoforge interrupted — progress saved."
7. `danteforge autoforge --dry-run` shows the deterministic next step without executing — unchanged from v0.6.0.
8. The loop logs every decision to `memory.json` with category `'autoforge-loop'`.
9. `--force` flag overrides a BLOCKED state for one cycle, writing the override to the audit log.
10. On loop completion (`overall >= 95%`), a summary table is printed: artifact name, score, decision, and `danteforge ship --dry-run` is invoked as the final gate.

#### Technical Design

**New/modified files:**
- `src/core/autoforge-loop.ts` — new file: IAL state machine, loop algorithm
- `src/core/pdse.ts` — new file: Planning Document Scoring Engine
- `src/core/completion-tracker.ts` — new file: completion computation, projectedCompletion
- `src/cli/commands/autoforge.ts` — add `--auto`, `--score-only`, `--force` flags
- `src/core/autoforge.ts` — refactor: delegates loop execution to autoforge-loop.ts

**TypeScript interfaces (src/core/autoforge-loop.ts):**
```typescript
export enum AutoforgeLoopState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  SCORING = 'SCORING',
  REFINING = 'REFINING',
  BLOCKED = 'BLOCKED',
  COMPLETE = 'COMPLETE'
}

export interface AutoforgeLoopContext {
  goal: string;
  cwd: string;
  state: DanteForgeState;
  loopState: AutoforgeLoopState;
  cycleCount: number;
  startedAt: string;
  retryCounters: Record<string, number>;  // artifact name → retry count
  blockedArtifacts: string[];
  lastGuidance: AutoforgeGuidance;
  isWebProject: boolean;
  force: boolean;
}

export interface AutoforgeGuidance {
  timestamp: string;
  overallCompletion: number;
  currentBottleneck: string;
  blockingIssues: BlockingIssue[];
  recommendedCommand: string;
  recommendedReason: string;
  autoAdvanceEligible: boolean;
  autoAdvanceBlockReason?: string;
  estimatedStepsToCompletion: number;
}

export interface BlockingIssue {
  severity: 'BLOCKED' | 'NEEDS_WORK';
  artifactOrStage: string;
  dimension: string;
  score: number;
  maxScore: number;
  description: string;
  remediationCommand: string;
}

export async function runAutoforgeLoop(ctx: AutoforgeLoopContext): Promise<void>;
export async function runScoreOnlyPass(cwd: string): Promise<AutoforgeGuidance>;
export function writeGuidanceFile(guidance: AutoforgeGuidance, cwd: string): Promise<void>;
export function computeEstimatedSteps(ctx: AutoforgeLoopContext): number;
```

**State machine transitions:**
```
IDLE        → RUNNING       : --auto flag, overall_completion < 95%
RUNNING     → SCORING       : stage execution complete
SCORING     → RUNNING       : score >= 70 (advance)
SCORING     → REFINING      : 50 <= score < 70 (needs work, retry <= 2)
SCORING     → BLOCKED       : score < 50, OR retry >= 3
REFINING    → SCORING       : refine command executed
REFINING    → BLOCKED       : retry counter >= 3
RUNNING     → COMPLETE      : overall_completion >= 95%
BLOCKED     → RUNNING       : --force flag provided
COMPLETE    → IDLE          : loop exits, ship --dry-run invoked
* → IDLE                    : SIGINT received
```

**Commander registration additions:**
```typescript
// autoforge command — add flags:
.option('--auto', 'Run autonomous loop until 95% completion or BLOCKED')
.option('--score-only', 'Score existing artifacts and write guidance without executing stages')
.option('--force', 'Override one BLOCKED artifact (logged to audit)')
```

#### Constitution Compliance
- Fail-closed: BLOCKED state never auto-bypassed without `--force` + explicit audit log entry.
- Zero phantom completions: score file must be confirmed written before loop advances.
- Full audit trail: every cycle decision, score result, refine attempt, and BLOCKED escalation appended to STATE.yaml audit log.
- No ambiguity: AUTOFORGE_GUIDANCE.md always contains a specific, runnable command as the recommended next action.

---

## D3. TECHNICAL ARCHITECTURE

---

### 3a. Updated File Structure

```
src/
├── cli/
│   ├── commands/
│   │   ├── autoforge.ts          MODIFIED — add --auto, --score-only, --force flags
│   │   ├── browse.ts             NEW — browser automation command
│   │   ├── clarify.ts            unchanged
│   │   ├── compact.ts            unchanged
│   │   ├── config.ts             unchanged
│   │   ├── constitution.ts       unchanged
│   │   ├── dashboard.ts          unchanged
│   │   ├── debug.ts              unchanged
│   │   ├── design.ts             unchanged
│   │   ├── doctor.ts             unchanged
│   │   ├── feedback-prompt.ts    unchanged
│   │   ├── forge.ts              unchanged
│   │   ├── help.ts               unchanged
│   │   ├── import.ts             unchanged
│   │   ├── index.ts              unchanged
│   │   ├── lessons.ts            unchanged
│   │   ├── magic.ts              unchanged
│   │   ├── party.ts              unchanged
│   │   ├── plan.ts               MODIFIED — add --ceo-review flag
│   │   ├── qa.ts                 NEW — QA health score command
│   │   ├── retro.ts              NEW — retrospective command
│   │   ├── review.ts             unchanged
│   │   ├── setup-assistants.ts   unchanged
│   │   ├── setup-figma.ts        unchanged
│   │   ├── ship.ts               NEW — paranoid review + ship automation
│   │   ├── skills-import.ts      unchanged
│   │   ├── specify.ts            MODIFIED — add --ceo-review, --refine flags
│   │   ├── synthesize.ts         unchanged
│   │   ├── tasks.ts              unchanged
│   │   ├── tech-decide.ts        unchanged
│   │   ├── update-mcp.ts         unchanged
│   │   ├── ux-refine.ts          MODIFIED — add --live, --url flags
│   │   └── verify.ts             MODIFIED — add --live, --url flags
│   └── index.ts                  MODIFIED — register 4 new commands, new flags
│
├── core/
│   ├── assistant-installer.ts    unchanged
│   ├── autoforge.ts              MODIFIED — delegates loop to autoforge-loop.ts
│   ├── autoforge-loop.ts         NEW — IAL state machine (≤500 lines)
│   ├── browse-adapter.ts         NEW — gstack browse binary wrapper
│   ├── ceo-review-engine.ts      NEW — ambiguity detection + elevation prompts
│   ├── completion-tracker.ts     NEW — completionTracker computation (≤500 lines)
│   ├── config.ts                 unchanged
│   ├── context-injector.ts       unchanged
│   ├── design-rules-engine.ts    unchanged
│   ├── design-rules-helpers.ts   unchanged
│   ├── gates.ts                  unchanged
│   ├── handoff.ts                unchanged
│   ├── lessons-index.ts          MODIFIED — add indexRetroMetrics()
│   ├── llm-cache.ts              unchanged
│   ├── llm-stream.ts             unchanged
│   ├── llm.ts                    unchanged
│   ├── local-artifacts.ts        unchanged
│   ├── logger.ts                 unchanged
│   ├── mcp-adapter.ts            unchanged
│   ├── mcp-parallel.ts           unchanged
│   ├── mcp.ts                    unchanged
│   ├── memory-engine.ts          unchanged
│   ├── memory-store.ts           unchanged
│   ├── paranoid-review.ts        NEW — two-pass audit engine
│   ├── pdse.ts                   NEW — Planning Document Scoring Engine (≤500 lines)
│   ├── pdse-config.ts            NEW — section checklists + scoring config (≤500 lines)
│   ├── prompt-builder.ts         unchanged
│   ├── qa-runner.ts              NEW — QA pass orchestration
│   ├── qa-scorer.ts              NEW — issue → health score conversion
│   ├── retro-engine.ts           NEW — retrospective computation
│   ├── ship-engine.ts            NEW — version bump + commits + PR creation
│   ├── skill-registry.ts         unchanged
│   ├── skills-import.ts          unchanged
│   ├── skills.ts                 unchanged
│   ├── state.ts                  MODIFIED — new fields for v0.7.0
│   ├── subagent-isolator.ts      unchanged
│   ├── token-estimator.ts        unchanged
│   ├── verifier.ts               unchanged
│   └── workflow-enforcer.ts      unchanged
│
├── harvested/
│   ├── dante-agents/             unchanged
│   ├── gsd/                      unchanged
│   ├── gstack-harvest/           NEW DIRECTORY
│   │   ├── skills/
│   │   │   ├── browser-inspect/
│   │   │   │   ├── SKILL.md
│   │   │   │   └── checklist.md
│   │   │   ├── ceo-review/
│   │   │   │   └── SKILL.md
│   │   │   ├── paranoid-review/
│   │   │   │   ├── SKILL.md
│   │   │   │   └── checklist.md
│   │   │   ├── qa-lead/
│   │   │   │   ├── SKILL.md
│   │   │   │   └── checklist.md
│   │   │   └── retro/
│   │   │       └── SKILL.md
│   │   └── IMPORT_MANIFEST.yaml
│   ├── openpencil/               unchanged
│   └── spec/                     unchanged
│
└── types/
    └── optional-sdks.d.ts        unchanged

.danteforge/
├── AUTOFORGE_GUIDANCE.md         NEW — written by autoforge loop after each cycle
├── CLARIFY.md                    unchanged
├── CONSTITUTION.md               unchanged
├── CURRENT_STATE.md              unchanged
├── lessons.md                    unchanged
├── memory.json                   unchanged (new category 'autoforge-loop')
├── PLAN.md                       unchanged
├── retros/                       NEW DIRECTORY
│   ├── retro-{timestamp}.json
│   └── retro-{timestamp}.md
├── scores/                       NEW DIRECTORY
│   ├── CONSTITUTION-score.json
│   ├── SPEC-score.json
│   ├── CLARIFY-score.json
│   ├── PLAN-score.json
│   └── TASKS-score.json
├── evidence/                     NEW DIRECTORY
│   └── screenshot-{timestamp}.png
├── SPEC.md                       unchanged
├── STATE.yaml                    MODIFIED — new fields
└── TASKS.md                      unchanged

agents/
└── code-reviewer.md              MODIFIED — two-pass CRITICAL/INFORMATIONAL structure
```

---

### 3b. Complete STATE.yaml Schema + TypeScript Types

**Full STATE.yaml with all v0.7.0 fields:**

```yaml
# DanteForge STATE.yaml — v0.7.0 schema
workflowStage: verify
currentPhase: 2
projectType: web   # 'web' | 'cli' | 'library' | 'unknown'

# Existing fields (unchanged)
autoforgeEnabled: true
autoforgeFailedAttempts: 0
autoforgeLastRunAt: "2026-03-13T18:00:00.000Z"
tasks:
  1:
    - "Implement PDSE scoring engine"
    - "Add completionTracker to STATE.yaml"
auditLog:
  - "2026-03-13T18:00:00.000Z | autoforge-loop: cycle 1 — scoring SPEC.md"

# NEW v0.7.0 fields
qaHealthScore: 87
qaBaseline: ".danteforge/qa-baseline.json"
qaLastRun: "2026-03-13T18:30:00.000Z"

retroDelta: 12      # positive = improving vs prior retro
retroLastRun: "2026-03-13T19:00:00.000Z"

completionTracker:
  overall: 72
  phases:
    planning:
      score: 91
      complete: true
      artifacts:
        CONSTITUTION:
          score: 94
          complete: true
        SPEC:
          score: 88
          complete: true
        CLARIFY:
          score: 92
          complete: true
        PLAN:
          score: 90
          complete: true
        TASKS:
          score: 87
          complete: true
    execution:
      score: 68
      complete: false
      currentPhase: 2
      wavesComplete: 1
      totalWaves: 3
    verification:
      score: 45
      complete: false
      qaScore: 87
      testsPassing: true
    synthesis:
      score: 0
      complete: false
      retroDelta: null
  lastUpdated: "2026-03-13T18:45:00.000Z"
  projectedCompletion: "2 more forge waves + verify + synthesize"
```

**TypeScript type additions for src/core/state.ts:**

```typescript
export type ProjectType = 'web' | 'cli' | 'library' | 'unknown';

export interface ArtifactScore {
  score: number;
  complete: boolean;
}

export interface PlanningPhaseTracking {
  score: number;
  complete: boolean;
  artifacts: {
    CONSTITUTION: ArtifactScore;
    SPEC: ArtifactScore;
    CLARIFY: ArtifactScore;
    PLAN: ArtifactScore;
    TASKS: ArtifactScore;
  };
}

export interface ExecutionPhaseTracking {
  score: number;
  complete: boolean;
  currentPhase: number;
  wavesComplete: number;
  totalWaves: number;
}

export interface VerificationPhaseTracking {
  score: number;
  complete: boolean;
  qaScore: number;
  testsPassing: boolean;
}

export interface SynthesisPhaseTracking {
  score: number;
  complete: boolean;
  retroDelta: number | null;
}

export interface CompletionTracker {
  overall: number;
  phases: {
    planning: PlanningPhaseTracking;
    execution: ExecutionPhaseTracking;
    verification: VerificationPhaseTracking;
    synthesis: SynthesisPhaseTracking;
  };
  lastUpdated: string;
  projectedCompletion: string;
}

// Add to existing DanteForgeState interface:
export interface DanteForgeState {
  // ... existing fields unchanged ...
  workflowStage: WorkflowStage;
  currentPhase: number;
  tasks: Record<number, string[]>;
  auditLog: string[];
  autoforgeEnabled: boolean | undefined;
  autoforgeFailedAttempts: number | undefined;
  autoforgeLastRunAt: string | undefined;

  // NEW v0.7.0 fields
  projectType?: ProjectType;
  qaHealthScore?: number;
  qaBaseline?: string;
  qaLastRun?: string;
  retroDelta?: number;
  retroLastRun?: string;
  completionTracker?: CompletionTracker;
}
```

---

### 3c. PDSE Scoring Engine

**File: src/core/pdse.ts (primary engine — ≤500 lines)**
**File: src/core/pdse-config.ts (section checklists + config — ≤500 lines)**

```typescript
// src/core/pdse.ts

export type AutoforgeDecision = 'advance' | 'warn' | 'pause' | 'blocked';
export type ScoredArtifact = 'CONSTITUTION' | 'SPEC' | 'CLARIFY' | 'PLAN' | 'TASKS';

export interface ScoreDimensions {
  completeness: number;      // 0–20
  clarity: number;           // 0–20
  testability: number;       // 0–20
  constitutionAlignment: number;  // 0–20
  integrationFitness: number;     // 0–10
  freshness: number;              // 0–10
}

export interface ScoreIssue {
  dimension: keyof ScoreDimensions;
  severity: 'error' | 'warning';
  message: string;
  evidence?: string;   // the actual text that triggered this issue
}

export interface ScoreResult {
  artifact: ScoredArtifact;
  score: number;             // 0–100, sum of dimensions
  dimensions: ScoreDimensions;
  issues: ScoreIssue[];
  remediationSuggestions: string[];
  timestamp: string;
  autoforgeDecision: AutoforgeDecision;
  hasCEOReviewBonus: boolean;
}

export interface ScoringContext {
  artifactContent: string;
  artifactName: ScoredArtifact;
  stateYaml: DanteForgeState;
  upstreamArtifacts: Partial<Record<ScoredArtifact, string>>;
  isWebProject: boolean;
  evidenceDir?: string;
}

// Primary scoring function — pure, deterministic given same inputs
export function scoreArtifact(ctx: ScoringContext): ScoreResult;

// Score all artifacts that exist on disk
export async function scoreAllArtifacts(cwd: string, state: DanteForgeState): Promise<Record<ScoredArtifact, ScoreResult>>;

// Write score result to .danteforge/scores/{artifact}-score.json
export async function persistScoreResult(result: ScoreResult, cwd: string): Promise<string>;

// Load cached score if artifact mtime matches score timestamp
export async function loadCachedScore(artifact: ScoredArtifact, cwd: string): Promise<ScoreResult | null>;

// Decision logic — pure function
export function computeAutoforgeDecision(score: number): AutoforgeDecision;

// Human-readable remediation for each issue
export function generateRemediationSuggestions(issues: ScoreIssue[], artifact: ScoredArtifact): string[];
```

```typescript
// src/core/pdse-config.ts

// Section checklists — each item is a required section name or heading pattern
export const SECTION_CHECKLISTS: Record<ScoredArtifact, string[]> = {
  CONSTITUTION: [
    'prioritize zero ambiguity',
    'local-first',
    'atomic commits',
    'verify before commit',
  ],
  SPEC: [
    '## Feature Name',
    '## What & Why',
    '## User Stories',
    '## Non-functional Requirements',
    '## Acceptance Criteria',
  ],
  CLARIFY: [
    '## Ambiguities Found',
    '## Missing Requirements',
    '## Consistency Issues',
    '## Clarification Questions',
  ],
  PLAN: [
    '## Architecture Overview',
    '## Implementation Phases',
    '## Technology Decisions',
    '## Risk Mitigations',
    '## Testing Strategy',
  ],
  TASKS: [
    '### Phase',          // at least one phase section
    'task',               // at least one task item
  ],
};

// Ambiguity signals for Clarity scoring
export const AMBIGUITY_WORDS: string[] = [
  'should', 'might', 'could', 'TBD', 'etc.', 'maybe', 'probably',
  'somehow', 'sort of', 'roughly', 'approximately', 'unclear',
  'figure out', 'not sure', 'to be determined', 'we will see',
  'at some point', 'later', 'eventually', 'if possible',
];

// Fail-closed keywords — presence in SPEC means something is missing
export const SPEC_REQUIRED_PATTERNS = [
  /acceptance criteria/i,
  /user stor/i,
  /non-functional/i,
];

// Constitution alignment keywords — presence scores +points
export const CONSTITUTION_KEYWORDS: string[] = [
  'zero ambiguity', 'local-first', 'atomic commit',
  'fail-closed', 'verify', 'pipeda', 'audit', 'deterministic',
];

// Scoring weights per dimension (must sum to 100)
export const DIMENSION_WEIGHTS: ScoreDimensions = {
  completeness: 20,
  clarity: 20,
  testability: 20,
  constitutionAlignment: 20,
  integrationFitness: 10,
  freshness: 10,
};

// Decision thresholds
export const SCORE_THRESHOLDS = {
  EXCELLENT: 90,
  ACCEPTABLE: 70,
  NEEDS_WORK: 50,
  // below NEEDS_WORK = BLOCKED
} as const;
```

---

### 3d. Autoforge v2 State Machine

```typescript
// src/core/autoforge-loop.ts — interface definitions

export enum AutoforgeLoopState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  SCORING = 'SCORING',
  REFINING = 'REFINING',
  BLOCKED = 'BLOCKED',
  COMPLETE = 'COMPLETE',
}

// State transition table
// FROM        EVENT                           TO
// IDLE        --auto, completion < 95%        RUNNING
// RUNNING     stage executed                  SCORING
// SCORING     score >= 70                     RUNNING (advance to next stage)
// SCORING     50 <= score < 70, retry <= 2    REFINING
// SCORING     score < 50                      BLOCKED
// SCORING     retry >= 3 for artifact         BLOCKED
// REFINING    --refine command executed       SCORING
// RUNNING     overall_completion >= 95%       COMPLETE
// BLOCKED     --force provided                RUNNING (one cycle override)
// COMPLETE    (terminal)                      ship --dry-run invoked, exit
// *           SIGINT                          IDLE (graceful exit, STATE saved)

export interface AutoforgeLoopContext {
  goal: string;
  cwd: string;
  state: DanteForgeState;
  loopState: AutoforgeLoopState;
  cycleCount: number;
  startedAt: string;           // ISO timestamp
  retryCounters: Record<string, number>;   // artifactName → retryCount
  blockedArtifacts: string[];
  lastGuidance: AutoforgeGuidance;
  isWebProject: boolean;
  force: boolean;
  scoreOnly: boolean;
  interruptRequested: boolean;  // set by SIGINT handler
}

export interface AutoforgeGuidance {
  timestamp: string;
  overallCompletion: number;
  currentBottleneck: string;
  blockingIssues: BlockingIssue[];
  recommendedCommand: string;
  recommendedReason: string;
  autoAdvanceEligible: boolean;
  autoAdvanceBlockReason?: string;
  estimatedStepsToCompletion: number;
}

export interface BlockingIssue {
  severity: 'BLOCKED' | 'NEEDS_WORK';
  artifactOrStage: string;
  dimension: string;
  score: number;
  maxScore: number;
  description: string;
  remediationCommand: string;
}

export async function runAutoforgeLoop(ctx: AutoforgeLoopContext): Promise<void>;
export async function runScoreOnlyPass(cwd: string): Promise<AutoforgeGuidance>;
export async function writeGuidanceFile(guidance: AutoforgeGuidance, cwd: string): Promise<void>;
export function computeEstimatedSteps(ctx: AutoforgeLoopContext): number;
export function formatGuidanceMarkdown(guidance: AutoforgeGuidance): string;
```

---

### 3e. Browser Adapter Interface

```typescript
// src/core/browse-adapter.ts

export type BrowseSubcommand =
  | 'goto' | 'back' | 'forward' | 'reload' | 'url'
  | 'text' | 'html' | 'links' | 'forms' | 'accessibility'
  | 'snapshot' | 'screenshot' | 'pdf' | 'responsive'
  | 'click' | 'fill' | 'select' | 'hover' | 'type'
  | 'press' | 'scroll' | 'wait' | 'viewport' | 'upload'
  | 'js' | 'eval' | 'css' | 'attrs' | 'is'
  | 'console' | 'network' | 'dialog' | 'cookies' | 'storage' | 'perf'
  | 'diff' | 'chain'
  | 'cookie-import' | 'cookie-import-browser'
  | 'tabs' | 'tab' | 'newtab' | 'closetab'
  | 'dialog-accept' | 'dialog-dismiss';

export interface BrowseAdapterConfig {
  binaryPath: string;
  port?: number;           // default: 9400
  workspaceId?: string;    // for multi-workspace port derivation
  timeoutMs?: number;      // default: 10000
  evidenceDir?: string;    // default: .danteforge/evidence/
  cwd?: string;
}

export interface BrowseResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  evidencePath?: string;   // set when screenshot/pdf subcommand was used
  errorMessage?: string;
}

export interface BrowseBinaryInfo {
  path: string;
  platform: NodeJS.Platform;
  version?: string;
}

// Detect the gstack browse binary in PATH, common install locations, or project ./bin/
export async function detectBrowseBinary(): Promise<BrowseBinaryInfo | null>;

// Install instructions per platform
export function getBrowseInstallInstructions(platform: NodeJS.Platform): string;

// Core invocation — wraps the binary as a child process
export async function invokeBrowse(
  subcommand: BrowseSubcommand,
  args: string[],
  config: BrowseAdapterConfig
): Promise<BrowseResult>;

// Derive port for multi-workspace isolation
// conductorPort provided → port = conductorPort - 45600
// worktreeId provided → deterministic hash → port in 9400–9410 range
// neither → 9400
export function getBrowsePort(worktreeId?: string, conductorPort?: number): number;

// Check if browse daemon is running on expected port
export async function isBrowseDaemonRunning(port: number): Promise<boolean>;
```

---

### 3f. New Command Registrations (src/cli/index.ts additions)

```typescript
// BROWSE
program
  .command('browse <subcommand> [args...]')
  .description('Browser automation — navigate, screenshot, inspect live apps via gstack browse daemon')
  .option('--url <url>', 'Target URL shorthand (equivalent to goto <url>)')
  .option('--install', 'Install the gstack browse binary for this platform')
  .option('--port <port>', 'Override browse daemon port (default: 9400)', '9400')
  .option('--cwd <path>', 'Working directory', process.cwd())
  .action(browseCommand);

// QA
program
  .command('qa')
  .description('Structured QA pass on live app — health score (0–100) with ranked issues')
  .requiredOption('--url <url>', 'Target URL to test (staging or production)')
  .option('--type <mode>', 'QA mode: full | quick | regression', 'full')
  .option('--baseline <path>', 'Baseline JSON path for regression comparison')
  .option('--save-baseline', 'Save current report as the new regression baseline')
  .option('--fail-below <score>', 'Exit code 1 if health score below this threshold', '0')
  .option('--cwd <path>', 'Working directory', process.cwd())
  .action(qaCommand);

// RETRO
program
  .command('retro')
  .description('Project retrospective — commits, LOC, test coverage, lessons, delta vs prior retro')
  .option('--summary', 'Print trend summary of last 5 retros with direction indicators')
  .option('--cwd <path>', 'Working directory', process.cwd())
  .action(retroCommand);

// SHIP
program
  .command('ship')
  .description('Paranoid review + version bump + CHANGELOG + bisectable commits + PR creation')
  .option('--dry-run', 'Run all checks and generate commit plan without pushing')
  .option('--skip-review', 'Skip pre-landing paranoid review (emergency only, logged to audit)')
  .option('--branch <name>', 'Target branch for PR', 'main')
  .option('--cwd <path>', 'Working directory', process.cwd())
  .action(shipCommand);
```

---

### 3g. Modified Command Flag Additions

```typescript
// verify command — add:
.option('--live', 'Run live browser verification substage (requires browse binary)')
.option('--url <url>', 'Staging URL for live verification (required with --live)')

// ux-refine command — add:
.option('--live', 'Capture live browser screenshots as UX evidence (requires browse binary)')
.option('--url <url>', 'URL for live UX capture (required with --live)')

// specify command — add:
.option('--ceo-review', 'Apply founder/CEO intent elevation before writing SPEC.md')
.option('--refine', 'Refine mode: pass PDSE score + remediation as context to LLM')

// plan command — add:
.option('--ceo-review', 'Apply CEO-level strategic review before writing PLAN.md')
.option('--refine', 'Refine mode: pass PDSE score + remediation as context to LLM')

// autoforge command — add:
.option('--auto', 'Run autonomous loop until 95% completion or BLOCKED state')
.option('--score-only', 'Score existing artifacts and write AUTOFORGE_GUIDANCE.md — no execution')
.option('--force', 'Override one BLOCKED artifact for one cycle (logged to audit trail)')
```

---

## D4. IMPLEMENTATION WAVES

---

### Wave 1: Foundation — PDSE + Completion Tracker

**Goal:** Add intelligent artifact scoring and completion tracking to DanteForge without touching GStack, the browser, or the auto-advance loop.

**Files to CREATE:**
- `src/core/pdse.ts` — full PDSE scoring engine
- `src/core/pdse-config.ts` — section checklists, ambiguity words, thresholds, weights
- `src/core/completion-tracker.ts` — computeCompletionTracker(), projectedCompletion logic

**Files to MODIFY:**
- `src/core/state.ts` — add CompletionTracker, ArtifactScore, ProjectType types + DanteForgeState new fields
- `src/core/autoforge.ts` — after each stage execution, call scoreAllArtifacts() + persistScoreResult() + computeCompletionTracker() + write STATE.yaml
- `src/cli/commands/autoforge.ts` — add `--score-only` flag; when passed, run scoreAllArtifacts() + writeGuidanceFile() then exit
- `src/cli/index.ts` — register `--score-only` on autoforge, no new commands yet

**Exit Gate:**
- `danteforge autoforge --score-only` on the DanteForge self-referential project produces `.danteforge/scores/*.json` for all 5 planning artifacts and writes `.danteforge/AUTOFORGE_GUIDANCE.md` with an overall completion % and at least one recommended next action.
- All 5 score JSON files are valid against the ScoreResult TypeScript interface.
- `npm test` passes with ≥ 520 total tests (≥ 32 new PDSE tests).

**Estimated new test count:** 32

---

### Wave 2: GStack Core — Browser Adapter + QA + verify --live

**Goal:** Integrate gstack's /browse and /qa capabilities as first-class DanteForge commands with graceful degradation when the binary is absent.

**Files to CREATE:**
- `src/core/browse-adapter.ts` — full browser adapter with binary detection
- `src/core/qa-runner.ts` — QA pass orchestration (full/quick/regression)
- `src/core/qa-scorer.ts` — browse output → health score conversion
- `src/cli/commands/browse.ts` — commander.js browse command
- `src/cli/commands/qa.ts` — commander.js qa command
- `src/harvested/gstack-harvest/skills/browser-inspect/SKILL.md`
- `src/harvested/gstack-harvest/skills/browser-inspect/checklist.md`
- `src/harvested/gstack-harvest/skills/qa-lead/SKILL.md`
- `src/harvested/gstack-harvest/skills/qa-lead/checklist.md`
- `src/harvested/gstack-harvest/IMPORT_MANIFEST.yaml`

**Files to MODIFY:**
- `src/cli/index.ts` — register browse, qa commands
- `src/cli/commands/verify.ts` — add `--live --url` flags, invoke browse substage
- `src/cli/commands/ux-refine.ts` — add `--live --url` flags, invoke browse screenshot/accessibility
- `src/core/state.ts` — add qaHealthScore, qaBaseline, qaLastRun, projectType fields
- `THIRD_PARTY_NOTICES.md` — add gstack-harvest entry

**Exit Gate:**
- `danteforge browse goto https://example.com` succeeds (or exits cleanly with install instructions when binary absent) — no unhandled exceptions in either code path.
- `danteforge qa --url https://example.com --type quick` produces a valid QAReport JSON in < 30 seconds when browse binary is present.
- `danteforge verify --live --url https://staging.example.com` appends browse evidence to STATE.yaml audit log.
- `npm test` passes with ≥ 548 total tests (≥ 28 new browser/QA tests).

**Estimated new test count:** 28

---

### Wave 3: Intelligence — Auto-Advance Loop + Guidance Engine

**Goal:** Make Autoforge fully autonomous with the `--auto` flag, writing AUTOFORGE_GUIDANCE.md after every cycle.

**Files to CREATE:**
- `src/core/autoforge-loop.ts` — full IAL state machine (≤500 lines)
- `src/cli/commands/autoforge.ts` will grow; if > 500 lines, extract to `src/cli/commands/autoforge-output.ts` for display/formatting logic

**Files to MODIFY:**
- `src/core/autoforge.ts` — refactor: existing pipeline logic delegates to autoforge-loop.ts when --auto is set; --dry-run behavior unchanged
- `src/cli/commands/autoforge.ts` — add `--auto`, `--force` flags
- `src/cli/index.ts` — update autoforge flag registration
- `src/core/autoforge-loop.ts` — call qa runner after forge waves for web projects (uses projectType from STATE.yaml)

**Exit Gate:**
- `danteforge autoforge "build X" --auto --dry-run` runs through the full loop decision logic (SCORING → RUNNING → SCORING cycles) without executing any actual pipeline stages, prints the projected cycle plan to stdout.
- SIGINT during `--auto` run cleanly exits with "progress saved" message, STATE.yaml updated.
- BLOCKED state correctly halts loop and writes AUTOFORGE_GUIDANCE.md with specific remediation command.
- `npm test` passes with ≥ 570 total tests (≥ 22 new loop/guidance tests).

**Estimated new test count:** 22

---

### Wave 4: Polish — Retro + CEO Review + Ship + Paranoid Review Upgrade

**Goal:** Complete the gstack integration with the remaining three features, and upgrade the code reviewer agent.

**Files to CREATE:**
- `src/core/retro-engine.ts`
- `src/cli/commands/retro.ts`
- `src/harvested/gstack-harvest/skills/retro/SKILL.md`
- `src/core/ceo-review-engine.ts`
- `src/harvested/gstack-harvest/skills/ceo-review/SKILL.md`
- `src/core/ship-engine.ts` — ≤500 lines; if git/PR logic grows, split to `src/core/ship-git.ts`
- `src/core/paranoid-review.ts`
- `src/cli/commands/ship.ts`
- `src/harvested/gstack-harvest/skills/paranoid-review/SKILL.md`
- `src/harvested/gstack-harvest/skills/paranoid-review/checklist.md`

**Files to MODIFY:**
- `src/cli/commands/specify.ts` — add `--ceo-review`, `--refine` flags
- `src/cli/commands/plan.ts` — add `--ceo-review`, `--refine` flags
- `agents/code-reviewer.md` — restructure with CRITICAL/INFORMATIONAL two-pass structure
- `src/core/lessons-index.ts` — add indexRetroMetrics()
- `src/core/autoforge-loop.ts` — invoke retro after synthesize; invoke ship --dry-run at completion
- `src/core/state.ts` — add retroDelta, retroLastRun fields
- `src/cli/index.ts` — register retro, ship commands

**Exit Gate:**
- `danteforge retro` on the DanteForge project produces `.danteforge/retros/retro-{timestamp}.json` with valid RetroReport schema and no PII.
- `danteforge specify "build a login form" --ceo-review` produces a SPEC.md with a `## CEO Review Notes` section.
- `danteforge ship --dry-run` executes paranoid review and prints commit plan without touching git.
- `npm test` passes with ≥ 596 total tests (≥ 26 new retro/CEO/ship tests).

**Estimated new test count:** 26

---

### Wave 5: Release — Test Coverage, Docs, Notices, Manifest

**Goal:** Reach ≥ 512 total tests, finalize all docs, ensure clean release gate.

**Files to CREATE:**
- `tests/pdse.test.ts` (if not already full in Wave 1)
- `tests/completion-tracker.test.ts`
- `tests/autoforge-loop.test.ts`
- `tests/browse-adapter.test.ts`
- `tests/qa-runner.test.ts`
- `tests/retro-engine.test.ts`
- `tests/ship-engine.test.ts`
- `tests/paranoid-review.test.ts`
- `tests/ceo-review-engine.test.ts`
- `docs/DanteForge_v0.7.0_PRD.md` (this document)
- `docs/GStack-Integration-Guide.md`

**Files to MODIFY:**
- `THIRD_PARTY_NOTICES.md` — finalize gstack entry
- `src/harvested/gstack-harvest/IMPORT_MANIFEST.yaml` — complete manifest
- `README.md` — add v0.7.0 features section, update command reference
- `RELEASE.md` — add v0.7.0 release notes

**Exit Gate:**
- `npm test` passes with ≥ 512 tests, zero failures.
- `npm run verify` passes (typecheck + lint + tests).
- `npm run check:repo-hygiene` passes.
- `danteforge autoforge --score-only` on a fresh project produces valid AUTOFORGE_GUIDANCE.md.
- `danteforge ship --dry-run` on DanteForge self-referential project completes without errors.
- `npm run check:third-party-notices` passes with gstack-harvest entry present.

**Estimated new test count:** fill to >= 512 total (backfill any gaps from Waves 1–4)

---

## D5. CONSTITUTION ENFORCEMENT NOTES

---

### Zero-Ambiguity — Enforced by PDSE Clarity Scoring

The DanteForge Constitution's first principle is zero ambiguity. The PDSE Clarity dimension operationalizes this with machine-detectable rules.

**What triggers a low Clarity score:**

1. Presence of ambiguity words from `AMBIGUITY_WORDS` config. Each occurrence deducts points from the Clarity dimension. Examples:
   - SPEC.md containing "users should be able to log in" → "should" is ambiguous. Deduction applied. Remediation: rewrite as "users must be able to log in — acceptance criterion: login completes within 2s and returns a valid session token."
   - PLAN.md containing "we might add caching later" → "might" + "later" are both signals. Two deductions. Remediation: either commit the caching plan to a specific phase or explicitly remove it.
   - TASKS.md containing "etc." in any task description → immediate Clarity warning.

2. Missing acceptance criteria in SPEC.md → Clarity score floor of 12/20 (regardless of other content) because unmeasurable specs are definitionally ambiguous.

3. Undefined terms: if SPEC.md uses a term that appears nowhere in CONSTITUTION.md or CLARIFY.md, it is flagged as potentially undefined (heuristic: capitalized noun not in any heading of upstream docs).

**Decision effect:** A Clarity score of < 70 aggregate (including other dimensions) → Autoforge `pause` or `blocked`. The guidance message always includes the specific ambiguous phrases and their replacement suggestions. The operator sees exactly what is vague, not just that something is vague.

**At 0–49 (BLOCKED):** Autoforge halts. The only paths forward are: (a) operator fixes the artifact manually and re-runs, or (b) `--force` flag for one override cycle. Force is logged: `"CONSTITUTION OVERRIDE: clarity score 42 on SPEC.md — operator forced advance at {timestamp}"`.

---

### Fail-Closed — Enforced by BLOCKED State

**Exact conditions that set BLOCKED state:**
1. Any artifact PDSE score < 50.
2. Retry counter for any artifact reaches 3 (three consecutive `--refine` passes failed to improve score to ≥ 70).
3. Browse binary absent and `projectType: 'web'` and `verify --live` is required by loop configuration.
4. QA health score < 80 AND `projectType: 'web'` AND verification phase is the current target.
5. `npm run verify` fails during the loop's pre-forge gate.
6. Paranoid review finds CRITICAL issues that the operator has not resolved (no interactive terminal in `--auto` mode → auto-BLOCKED with remediation command printed).

**What the operator sees on BLOCKED:**
```
┌─────────────────────────────────────────────────────────┐
│  AUTOFORGE BLOCKED — Manual intervention required       │
│                                                         │
│  Reason: SPEC.md Clarity score: 38/20                   │
│  3 ambiguous phrases found:                             │
│    · "should" (line 14) — replace with "must"           │
│    · "TBD" (line 22) — replace with specific value      │
│    · "etc." (line 31) — enumerate all items             │
│                                                         │
│  Fix with:  danteforge specify --refine                 │
│  Or force:  danteforge autoforge --auto --force         │
│                                                         │
│  STATE saved to .danteforge/STATE.yaml                  │
│  Guidance: .danteforge/AUTOFORGE_GUIDANCE.md            │
└─────────────────────────────────────────────────────────┘
```

**What `--force` does:** Advances past the BLOCKED artifact for exactly one cycle. Writes to audit log: `"{timestamp} | CONSTITUTION_OVERRIDE | artifact: SPEC.md | score: 38 | operator forced advance"`. Does not suppress subsequent scoring — the artifact is re-scored next cycle. If it's still < 50 next cycle without --force, it blocks again.

**Phantom completion prevention:** Before the loop advances from SCORING → RUNNING, it verifies: (1) score JSON file exists at `.danteforge/scores/{artifact}-score.json`, (2) score JSON `timestamp` is within the last 60 seconds (fresh score, not cached from a prior run), (3) `autoforgeDecision` in the JSON is `'advance'` or `'warn'`. If any check fails, loop stays in SCORING and retries. This ensures no stage is "completed" based on stale data.

---

### Local-First — Browser Daemon Architecture

The gstack browse daemon satisfies local-first and PIPEDA requirements by design:

1. **Localhost-only binding:** The daemon binds to `127.0.0.1:{port}`, never `0.0.0.0`. No external network access is possible.
2. **Bearer token auth:** Each daemon session generates a random UUID bearer token written to `/tmp/browse-server-{port}.json` with `chmod 600`. No other process can send commands to the daemon without reading the token from the state file — which requires local filesystem access.
3. **No telemetry:** The browse binary sends zero outbound requests outside of the URLs explicitly provided by the operator. No analytics, no crash reporting, no capability detection pings.
4. **State file cleanup:** Daemon auto-stops after 30 minutes idle and removes its state file. No persistent daemon processes.
5. **Evidence stored locally:** All screenshots, accessibility trees, and QA reports are written to `.danteforge/evidence/` and `.danteforge/qa-report.json` — operator filesystem only.
6. **Multi-workspace isolation:** Port derivation from `CONDUCTOR_PORT` or worktree hash ensures parallel sessions never share a daemon. No cross-workspace data leakage.

**PIPEDA compliance for browser data:** The operator is testing their own staging/production URL. No personal data from third-party users is captured or stored by DanteForge — only page content that the operator has rights to inspect. Screenshot files should not be committed to VCS (add `.danteforge/evidence/` to `.gitignore`).

---

### PIPEDA Compliance — Retro Metrics

Retro analysis is conducted entirely on git-local data. The following guarantees are enforced by `src/core/retro-engine.ts`:

**What IS stored:**
- Commit count (integer)
- Lines of code added/removed (aggregate, from `git diff --stat`)
- Test coverage percentage (from coverage report if available, else null)
- Number of lessons added to lessons.md (integer)
- Wave completion count (from STATE.yaml)
- Composite score (0–100)
- Delta vs prior retro (numeric)
- Praise and growth areas (generated text, no user identifiers)
- Truncated commit hashes (first 8 chars, not full SHA — not reversible to author identity in isolation)

**What is NEVER stored:**
- Author names
- Author email addresses
- Commit message content (only counted, not stored)
- Branch names (only counted)
- File-level content
- Any external identifiers or usernames

**Retention:** Retro JSON files accumulate in `.danteforge/retros/`. The operator is responsible for pruning old files. DanteForge does not auto-delete. The `--summary` flag reads the last 5 files only.

**No network calls:** `retro-engine.ts` uses only `git log`, `git diff --stat`, and local file reads. No external services.

---

### Audit Log Extension in v0.7.0

Every new capability writes structured entries to `STATE.yaml → auditLog`. Format: `"{ISO timestamp} | {category} | {detail}"`.

New categories added in v0.7.0:

| Category | Written by | Example entry |
|---|---|---|
| `pdse-score` | pdse.ts | `"2026-03-13T18:00:00Z \| pdse-score \| SPEC.md score: 88 — decision: advance"` |
| `autoforge-loop` | autoforge-loop.ts | `"2026-03-13T18:01:00Z \| autoforge-loop \| cycle 3 — advancing: specify → clarify"` |
| `autoforge-blocked` | autoforge-loop.ts | `"2026-03-13T18:02:00Z \| autoforge-blocked \| artifact: SPEC.md \| score: 42 \| retries: 3"` |
| `constitution-override` | autoforge-loop.ts | `"2026-03-13T18:03:00Z \| constitution-override \| artifact: SPEC.md \| score: 42 \| --force used"` |
| `qa-score` | qa-runner.ts | `"2026-03-13T18:10:00Z \| qa-score \| url: https://staging.app.com \| score: 87 \| mode: full"` |
| `retro-complete` | retro-engine.ts | `"2026-03-13T19:00:00Z \| retro-complete \| score: 74 \| delta: +12"` |
| `ship-review` | paranoid-review.ts | `"2026-03-13T19:05:00Z \| ship-review \| critical: 0 \| informational: 3"` |
| `ceo-review-auto` | ceo-review-engine.ts | `"2026-03-13T18:00:30Z \| ceo-review-auto \| signals: ['maybe','might'] \| triggered: true"` |

---

## D6. TEST STRATEGY

---

### New Test Files

| Test File | What It Covers |
|---|---|
| `tests/pdse.test.ts` | PDSE scoring engine: all 6 dimensions, all 5 artifact types, decision thresholds |
| `tests/pdse-config.test.ts` | Section checklist completeness, ambiguity word list, weight sum = 100 |
| `tests/completion-tracker.test.ts` | All 5 phase completion conditions, overall % computation, projectedCompletion |
| `tests/autoforge-loop.test.ts` | State machine transitions, BLOCKED, SIGINT graceful stop, idempotent run |
| `tests/browse-adapter.test.ts` | Binary detection, command invocation, missing binary error, port derivation |
| `tests/qa-runner.test.ts` | QA report structure, score computation, regression diff, baseline save/load |
| `tests/retro-engine.test.ts` | Metric extraction, delta computation, PII-free output, file write |
| `tests/ship-engine.test.ts` | Version bump logic, commit splitting, CHANGELOG generation, dry-run |
| `tests/paranoid-review.test.ts` | Two-pass review structure, critical detection, interactive resolution |
| `tests/ceo-review-engine.test.ts` | Ambiguity signal detection, auto-trigger threshold, elevation output |

---

### Scoring Engine Tests (`tests/pdse.test.ts`) — minimum 5 test cases per describe block

```typescript
describe('scoreArtifact — SPEC.md', () => {
  it('scores a well-formed SPEC.md with all sections at >= 88', () => {
    // fixture: complete SPEC with all required headings, clear acceptance criteria,
    // no ambiguity words, references CONSTITUTION.md
    const result = scoreArtifact({ artifactContent: WELL_FORMED_SPEC, artifactName: 'SPEC', ... });
    expect(result.score).toBeGreaterThanOrEqual(88);
    expect(result.autoforgeDecision).toBe('advance');
  });

  it('scores a SPEC with "should", "TBD", missing acceptance criteria at <= 55', () => {
    // fixture: SPEC with "Users should be able to..." × 5, "TBD" × 3, no AC section
    const result = scoreArtifact({ artifactContent: AMBIGUOUS_SPEC, artifactName: 'SPEC', ... });
    expect(result.score).toBeLessThanOrEqual(55);
    expect(result.autoforgeDecision).toBeOneOf(['pause', 'blocked']);
    expect(result.issues.some(i => i.dimension === 'clarity')).toBe(true);
  });

  it('scores a SPEC with CEO Review Notes section with clarity bonus', () => {
    const result = scoreArtifact({ artifactContent: SPEC_WITH_CEO_REVIEW, artifactName: 'SPEC', ... });
    expect(result.hasCEOReviewBonus).toBe(true);
    expect(result.dimensions.clarity).toBeGreaterThanOrEqual(result.dimensions.clarity - 5);
  });

  it('detects missing required sections and scores completeness at 0', () => {
    // fixture: SPEC with only "# Title" and body text, no required headings
    const result = scoreArtifact({ artifactContent: '# My Spec\nSome content', artifactName: 'SPEC', ... });
    expect(result.dimensions.completeness).toBe(0);
    expect(result.issues.filter(i => i.dimension === 'completeness').length).toBeGreaterThan(3);
  });

  it('scores a completely empty artifact at < 10 and decision = blocked', () => {
    const result = scoreArtifact({ artifactContent: '', artifactName: 'SPEC', ... });
    expect(result.score).toBeLessThan(10);
    expect(result.autoforgeDecision).toBe('blocked');
  });

  it('produces remediation suggestions with specific runnable commands', () => {
    const result = scoreArtifact({ artifactContent: AMBIGUOUS_SPEC, artifactName: 'SPEC', ... });
    expect(result.remediationSuggestions.some(s => s.includes('danteforge specify --refine'))).toBe(true);
  });
});

describe('scoreArtifact — CONSTITUTION.md', () => {
  it('scores a constitution with all 4 required principles at >= 80', ...);
  it('scores a constitution missing fail-closed principle at lower constitutionAlignment', ...);
  it('gives integration fitness 0 when SPEC.md does not exist in upstreamArtifacts', ...);
  it('gives freshness 10 when no TBD/TODO markers present', ...);
  it('gives freshness 0 when multiple TODO markers present', ...);
});

describe('computeAutoforgeDecision', () => {
  it('returns advance for score >= 90', () => expect(computeAutoforgeDecision(90)).toBe('advance'));
  it('returns warn for score 70–89', () => expect(computeAutoforgeDecision(75)).toBe('warn'));
  it('returns pause for score 50–69', () => expect(computeAutoforgeDecision(60)).toBe('pause'));
  it('returns blocked for score < 50', () => expect(computeAutoforgeDecision(49)).toBe('blocked'));
  it('returns advance for exact score 90', () => expect(computeAutoforgeDecision(90)).toBe('advance'));
  it('returns pause for exact score 50', () => expect(computeAutoforgeDecision(50)).toBe('pause'));
});
```

---

### Completion Tracker Tests (`tests/completion-tracker.test.ts`)

```typescript
describe('computeCompletionTracker — phase completion conditions', () => {
  it('marks planning complete when all 5 artifacts exist and all score >= 70', () => {
    // fixture: 5 score files all with score: 82
    const tracker = computeCompletionTracker(mockState, mockScores);
    expect(tracker.phases.planning.complete).toBe(true);
  });

  it('marks planning incomplete when any artifact scores < 70', () => {
    // fixture: TASKS-score.json with score: 65
    const tracker = computeCompletionTracker(mockState, { ...mockScores, TASKS: lowScore });
    expect(tracker.phases.planning.complete).toBe(false);
    expect(tracker.phases.planning.score).toBeLessThan(70);
  });

  it('computes execution % as wavesComplete/totalWaves', () => {
    const tracker = computeCompletionTracker({ ...mockState, currentPhase: 2 }, mockScores);
    // wavesComplete: 1, totalWaves: 3 → execution score ~ 33
    expect(tracker.phases.execution.wavesComplete).toBe(1);
  });

  it('marks verification complete when verifier passes + qaScore >= 80', () => {
    const tracker = computeCompletionTracker({ ...mockState, qaHealthScore: 87 }, mockScores);
    expect(tracker.phases.verification.complete).toBe(true);
  });

  it('marks synthesis complete when UPR.md + retro + lessons all present', () => { ... });

  it('overall = weighted average: planning 25% + execution 40% + verification 25% + synthesis 10%', () => {
    // planning: 100%, execution: 50%, verification: 0%, synthesis: 0%
    // expected overall: 25 + 20 + 0 + 0 = 45
    const tracker = computeCompletionTracker(halfwayState, fullPlanningScores);
    expect(tracker.overall).toBeCloseTo(45, 1);
  });

  it('is idempotent — calling twice produces identical output', () => {
    const t1 = computeCompletionTracker(mockState, mockScores);
    const t2 = computeCompletionTracker(mockState, mockScores);
    expect(t1).toEqual(t2);
  });
});
```

---

### Auto-Advance Loop Tests (`tests/autoforge-loop.test.ts`)

```typescript
describe('runAutoforgeLoop', () => {
  it('advances from RUNNING to COMPLETE when overall >= 95% after first cycle', async () => {
    // mock: all scores 92+, completion 96%
    const ctx = buildMockCtx({ scores: allHighScores, overall: 96 });
    await runAutoforgeLoop(ctx);
    expect(ctx.loopState).toBe(AutoforgeLoopState.COMPLETE);
  });

  it('transitions to BLOCKED after 3 failed refine attempts on same artifact', async () => {
    // mock: SPEC always scores 40, retry counter increments each cycle
    const ctx = buildMockCtx({ specScore: 40 });
    await runAutoforgeLoop(ctx);
    expect(ctx.loopState).toBe(AutoforgeLoopState.BLOCKED);
    expect(ctx.blockedArtifacts).toContain('SPEC');
    expect(ctx.retryCounters['SPEC']).toBe(3);
  });

  it('stops gracefully on SIGINT and writes STATE.yaml', async () => {
    const ctx = buildMockCtx({ scores: allHighScores });
    // Send SIGINT after first cycle
    setTimeout(() => process.emit('SIGINT'), 100);
    await runAutoforgeLoop(ctx);
    expect(ctx.loopState).toBe(AutoforgeLoopState.IDLE);
    expect(mockStateWritten).toBe(true);
  });

  it('--force overrides one BLOCKED cycle and logs to audit', async () => {
    const ctx = buildMockCtx({ blockedArtifacts: ['SPEC'], force: true });
    await runAutoforgeLoop(ctx);
    expect(mockAuditLog.some(e => e.includes('constitution-override'))).toBe(true);
  });

  it('invokes qa runner after forge wave when projectType = web', async () => {
    const ctx = buildMockCtx({ projectType: 'web', loopState: 'post-forge' });
    await runAutoforgeLoop(ctx);
    expect(mockQARunner).toHaveBeenCalledOnce();
  });

  it('writes AUTOFORGE_GUIDANCE.md after every cycle', async () => {
    const ctx = buildMockCtx({ scores: allHighScores });
    await runAutoforgeLoop(ctx);
    expect(mockGuidanceWrites).toBeGreaterThanOrEqual(1);
  });
});
```

---

### Browser Adapter Tests (`tests/browse-adapter.test.ts`)

```typescript
describe('detectBrowseBinary', () => {
  it('returns binary info when binary is in PATH', async () => {
    mockWhich('browse', '/usr/local/bin/browse');
    const info = await detectBrowseBinary();
    expect(info).not.toBeNull();
    expect(info!.path).toBe('/usr/local/bin/browse');
  });

  it('returns null when binary is not found anywhere', async () => {
    mockWhichMissing();
    const info = await detectBrowseBinary();
    expect(info).toBeNull();
  });
});

describe('invokeBrowse', () => {
  it('invokes binary with correct args for goto subcommand', async () => {
    const result = await invokeBrowse('goto', ['https://example.com'], mockConfig);
    expect(mockExecArgs).toContain('goto');
    expect(mockExecArgs).toContain('https://example.com');
  });

  it('returns BrowseResult with success:false when binary exits non-zero', async () => {
    mockBinaryExit(1, 'Connection refused');
    const result = await invokeBrowse('goto', ['https://example.com'], mockConfig);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('sets evidencePath on screenshot subcommand result', async () => {
    const result = await invokeBrowse('screenshot', [], { ...mockConfig, evidenceDir: '/tmp/evidence' });
    expect(result.evidencePath).toMatch(/screenshot-\d+\.png/);
  });
});

describe('getBrowsePort', () => {
  it('returns 9400 when no worktreeId or conductorPort provided', () => {
    expect(getBrowsePort()).toBe(9400);
  });

  it('derives port from conductorPort as conductorPort - 45600', () => {
    expect(getBrowsePort(undefined, 55040)).toBe(9440);
  });

  it('produces different ports for different worktreeIds', () => {
    const p1 = getBrowsePort('worktree-a');
    const p2 = getBrowsePort('worktree-b');
    expect(p1).not.toBe(p2);
  });
});
```

---

## D7. MIGRATION GUIDE — v0.6.0 → v0.7.0

---

### STATE.yaml Backward Compatibility

When DanteForge v0.7.0 reads a STATE.yaml that was created by v0.6.0, it will be missing the following fields. The migration logic in `src/core/state.ts → loadState()` initializes them to safe defaults:

```typescript
// Migration defaults applied when fields are absent:
if (!state.projectType) state.projectType = 'unknown';
if (state.qaHealthScore === undefined) state.qaHealthScore = 0;
if (state.qaBaseline === undefined) state.qaBaseline = undefined;
if (state.qaLastRun === undefined) state.qaLastRun = undefined;
if (state.retroDelta === undefined) state.retroDelta = undefined;
if (state.retroLastRun === undefined) state.retroLastRun = undefined;
if (!state.completionTracker) {
  state.completionTracker = {
    overall: 0,
    phases: {
      planning: {
        score: 0, complete: false,
        artifacts: {
          CONSTITUTION: { score: 0, complete: false },
          SPEC: { score: 0, complete: false },
          CLARIFY: { score: 0, complete: false },
          PLAN: { score: 0, complete: false },
          TASKS: { score: 0, complete: false },
        }
      },
      execution: { score: 0, complete: false, currentPhase: 1, wavesComplete: 0, totalWaves: 1 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: 'Run danteforge autoforge --score-only to assess',
  };
}
```

The STATE.yaml file is only written back when a command explicitly calls `saveState()`. Loading a v0.6.0 STATE.yaml and immediately running a read-only command (like `autoforge --dry-run`) will NOT modify the file.

---

### Score Files

- `.danteforge/scores/` directory is created on first `danteforge autoforge --score-only` or first `danteforge autoforge` run.
- If the directory does not exist and a read-only command tries to load scores, it receives empty score results (all zeros) — graceful degradation, no crash.
- Score files are written atomically: JSON written to `{artifact}-score.json.tmp` first, then renamed to `{artifact}-score.json`. This prevents partial reads.

---

### No Breaking Changes Guarantee

Every existing v0.6.0 command surface is unchanged:

| Command | v0.6.0 flags | v0.7.0 additions | Breaking change? |
|---|---|---|---|
| `autoforge` | `--goal`, `--dry-run`, `--cwd` | `--auto`, `--score-only`, `--force` | NO |
| `verify` | `--cwd` | `--live`, `--url` | NO |
| `specify` | `--prompt`, `--cwd` | `--ceo-review`, `--refine` | NO |
| `plan` | `--prompt`, `--cwd` | `--ceo-review`, `--refine` | NO |
| `ux-refine` | `--openpencil`, `--prompt` | `--live`, `--url` | NO |
| `forge` | `--profile`, `--parallel`, `--prompt`, `--worktree` | none | NO |
| `review` | `--cwd` | none | NO |
| `constitution` | `--prompt`, `--cwd` | none | NO |
| `clarify` | `--light`, `--prompt`, `--cwd` | none | NO |
| `tasks` | `--prompt`, `--cwd` | none | NO |
| `synthesize` | `--prompt`, `--cwd` | none | NO |
| `party` | `--isolation`, etc. | none | NO |

All new commands (`browse`, `qa`, `retro`, `ship`) are purely additive — they do not modify behavior of any existing command.

---

### Browser Binary Installation

The gstack browse binary is an optional dependency. DanteForge does not bundle it. Install it separately:

**macOS (Apple Silicon or Intel):**
```bash
# Download the precompiled binary from gstack releases
curl -L https://github.com/stacksjs/gstack/releases/latest/download/browse-macos -o /usr/local/bin/browse
chmod +x /usr/local/bin/browse
# Verify
browse --version
```

**Linux (x86_64):**
```bash
curl -L https://github.com/stacksjs/gstack/releases/latest/download/browse-linux -o /usr/local/bin/browse
chmod +x /usr/local/bin/browse
```

**Windows (WSL2 recommended):**
```bash
# Inside WSL2 Ubuntu:
curl -L https://github.com/stacksjs/gstack/releases/latest/download/browse-linux -o /usr/local/bin/browse
chmod +x /usr/local/bin/browse
```

**Via danteforge (installs to ./bin/ in project):**
```bash
danteforge browse --install
```
This downloads the platform-appropriate binary to `./bin/browse` and adds it to PATH for the current session. The `browse-adapter.ts` checks `./bin/browse` as a fallback after PATH search.

---

### First-Run Experience on a v0.6.0 Project

Running `danteforge autoforge --score-only` on a project that was managed by v0.6.0:

1. Loads existing STATE.yaml — migrates missing fields to defaults in memory (does not write yet).
2. Reads existing `.danteforge/CONSTITUTION.md`, `SPEC.md`, `CLARIFY.md`, `PLAN.md`, `TASKS.md`.
3. Scores each artifact using PDSE.
4. Creates `.danteforge/scores/` directory and writes 5 score JSON files.
5. Computes completionTracker — writes to STATE.yaml.
6. Writes `.danteforge/AUTOFORGE_GUIDANCE.md`.
7. Prints to stdout:

```
DanteForge v0.7.0 — Score-Only Pass
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONSTITUTION.md     94  ✓ EXCELLENT
SPEC.md             88  ✓ ACCEPTABLE
CLARIFY.md          92  ✓ EXCELLENT
PLAN.md             78  ✓ ACCEPTABLE
TASKS.md            65  ⚠ NEEDS WORK

Overall completion:  71%
Current bottleneck:  TASKS.md (Testability: 8/20)

Recommended next action:
  danteforge tasks --refine
  Reason: 4 tasks lack explicit done-conditions.

Auto-advance eligibility: YES (all scores >= 65)
Estimated steps to completion: 4

Guidance written to: .danteforge/AUTOFORGE_GUIDANCE.md
```

---

## D8. UPDATED THIRD_PARTY_NOTICES.md ENTRY

Add the following section to `THIRD_PARTY_NOTICES.md` after the existing `src/harvested/dante-agents/` entry:

---

```markdown
## `src/harvested/gstack-harvest/`

- Upstream project: gstack
- Upstream URL: https://github.com/stacksjs/gstack
- License: MIT
- License text location: Upstream repository `LICENSE` (MIT). DanteForge distribution license text is in root `LICENSE`.
- Copyright: `stacksjs`
- Local modifications:
  - Five skill sets harvested: browser-inspect (/browse), qa-lead (/qa), retro (/retro), ceo-review (/plan-ceo-review), paranoid-review (/review + /ship)
  - Each skill's Markdown prompt content has been adapted into `SKILL.md` format following the DanteForge SKILL.md convention (description frontmatter, constitution integration notes, gate references, state.yaml integration, TDD guidance)
  - `checklist.md` files for browser-inspect, qa-lead, and paranoid-review are adapted from gstack's `.claude/skills/*/checklist.md` with DanteForge-specific sections added (constitution enforcement, artifact writing requirements, handoff triggers)
  - Browser automation binary (`browse`) is NOT bundled with DanteForge — it is an optional dependency that operators install separately via `danteforge browse --install` or directly from the gstack release page
  - No gstack TypeScript source code is included in DanteForge; DanteForge reimplements the orchestration layer natively in `src/core/browse-adapter.ts`, `src/core/qa-runner.ts`, `src/core/retro-engine.ts`, `src/core/ceo-review-engine.ts`, and `src/core/paranoid-review.ts`
  - The /ship automation workflow (8-step process) was adapted from gstack's `/ship` command prompt into DanteForge's `danteforge ship` CLI command and `src/core/ship-engine.ts`, with integration into DanteForge's existing `verify` and `release:check` pipeline
  - gstack's Conductor workspace isolation concept (port derivation from CONDUCTOR_PORT) is implemented in `src/core/browse-adapter.ts → getBrowsePort()` with additional worktree-hash-based derivation for DanteForge's git worktree isolation model
  - All harvested skills are wrapped with DanteForge constitution enforcement notes, STATE.yaml integration guidance, and explicit gate requirements not present in the upstream gstack prompts
```

---

## APPENDIX: AUTOFORGE_GUIDANCE.md Template

The following is the exact Markdown template written to `.danteforge/AUTOFORGE_GUIDANCE.md` after each Autoforge loop cycle. This is the canonical format — no deviations.

```markdown
# Autoforge Guidance
> Generated: {ISO_TIMESTAMP}

## Overall Completion: {OVERALL_PERCENT}%

| Phase | Score | Complete |
|---|---|---|
| Planning | {PLANNING_SCORE} | {PLANNING_COMPLETE} |
| Execution | {EXECUTION_SCORE} | {EXECUTION_COMPLETE} |
| Verification | {VERIFICATION_SCORE} | {VERIFICATION_COMPLETE} |
| Synthesis | {SYNTHESIS_SCORE} | {SYNTHESIS_COMPLETE} |

## Current Bottleneck
{BOTTLENECK_NAME} — {BOTTLENECK_REASON}

## Blocking Issues
{BLOCKING_ISSUES_LIST}
_None_ if no blocking issues.

## Artifact Scores
| Artifact | Score | Decision |
|---|---|---|
| CONSTITUTION.md | {SCORE} | {DECISION} |
| SPEC.md | {SCORE} | {DECISION} |
| CLARIFY.md | {SCORE} | {DECISION} |
| PLAN.md | {SCORE} | {DECISION} |
| TASKS.md | {SCORE} | {DECISION} |

## Recommended Next Action
```
danteforge {COMMAND} {FLAGS}
```
**Reason:** {ONE_SENTENCE_REASON}

## Auto-Advance Eligibility
{YES | NO} — {REASON}

## Estimated Steps to Completion
{N} steps: {BRIEF_PLAN}

## Cycle Summary
- Cycles run: {CYCLE_COUNT}
- Time elapsed: {ELAPSED}
- Retry counters: {RETRY_MAP}
- Loop state: {LOOP_STATE}
```

---

D9. ANTI-STUB DOCTRINE (MANDATORY — NO EXCEPTIONS)
Purpose
Prevent the common agent failure mode where “work is claimed complete” when only a stub, TODO, placeholder, simulated function, or partial implementation exists. This doctrine is enforced at every level: PDSE scoring, Autoforge loop, code-reviewer agent, verifier, release gates, and tests.
Core Rule
No file may contain any of the following strings or patterns at the moment of commit:

TODO
todo
FIXME
stub
shim
placeholder
later
tbd
to be determined
simulate
mocked
fake
dummy
// TODO
/* TODO */
// stub
return { success: true }; (unless it is the real implementation)

Any such string triggers an immediate Clarity dimension score of 0 in PDSE and a BLOCKED state in the Autoforge loop.
Enforcement Mechanisms (all must be true before any commit or loop advance)

PDSE Clarity Scoring
The Clarity dimension now includes a hard “Anti-Stub Scan”. Presence of any forbidden string = Clarity score floored at 0. Remediation suggestion is always:
danteforge <command> --refine with the exact line numbers flagged.
Code Reviewer Agent (agents/code-reviewer.md)
Stage 1 now includes an explicit “Anti-Stub Gate”:
Scan every changed file for the forbidden list above.
Any match → BLOCKED verdict with line numbers.
Reviewer must never approve a PR that contains any of the above strings.

Verifier & Release Gatesnpm run verify and npm run check:repo-hygiene now run an additional grep pass for the forbidden strings. Any match = non-zero exit code.
danteforge verify --release fails closed if any stub pattern is found in src/, tests/, or .danteforge/.
Autoforge Loop
Before advancing from SCORING → RUNNING, the loop runs the anti-stub scan on every file touched in the last cycle. Any hit = BLOCKED with remediation command:
danteforge <affected-command> --refine
Test Coverage Rule
Every new test file must contain at least one assertion that would fail if the feature were only a stub. “Simulated” or “mocked” tests are forbidden. Coverage must be real execution.
Human Gate
The final danteforge ship --dry-run output explicitly prints:
“Anti-Stub Scan: 0 forbidden patterns found”
If the number is > 0, the ship is blocked.

Operator Reminder in README.md
Add this permanent note to the top of the README:
DanteForge Anti-Stub Doctrine
We never claim work is done when it isn’t. Every feature must be fully functional or explicitly BLOCKED with a clear remediation path. Stubs, TODOs, and shims are treated as failures and will block the Autoforge loop.
Constitution Tie-In
This directly enforces the first principle (“zero ambiguity”) and the fourth principle (“always verify before commit”). Any stub is definitionally ambiguous and unverified.