---
name: titan-harvest-loop
description: "Clean-room harvest pipeline for GPL/AGPL OSS repos — clones temporarily, extracts architectural patterns via LLM (no code copying), writes pattern docs to .danteforge/titan-patterns/, deletes clone. Legally safe competitive intelligence on copyleft tools."
---
# /titan-harvest-loop — Clean-Room Harvest Loop

When the user invokes `/titan-harvest-loop`, run the clean-room harvest pipeline on all GPL/AGPL repos queued by `oss-loop`.

## What it does

1. Reads `.danteforge/titan-registry.json` for repos with `harvestStatus: pending`
2. Clones each repo temporarily (for LLM analysis only)
3. Feeds key files to the LLM — README, entry points, core source (token-budgeted)
4. LLM produces conceptual pattern document: architecture, algorithms, API design, competitive advantages, implementation targets — in its own words, no code quoted
5. Writes pattern doc to `.danteforge/titan-patterns/<name>.md`
6. **Immediately deletes the clone** — no copyleft code stays on disk
7. Marks registry entry `complete`

## Usage

```bash
danteforge titan-harvest-loop                 # analyze up to 10 queued repos
danteforge titan-harvest-loop --max-repos 5  # smaller batch
danteforge titan-harvest-loop --dry-run      # plan only
```

## How repos get queued

`danteforge oss-loop` automatically routes GPL/AGPL/SSPL/EUPL repos to the titan queue instead of discarding them. Previously these were silently thrown away — now they're fully leveraged via clean-room protocol.

## Legal basis

Reading GPL code for competitive analysis is legal. The LLM output is generated independently in its own words. No source code is stored — the clone is deleted the moment analysis completes. Pattern documents contain concepts and architecture, not code.

## Full pipeline

```bash
danteforge oss-loop              # discover all OSS → permissive cloned, GPL → titan queue
danteforge titan-harvest-loop    # analyze titan queue via clean-room protocol
danteforge crusade               # frontier loop with complete competitive intelligence
```

## Pattern document sections

Each `.danteforge/titan-patterns/<name>.md` covers:
1. Architecture Overview
2. Core Algorithms & Strategies
3. API & Interface Design Patterns
4. Key Data Structures & State Management
5. Competitive Advantages
6. Implementation Targets (5-10 concrete, independently re-implementable patterns)
7. Gaps & Weaknesses

## Relationship to other OSS commands

| Command | Handles | Output |
|---|---|---|
| `danteforge oss-loop` | All repos | Permissive → cloned; GPL → titan queue |
| `danteforge titan-harvest-loop` | GPL/AGPL registry | Pattern docs, no source code |
| `danteforge oss-intel` | Permissive clones | Pattern extraction from source |
| `danteforge crusade` | All patterns | Frontier loop with full context |

CLI parity: `danteforge titan-harvest-loop [--max-repos N] [--dry-run]`
