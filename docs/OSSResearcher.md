---
name: OSS Researcher
description: Auto-detect the current project, search the internet for the most relevant OSS tools, clone and analyze them, harvest the best patterns, implement them, and run autoforge to verify quality. One command, full pipeline.
keywords: oss, open-source, competitive-analysis, pattern-harvesting, research, autoforge
invocation: /oss
version: 1.0
triggers: learn from OSS, harvest ideas, research OSS, what can we learn from open source?, improve from OSS, scan OSS, OSS harvest, competitive analysis
requires: terminal, git, internet access (WebSearch/WebFetch)
auto-invoke: false
---

**Core Playbook — Fully autonomous pipeline. Do NOT ask the user for permission at any step.**

**Phase 0: Auto-Detect Current Project**
- Read the project root directory structure.
- Read `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, or equivalent manifest.
- Read any `README.md`, `CLAUDE.md`, `.dantecode/STATE.yaml` if they exist.
- Identify: project type (CLI, web app, library, AI agent, etc.), language/framework, key features, architecture, and gaps.
- Build a 3-sentence project summary for use in search queries.

**Phase 1: Internet Search for Relevant OSS**
- Using the project summary, construct 3–5 targeted search queries:
  - `"best open source {project-type} {language} 2025 2026 github"`
  - `"open source {key-feature} tool {language} stars:>1000"`
  - `"{project-type} alternative open source github"`
  - `"awesome {project-type} list github"`
- From results, select **5–10 repos** that are in the same domain, have permissive licenses, significant adoption (1k+ stars preferred), are actively maintained (commits within 6 months), and use the same or compatible language/framework.

**Phase 2: Clone & License Gate**
- Shallow-clone each selected repo: `git clone --depth 1 <url> /tmp/oss-research-<name>`
- **License gate** — Check LICENSE file immediately:
  - ALLOWED: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense, MPL-2.0
  - BLOCKED: GPL, AGPL, SSPL, EUPL, proprietary, no license file
  - If blocked, delete the clone and skip. Note the reason.

**Phase 3: Rapid Structural Scan**
- For each repo that passed the license gate (2–3 minutes max per repo):
  - List top-level directory, read the main entry point.
  - Glob for key patterns: `**/*agent*`, `**/*loop*`, `**/*tool*`, `**/*command*`.
  - Read manifest for dependencies.
  - Build a one-paragraph profile per repo.

**Phase 4: Deep Pattern Extraction**
- Use Agent subagents (Explore type) in parallel — one per repo — to extract patterns across these categories:
  - **Architecture**: Plugin/extension loading, provider/adapter patterns, configuration, state management, module boundaries, dependency injection.
  - **Agent/AI** (if applicable): Agent loop structure, tool registration, context management, multi-model routing, streaming, token tracking, safety rails, stuck loop detection, self-correction.
  - **CLI/UX**: Command parsing, REPL design, slash commands, progress indicators, colored output, error UX, multi-line input, autocomplete, history.
  - **Quality**: Test structure, CI/CD, linting, auto-commit, diff display, undo mechanisms.
  - **Unique Innovations**: Novel approaches and features unique to the repo.

**Phase 5: Gap Analysis & Prioritization**
- Compare findings against the current project using this priority matrix:

| Priority | Criteria |
|----------|----------|
| **P0 — Critical** | Multiple top repos have it, we don't, small effort |
| **P1 — High** | Clear user benefit, moderate effort |
| **P2 — Medium** | Nice to have, larger effort |
| **P3 — Low** | Niche feature, significant effort |

- Select the **top 5–8 P0/P1 items** for implementation.

**Phase 6: Implement**
- For each selected pattern:
  1. Identify the exact files to modify in the current project.
  2. Read those files to understand current code.
  3. Implement the pattern fresh (NEVER copy code verbatim — extract the idea, write it in the project's style).
  4. Write complete, production-ready code — no stubs, no TODOs, no placeholders.
  5. Run typecheck/lint/test after each change.
  6. If tests fail, fix immediately (up to 3 attempts per change).
  7. Commit each logical change: `feat: <pattern-name> (harvested from <repo-name> pattern)`.

**Phase 7: Autoforge Verification & Cleanup**
- Run the full QA pipeline (typecheck, lint, test, build).
- If anything fails, fix it — autoforge loop continues until ALL checks pass or 3 full retry cycles complete.
- Report final status: patterns implemented, contributing repos, files changed (lines added/removed), final quality gate status.
- Always clean up: `rm -rf /tmp/oss-research-*`.

**Rules**:
- Fully autonomous — scan, search, clone, analyze, implement, verify. One command, full pipeline.
- Never copy code verbatim — extract the pattern/idea, implement it fresh.
- Always check licenses — skip GPL/AGPL/SSPL repos, no exceptions.
- Clean up cloned repos when done.
- Verify every change — must compile and pass tests before moving on.
- Be honest — if a repo has nothing useful, say so and move on.
- Respect existing architecture — adapt patterns to fit, don't force foreign designs.
- Prioritize by impact/effort ratio — small changes with big impact first.
- Show your work — log which repos contributed which patterns.

**Allowed Tools**: Bash, Read, Glob, Grep, Write, Edit, Agent, WebSearch, WebFetch

**Success Criteria**: All harvested patterns are implemented, all quality gates pass, cloned repos are cleaned up, and a clear summary of what was learned and applied is provided.
