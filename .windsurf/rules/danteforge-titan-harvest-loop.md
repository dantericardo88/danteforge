---
name: titan-harvest-loop
description: "Clean-room harvest pipeline for GPL/AGPL-licensed OSS repos — clones each blocked repo temporarily, feeds key files to the LLM for conceptual pattern extraction (no code copying), writes a pattern document, then deletes the clone. Legally safe: stores LLM-generated analysis, never GPL source code."
---
# /titan-harvest-loop — Clean-Room Harvest Loop

When the user invokes `/titan-harvest-loop`, run the clean-room harvest pipeline on all GPL/AGPL repos queued by `oss-loop`.

## What it does

1. Reads `.danteforge/titan-registry.json` for repos with `harvestStatus: pending`
2. For each repo, clones it temporarily (read-only, for analysis only)
3. Feeds key files (README, entry points, core source) to the LLM
4. The LLM produces a conceptual pattern document — architecture, algorithms, API design, competitive advantages, implementation targets — in its own words, no code quoted verbatim
5. Writes the pattern document to `.danteforge/titan-patterns/<name>.md`
6. **Immediately deletes the GPL clone** — no copyleft code stays on disk
7. Marks the entry `complete` in the titan registry
8. Reports summary

## Usage

```bash
danteforge titan-harvest-loop                 # analyze up to 10 queued repos
danteforge titan-harvest-loop --max-repos 5  # analyze 5 at a time
danteforge titan-harvest-loop --dry-run      # show plan without cloning or calling LLM
```

## Legal basis

This is a clean-room protocol:
- **Reading GPL code** for analysis is legal (no restriction on studying software)
- **The LLM output** is generated independently — it describes patterns in its own words
- **No source code is stored** — the clone is deleted immediately after analysis
- **Pattern documents** contain concepts, architecture, and algorithms, not code

This gives you full competitive intelligence on GPL/AGPL tools while keeping DanteForge's codebase free of copyleft obligations.

## How repos get into the titan queue

`danteforge oss-loop` automatically routes any discovered repo with a non-permissive license (GPL, AGPL, SSPL, EUPL) to `.danteforge/titan-registry.json` with `harvestStatus: pending`. Previously, these repos were silently discarded. Now they're queued for titan harvest.

## Output example

```
[titan-harvest] 4 repo(s) pending clean-room harvest. Processing up to 10.

[titan-harvest] ── gpt-engineer (GPL-3.0) ──────────────────
[titan-harvest] Cloning https://github.com/gpt-engineer-org/gpt-engineer for analysis...
[titan-harvest] Running clean-room analysis on "gpt-engineer"...
[titan-harvest] ✓ "gpt-engineer" — 7 pattern sections written to .danteforge/titan-patterns/gpt-engineer.md

[titan-harvest] ── continue (AGPL-3.0) ──────────────────
[titan-harvest] Cloning https://github.com/continuedev/continue for analysis...
[titan-harvest] Running clean-room analysis on "continue"...
[titan-harvest] ✓ "continue" — 7 pattern sections written to .danteforge/titan-patterns/continue.md

─────────────────────────────────────────────────
[titan-harvest] Analyzed:  4 repo(s)
[titan-harvest] Failed:    0 repo(s)
[titan-harvest] Remaining: 0 repo(s) queued
─────────────────────────────────────────────────
[titan-harvest] Pattern docs: X:\Projects\DanteForge\.danteforge\titan-patterns
[titan-harvest] Next: run `danteforge crusade` — titan patterns are automatically included in harvest context.
```

## Pattern document format

Each `.danteforge/titan-patterns/<name>.md` contains:

1. **Architecture Overview** — key subsystems and how they communicate
2. **Core Algorithms & Strategies** — what makes it work, described conceptually
3. **API & Interface Design Patterns** — public interface design decisions
4. **Key Data Structures** — what underpins the core functionality
5. **Competitive Advantages** — the "secret sauce"
6. **Implementation Targets** — 5-10 concrete patterns to independently re-implement
7. **Gaps & Weaknesses** — improvement opportunities

## Full pipeline sequence

```bash
danteforge oss-loop              # discover all OSS (permissive → clone, GPL → titan queue)
danteforge titan-harvest-loop    # clean-room analyze all titan-queued repos
danteforge crusade               # frontier loop with complete competitive intelligence
```

## Relationship to other OSS commands

| Command | Handles | Output |
|---|---|---|
| `danteforge oss-loop` | All repos | Permissive → cloned; GPL → titan queue |
| `danteforge oss-sync` | Permissive registry | Re-clones missing permissive repos |
| `danteforge titan-harvest-loop` | GPL/AGPL registry | Pattern docs, no source code stored |
| `danteforge oss-intel` | Permissive clones | Extracts patterns from cloned source |
| `danteforge crusade` | Matrix + all patterns | Frontier loop using all intelligence |

CLI parity: `danteforge titan-harvest-loop [--max-repos N] [--dry-run]`
