---
name: AutoResearch
description: Autonomous metric-driven optimization loop inspired by Karpathy's autoresearch pattern. Define a goal + metric, then let the agent iterate overnight — rewrite code/prompts/skills, run experiments, evaluate results, keep winners, discard losers, repeat. Fully autonomous, no human in the loop.
keywords: autoresearch, karpathy, overnight-optimization, metric-driven, experiment-loop, self-improvement, autonomous
invocation: /autoresearch
version: 1.0
triggers: autoresearch, run autoresearch, optimize overnight, experiment loop, metric-driven optimization, self-optimize, run experiments overnight
requires: terminal, git
auto-invoke: false
argument-hint: "<goal> --metric <metric> --time <budget>"
---

**Core Playbook — Karpathy AutoResearch Pattern adapted for codebase optimization. Fully autonomous. Do NOT pause to ask the human if you should continue.**

> Inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch): define a goal, define a metric, iterate autonomously — plan, rewrite, execute, evaluate, keep winners, discard losers, repeat until time runs out or the human interrupts.

---

## Invocation

```
/autoresearch "improve cold start performance" --metric "startup time ms" --time "4h"
```

Or natural language: *"Run autoresearch to optimize our API response times overnight"*

**Required inputs** (ask once if not provided, then never ask again):
- **Goal**: What to optimize (e.g., "reduce bundle size", "improve test coverage", "optimize database queries", "improve prompt quality")
- **Metric**: How to measure success — must be quantifiable and automatable (e.g., "bundle size KB", "test pass rate %", "p95 latency ms", "PDSE score")
- **Time budget**: How long to run (default: 4h, max: 12h)

---

## Phase 0: Baseline Setup

1. Read the project root, manifest files, README, CLAUDE.md, any state files.
2. Identify the **measurement command** — the script/command that produces the metric value. If none exists, write one. The measurement must be:
   - Deterministic (same code = same result, within noise margin)
   - Automatable (runs without human input)
   - Fast (under 2 minutes per measurement, ideally under 30 seconds)
3. Create experiment branch: `git checkout -b autoresearch/<goal-slug>`
4. Initialize `results.tsv` (untracked — do NOT commit this file):
   ```
   experiment   metric_value   status      description
   baseline     <value>        keep        unmodified baseline
   ```
5. Run the baseline measurement and record the starting metric value.
6. Announce: "Baseline established at `<value>`. Beginning experiment loop."

---

## Phase 1: The Experiment Loop

**NEVER STOP.** Once the loop begins, do NOT pause to ask the human anything. The human might be asleep. You are autonomous. If you run out of ideas, think harder — re-read the codebase, try combining previous near-misses, try more radical approaches. The loop runs until:
- The time budget expires, OR
- The human interrupts you

### Each Iteration:

```
LOOP UNTIL TIME BUDGET EXPIRES:

1. PLAN — Analyze current codebase state + results.tsv history.
   Decide what to try next. Prefer:
   - High impact / low effort changes first
   - Changes informed by what worked/failed previously
   - Sequential binary-search style narrowing (NOT parallel sweeps)
   Write a 1-sentence hypothesis: "Changing X should improve metric because Y"

2. REWRITE — Make the code change.
   - Small, surgical edits only. One logical change per experiment.
   - Write complete, production-ready code. No stubs, no TODOs.
   - git add + git commit with message: "experiment: <description>"

3. EXECUTE — Run the measurement command.
   - Capture stdout/stderr to run.log
   - If the run crashes, try to fix (up to 2 attempts). If unfixable, mark as crash and move on.
   - Enforce a per-experiment time cap (2x the baseline measurement time, max 5 minutes)

4. EVALUATE — Extract the metric value from run.log.
   - Compare against the current best (not just the baseline — the best so far)

5. DECIDE — Pure mechanical decision, no judgment calls:
   - IMPROVED (metric got better)  → status: "keep". Branch advances. This is the new best.
   - EQUAL OR WORSE               → status: "discard". git reset --hard to previous commit.
   - CRASHED                      → status: "crash". git reset --hard. Log the error. Move on.

   Simplicity criterion: A tiny improvement that adds significant complexity is NOT worth keeping.
   Conversely, removing code and getting equal or better results IS worth keeping (simplification win).

6. RECORD — Append to results.tsv:
   experiment   metric_value   status   description

7. REPEAT — Go back to step 1.
```

---

## Phase 2: Experiment Ideas Generation

The agent should draw from these categories depending on the goal:

### Performance Optimization
- Algorithm changes (O(n^2) → O(n log n))
- Caching strategies (memoization, HTTP cache headers, query caching)
- Lazy loading, code splitting, tree shaking
- Database query optimization (indexes, joins, N+1 elimination)
- Connection pooling, batch processing
- Compression, minification

### Code Quality / Test Coverage
- Extract functions, reduce complexity
- Add missing test cases for uncovered branches
- Replace imperative loops with declarative patterns
- Eliminate dead code, unused imports
- Strengthen type safety

### UX / Prompt Quality
- Rewrite prompts for clarity and specificity
- A/B test different prompt structures
- Optimize loading states, error messages
- Reduce interaction steps

### Bundle / Build Size
- Dependency audit and replacement (lighter alternatives)
- Tree shaking configuration
- Dynamic imports for heavy modules
- Asset optimization

---

## Phase 3: Safety Guards

These are NON-NEGOTIABLE. Every experiment must pass ALL guards before being evaluated:

1. **Git-based rollback**: Every experiment is a commit. Failed experiments are `git reset` cleanly. The branch only advances on improvement.
2. **No self-modification of the measurement**: The metric measurement script/command is READ-ONLY during the loop. The agent cannot game the metric.
3. **Per-experiment time cap**: No single experiment may run longer than 5 minutes. Kill and mark as crash if exceeded.
4. **Build/lint/typecheck gate**: After each code change, run the project's quality checks. If they fail, the experiment is automatically a crash — do not evaluate the metric.
5. **No new dependencies**: Do not add packages or dependencies during the loop unless explicitly part of the goal. Work with what's already installed.
6. **No destructive changes**: Do not delete test files, remove safety checks, disable linting rules, or weaken validation to improve a metric. That's gaming, not improving.
7. **Noise margin**: If the metric improvement is within noise (< 1% relative change for timing metrics, < 0.5% for other metrics), treat as EQUAL and discard — don't accumulate jitter.

---

## Phase 4: Results & Report

When the time budget expires or the human interrupts, produce a final report:

```markdown
## AutoResearch Report: <goal>

**Duration**: <actual time spent>
**Experiments run**: <total>
**Kept**: <count> | **Discarded**: <count> | **Crashed**: <count>
**Keep rate**: <percentage>

### Metric Progress
- Baseline: <starting value>
- Final: <ending value>
- Total improvement: <delta> (<percentage>%)

### Winning Experiments (in order applied)
| # | Description | Metric Delta | Commit |
|---|------------|-------------|--------|
| 1 | <desc>     | -<delta>    | <hash> |
| 2 | <desc>     | -<delta>    | <hash> |

### Notable Failures (informative)
| # | Description | Why it failed |
|---|------------|--------------|
| 1 | <desc>     | <reason>     |

### Key Insights
- <What the agent learned from the experiment sequence>
- <Patterns that worked vs didn't>
- <Suggestions for future runs>

### Full Results Log
<contents of results.tsv>
```

Save the report to `AUTORESEARCH_REPORT.md` in the project root (do not commit — leave for human review).

---

## Rules

1. **Fully autonomous** — Once started, never pause for human approval. Plan, rewrite, execute, evaluate, decide, repeat.
2. **One change per experiment** — Isolate variables. If you change two things and it improves, you don't know which one helped.
3. **Sequential, not parallel** — Each experiment builds on all previous results. No sweeps. Use binary search to narrow in on optimal values.
4. **Mechanical decisions** — Improved = keep, else = discard. No subjective judgment on whether to keep a change.
5. **Simplicity bias** — All else being equal, simpler is better. A small improvement that adds ugly complexity is not worth it. Deleting code and getting equal results IS worth keeping.
6. **Never game the metric** — Improve the actual thing, not the measurement of the thing.
7. **Clean git history** — Only winning experiments remain in the branch. Discarded experiments are reset, leaving a clean commit chain of incremental improvements.
8. **Log everything** — `results.tsv` captures every attempt including failures. This is the experiment journal.
9. **Respect the time budget** — Stop gracefully when time is up. Don't start a new experiment if there isn't enough time to complete it.
10. **Think harder when stuck** — If you run out of obvious ideas, re-read the codebase, look at results.tsv for patterns, try combining near-misses, try the opposite of what failed. Do NOT stop early.

## Allowed Tools

Bash, Read, Glob, Grep, Write, Edit, Agent, WebSearch, WebFetch

## Chains With

- `/verify` — Run after autoresearch to validate final state
- `/autoforge` — Can trigger autoresearch as a sub-loop for metric-driven optimization phases
- `/lessons` — Capture key insights from the experiment run for future sessions

## Success Criteria

The loop ran for the full time budget (or until interrupted), all winning experiments compile and pass quality gates, the metric improved from baseline, `results.tsv` and `AUTORESEARCH_REPORT.md` are present, and the git branch contains a clean chain of incremental improvements ready for human review.
