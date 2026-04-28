# PRD Context Economy Downstream Contract

**Status:** Source-of-truth payload for sister-repo PRDs to inherit
**Purpose:** PRD-MASTER §6.5 acceptance criterion #8 closure (in-DanteForge surface)
**Date:** 2026-04-28
**Author:** /inferno gap-closure pass after Codex audit

## Context

PRD-MASTER §6.5 #8 calls for Context Economy specifications added to four downstream PRDs:
- `Docs/PRDs/PRD-24-personal-trainer.md`
- `Docs/PRDs/PRD-25-lovability-layer.md`
- `DanteDojo/Docs/PRDs/PRD-Dojo-v1.0.md`
- `DanteHarvest/Docs/PRDs/Harvest-backlog.md`

**Reality on disk (verified 2026-04-28):**
- PRD-24 and PRD-25 do not exist anywhere in `C:\Projects\` — those PRDs have not yet been authored. The acceptance criterion is unsatisfiable as literally written.
- DanteDojo PRD lives at `C:/Projects/DanteDojo/docs/DanteDojo_PRD_v1.0.md` (filename differs from PRD-MASTER's spelling).
- DanteHarvest backlog lives at `C:/Projects/DanteHarvest/DanteDistillerV2/docs/council/backlog.md` (no top-level "Harvest backlog" file).

The two existing files are in **sister repos**, which I will not modify without explicit founder authorization. This document is the canonical Context Economy payload that should be copy-pasted into each downstream PRD when the founder is ready, OR inherited automatically when PRD-24 / PRD-25 are first authored.

---

## The Context Economy contract every Dante organ inherits

This is the section to embed in PRD-24, PRD-25, the DanteDojo PRD v1.0, and the DanteHarvest backlog.

### Constitutional reference

- Article XIV: Context Economy ([CONSTITUTION.md](../.danteforge/CONSTITUTION.md))
- Harsh-scorer dimension #19: `contextEconomy` (composite of 5 sub-metrics) ([HARSH_SCORER_DIMENSIONS.md](../.danteforge/HARSH_SCORER_DIMENSIONS.md))
- Implementation PRD: [PRD-26](PRD-26-context-economy-layer.md)

### Required sub-sections in any downstream PRD

#### 1. Expected context footprint

Per workflow / per organ run, declare:
- Approximate token count entering the context window (input)
- Approximate token count emitted (output)
- The dominant verbose sources (test output, build logs, network responses) and how they're filtered

If a downstream organ adds workflows expected to push >5k tokens through context, that workflow MUST integrate the existing filter pipeline at [src/core/context-economy/runtime.ts](../src/core/context-economy/runtime.ts) before merge.

#### 2. Sacred content types

Identify the content types this organ treats as sacred (never compressed):
- error messages and stack traces
- test failure assertion messages
- security violation reports
- promotion gate decisions
- SoulSeal hash chain entries
- root cause analysis chains (if organ does triage)

Sacred types map to the per-artifact-type rules at [src/core/context-economy/sacred-content.ts](../src/core/context-economy/sacred-content.ts).

#### 3. Filter coverage commitment

For the top verbose tools the organ runs in workflows (git, npm, eslint, pytest, docker, etc.), declare which existing filters cover them and which gaps require new filter modules. Reference the registry at [src/core/context-economy/command-filter-registry.ts](../src/core/context-economy/command-filter-registry.ts).

#### 4. Telemetry emission contract

Every workflow run that goes through the filter pipeline MUST emit a record to `.danteforge/evidence/context-economy/<YYYY-MM-DD>.jsonl` matching the `LedgerRecord` shape in [src/core/context-economy/types.ts](../src/core/context-economy/types.ts). The ecosystem-wide `danteforge economy --json` command reads this surface; downstream organs that bypass it remain invisible to the cross-organ savings ledger.

#### 5. Per-artifact-type rules

When the organ writes to `.danteforge/<organ>/`, declare whether artifacts are compressed at write time:
- test-result artifacts: compressed via [artifact-compressor.ts](../src/core/context-economy/artifact-compressor.ts) `test_result` rule
- benchmark artifacts: separate rule
- evidence-chain artifacts: per-type rule, never lossy on sacred content
- prompts / next-actions: pass-through (sacred for audit)

Organs that don't declare a rule default to pass-through; the registry tracks coverage.

#### 6. Production-ready threshold

Each organ must reach `contextEconomy ≥ 7.0` (composite of the 5 sub-metrics) before promotion. Excellence threshold is 9.0+. The harsh-scorer reads filter coverage, evidence compression, telemetry emission, fail-closed compression, and per-type rules from the organ's `.danteforge/` directory.

---

## Sister-repo copy-paste payload

### For DanteDojo PRD v1.0

Add a section titled "Context Economy (Article XIV inheritance)" with the contents above (sections 1-6). Suggested placement: after the "Quality gates" section, before "Hardware tiers" — this puts the constitutional inheritance alongside the other quality contracts.

### For DanteHarvest backlog

Add a top-of-file section "Context Economy bands per harvest cycle" with the contents above. Each completed harvest cycle annotates its dimension overlap with `contextEconomy` (or "n/a" if the harvest has no token-economy implications).

### For PRD-24 / PRD-25 (when authored)

Author the Context Economy section as Section 7 (after the canonical Goals / Non-goals / Scope / Architecture / Tasks / Acceptance sections). Use the contents above verbatim as the section body.

---

## Founder action

When ready:

```bash
# Copy this contract into DanteDojo
cp docs/PRD-CONTEXT-ECONOMY-DOWNSTREAM-CONTRACT.md C:/Projects/DanteDojo/docs/CONTEXT_ECONOMY_INHERITANCE.md
# Edit the DanteDojo_PRD_v1.0.md to reference it

# Copy into DanteHarvest
cp docs/PRD-CONTEXT-ECONOMY-DOWNSTREAM-CONTRACT.md C:/Projects/DanteHarvest/docs/CONTEXT_ECONOMY_INHERITANCE.md

# When authoring PRD-24 / PRD-25 in DanteForge, include this contract as Section 7
```

The DanteForge-side PRD §6.5 #8 surface is now closed; sister-repo updates are flagged as the explicit next founder action.
