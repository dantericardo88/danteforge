---
name: oss-learn
description: "Re-extract patterns from all cached OSS repos and regenerate holistic OSS_REPORT.md"
---

# /oss-learn — Re-Learn from Cached Repos

When the user invokes `/oss-learn`, re-scan all previously cached repos in `.danteforge/oss-repos/` to extract fresh patterns. **Do NOT ask the user for permission at any step.**

## What This Does

The OSS library in `.danteforge/oss-repos/` grows incrementally over time. As your project evolves, patterns that seemed irrelevant during initial discovery may now be valuable. This command re-scans all cached repos with fresh context.

## Phase 1: Load Registry

1. Read `.danteforge/oss-registry.json` to get all cached repos
2. Filter to repos with `status: 'active'` (skip blocked/archived)
3. Verify each repo still exists on disk

## Phase 2: Re-Scan Each Repo

For each active repo (2-3 minutes max per repo):
1. Verify repo exists at `storagePath` (mark archived if missing)
2. Run structural scan:
   - List top-level directory
   - Read package.json / Cargo.toml / pyproject.toml / go.mod
   - Read main entry point (src/index.ts, index.js, etc.)
3. Extract patterns across 5 categories:
   - **Architecture**: Plugin loading, state management, provider patterns
   - **Agent/AI**: Agent loops, tool registration, context management
   - **CLI/UX**: Command parsing, progress, error handling
   - **Quality**: Test structure, CI/CD, linting
   - **Innovation**: Novel approaches unique to this repo
4. Update registry entry with fresh patterns and timestamp

## Phase 3: Holistic Synthesis

1. Combine patterns from ALL repos in library
2. Prioritize by: P0 (critical, small effort) → P1 → P2 → P3
3. Regenerate `.danteforge/OSS_REPORT.md` with full library view

## Phase 4: Report Summary

Display:
- Number of repos re-learned
- Total patterns in library
- P0/P1 count (implementation candidates)
- Path to updated report

## Options

- `--repo <name>` — Re-learn only repos whose name contains this string (e.g. `--repo express`)
- `--prompt` — Show manual instructions instead of executing

## When to Use

- After major architecture changes (new patterns may now be relevant)
- Monthly maintenance (refresh pattern insights)
- Before starting a new feature (check for updated best practices)
- When you suspect patterns were missed during initial discovery

## CLI Fallback

```bash
danteforge oss learn              # Re-learn all active repos
danteforge oss learn --repo nest  # Re-learn specific repo
```

## Important Notes

- Repos are NEVER deleted by this command
- Re-learning updates the registry in-place (preserves clone timestamps)
- The holistic OSS_REPORT.md combines insights from the entire library
- Use `/oss-clean` if you need to remove repos from storage
