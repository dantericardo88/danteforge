# RTK Harvest Report: Context Economy

**Date:** 2026-04-25  
**Target:** https://github.com/rtk-ai/rtk  
**RTK commit read:** `80a6fe606f73b19e52b0b330d242e62a6c07be42`  
**License result:** MIT, verified at `Cargo.toml:7`  
**Dante article:** Article XIV, because this repo already has Article XIII: Pre-Commit Gates

## Completion Summary

Claude had started the integration, but the harvest was not complete under strict mode. The original notes contained unsupported RTK claims and the license was wrong. I repaired the harvest around source-cited, clean-room patterns only.

Completed deliverables:

- `.danteforge/OSS_HARVEST/rtk_patterns.md`: 10 verified RTK patterns with source file/line citations, attribution, clean-room Dante implementation notes, and PRD mapping.
- `.danteforge/oss-registry.json`: RTK entry updated to MIT, categories `token-efficiency`, `context-economy`, `cli-proxy`, dimension overlap, and `foundation_for_constitutional_article`.
- `.danteforge/CONSTITUTION.md`: Article XIV rewritten as load-bearing Context Economy prose.
- `.danteforge/HARSH_SCORER_DIMENSIONS.md`: `contextEconomy` specified with five 0-10 sub-metrics and 7.0+ production threshold.
- `.danteforge/CONTEXT_ECONOMY_BASELINE.md`: baseline scores for DanteForge, DanteCode, and DanteAgents using local evidence.
- `docs/PRD-26-context-economy-layer.md`: complete build-ready PRD for the Dante Context Economy Layer.
- Backlog addenda added for PRD-24/PRD-25 in `C:\Projects\DanteAgents\Docs\25DimensionGap.md`, Dojo PRD v1.0 in `C:\Projects\DanteDojo\Docs\DanteDojo_PRD_v1.0.md`, and the Harvest backlog in `C:\Projects\DanteHarvest\Docs\DanteHarvestDeepresearchPRD.md`.

## Strict Exclusions

The harvest intentionally excludes claims not verified in RTK source:

- No verified "skip compression below 10% gain" RTK rule was found.
- No verified LLM intent-detection filter stage was found.
- No verified before/after filter hook API for each filter stage was found.
- No verified general locale-safe subprocess environment rule was found.

RTK does support passthrough tracking, low-savings analytics, TOML filtering, sacred-content protection via rule bypass/failure passthrough, raw output recovery, SQLite savings tracking, and gain reporting. Those are the patterns carried forward.

## Constitutional Impact

This is the first Dante harvest in this sequence where the harvested principle rises above tactical implementation. RTK's transferable principle is cross-cutting: every token entering context is a cost, and every organ must be scored on whether it reduces that cost without hiding sacred failure signals.

Future harvest criterion:

If a pattern applies across all current and future organs, it can become a constitutional article. If it applies only to a specific organ or workflow, it should remain a PRD implementation pattern.

## Context Economy Dimension

The new dimension uses five sub-metrics, each 0-10:

1. Filter coverage.
2. Evidence compression.
3. Telemetry emission.
4. Fail-closed compression.
5. Per-type rules.

Composite score is the average. Production-ready threshold is 7.0+.

Baseline:

| Organ | Score |
|---|---:|
| DanteForge | 1.0/10 |
| DanteCode | 3.4/10 |
| DanteAgents | 3.8/10 |

## PRD-26 Recommendation

Next action: ratify Article XIV and build PRD-26. The PRD is scoped to 2-3 days and should not add RTK or Rust. The implementation should be TypeScript primary with a Python adapter for Python organs, ten command filters, write-time `.danteforge/` evidence compression, and `danteforge economy` reporting.

Acceptance after PRD-26:

- 60%+ token reduction on tracked commands.
- 40%+ evidence artifact compression where safe.
- Zero information loss on sacred content.
- DanteForge, DanteCode, and DanteAgents all score 7.0+ on Context Economy.

## Harsh Double Scoring

| Gate | Score | Rationale |
|---|---:|---|
| Source attribution | 9.4 | RTK behavior claims are tied to file/line citations; unsupported claims are explicitly excluded. |
| Clean-room discipline | 9.5 | No RTK code copied, no dependency added, MIT license verified. |
| Constitutional coherence | 9.2 | Article XIV matches existing constitution without overwriting Article XIII. |
| Testability | 9.0 | PRD-26 defines concrete sub-metrics, telemetry fields, filters, fixtures, and acceptance thresholds. |
| Completeness | 9.1 | All requested deliverables are present, with numbering adjusted for the existing constitution. |

Gate result: pass for harvest/specification. Implementation remains intentionally deferred to PRD-26.
