---
name: oss
description: "Auto-detect project, search OSS, clone, license-gate, scan, extract patterns, and produce a harvesting report"
---

# /oss — OSS Researcher

When the user invokes `/oss`, follow this fully autonomous pipeline. **Do NOT ask the user for permission at any step.**

## Phase 0: Auto-Detect Project Profile

1. Read `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, or equivalent manifest.
2. Read `README.md` and `.danteforge/STATE.yaml` if they exist.
3. Identify: project type (CLI, web app, library, AI agent, etc.), language/framework, key features.
4. Build a 3-sentence project summary for use in search queries.

## Phase 1: Search for Relevant OSS

Using the project summary, issue 3-5 targeted searches:
- `"best open source {project-type} {language} 2025 2026 github"`
- `"open source {key-feature} tool {language} stars:>1000"`
- `"{project-type} alternative open source github"`
- `"awesome {project-type} list github"`

Select **5-10 repos** that are in the same domain, have permissive licenses, significant adoption (1k+ stars preferred), and are actively maintained.

## Phase 2: Clone & License Gate

- Shallow-clone each selected repo: `git clone --depth 1 <url> .danteforge/oss-repos/<name>`
- Repos are stored persistently (NEVER auto-deleted) — use `/oss-clean` to remove
- Skip cloning if repo already exists (idempotent)
- **License gate** — Check LICENSE file immediately:
  - **ALLOWED**: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense, MPL-2.0
  - **BLOCKED**: GPL, AGPL, SSPL, EUPL, proprietary, no license file
  - If blocked: mark as `status: 'blocked'` in registry (keep for audit), skip pattern extraction.

## Phase 3: Structural Scan

For each allowed repo (2-3 minutes max):
- List top-level directory, read main entry point.
- Glob for key patterns: `**/*agent*`, `**/*loop*`, `**/*tool*`, `**/*command*`.
- Read manifest for dependencies.

## Phase 4: Pattern Extraction

Extract patterns across these categories:
- **Architecture**: Plugin/extension loading, provider/adapter patterns, state management
- **Agent/AI**: Agent loop structure, tool registration, context management, streaming, token tracking
- **CLI/UX**: Command parsing, progress indicators, colored output, error UX, autocomplete
- **Quality**: Test structure, CI/CD, linting, diff display, undo mechanisms
- **Unique Innovations**: Novel approaches unique to each repo

## Phase 5: Gap Analysis & Prioritization

| Priority | Criteria |
|----------|----------|
| **P0** | Multiple top repos have it, we don't, small effort |
| **P1** | Clear user benefit, moderate effort |
| **P2** | Nice to have, larger effort |
| **P3** | Niche feature, significant effort |

Select the **top 5-8 P0/P1 items** for implementation.

## Phase 6: Implement

For each selected pattern:
1. Read the target files in the current project.
2. Implement the pattern fresh — **NEVER copy code verbatim**.
3. Write complete, production-ready code — no stubs, no TODOs.
4. Run `npm run verify` after each change.
5. Fix failures before moving to the next pattern.

## Phase 7: Holistic Synthesis & Report

- Combine patterns from ALL repos in `.danteforge/oss-registry.json` (not just current run)
- Prioritize patterns: P0 → P1 → P2 → P3 across full library
- Write `.danteforge/OSS_REPORT.md` with holistic view of entire knowledge base
- Update registry with new repos and patterns
- **NO cleanup** — repos persist in `.danteforge/oss-repos/` for future reference

## Options

- `--prompt` — Generate a copy-paste research plan prompt
- `--dry-run` — Show search queries without cloning
- `--max-repos <n>` — Maximum NEW repos to discover per run (default: 4)

## Incremental Growth

Each run discovers N **new** repos (filters against `.danteforge/oss-registry.json`). Run multiple times to grow your library:

```
Run 1: 4 repos  → Library: 4 repos
Run 2: 4 repos  → Library: 8 repos
Run 3: 4 repos  → Library: 12 repos
```

Use `/oss-learn` to re-extract patterns from all cached repos.
Use `/oss-clean` to remove repos from storage.

CLI fallback: `danteforge oss`
