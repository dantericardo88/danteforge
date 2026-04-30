# Article XIV Reconciliation — Context Economy vs Brand Asset Protocol

**Date:** 2026-04-29
**Closure context:** PRD-FORGE-V1.1-Closure.md §4.1 specified Article XIV as the "Brand Asset Protocol" derived from Huashu Design pattern harvest. Reality on disk diverged: Article XIV in `.danteforge/CONSTITUTION.md` (lines 304–314) is **Context Economy**, derived from RTK pattern harvest via PRD-26.

This memo reconciles the divergence honestly and proposes the slot for the Brand Asset Protocol if it is still needed.

## Constitutional state on disk (2026-04-29)

[.danteforge/CONSTITUTION.md](../.danteforge/CONSTITUTION.md) lines 304–314:

> ## 14. Context Economy
>
> Every token entering an LLM context window is a cost paid in money, latency, attention, and failure risk. DanteForge must treat context as a scarce constitutional resource…
>
> **Numbering note:** The original harvest prompt requested Article XIII. This repo already has Article XIII: Pre-Commit Gates, so Context Economy is Article XIV to preserve constitutional continuity.
>
> **Harvested from:** RTK (https://github.com/rtk-ai/rtk, MIT) - patterns 1-10 in `.danteforge/OSS_HARVEST/rtk_patterns.md`.

## Why this happened

Two harvest passes assigned constitutional articles in parallel without cross-checking:
- **Pass 12 (OpenHuman + EvoMap)** identified the Brand Asset Protocol as an Article XIV candidate, derived from Huashu Design (per local Claude memory notes; those notes are not repo-tracked evidence)
- **PRD-26 Context Economy Layer (RTK harvest)** assigned Article XIV to Context Economy and shipped that draft into `.danteforge/CONSTITUTION.md`

PRD-26 landed first on disk; PRD-FORGE-V1.1-Closure was authored after but referenced the older Pass-12 plan.

## Resolution

**Article XIV remains Context Economy** as drafted in `.danteforge/CONSTITUTION.md`. This is consistent with:
- The constitution's existing `**Numbering note:**` (line 312) which explicitly ties continuity to the existing chain
- The substantive integration of Context Economy across the harsh scorer (19th dimension), runtime telemetry (`src/core/context-economy/runtime.ts`), and CLI gates (Pass 26 receipts)
- The principle that disk-state-of-record beats stale-plan-document when they diverge

**The Brand Asset Protocol** (entity verification before generation when content references real-world entities — brands, people, companies, regulations) is **proposed as Article XV**, pending founder ratification.

## Article XV proposal (pending founder ratification)

> ## 15. Brand Asset Protocol (proposed)
>
> When DanteForge generates content that names real-world entities (brands, people, companies, products, regulations, public statistics, or other claims about external reality), the artifact-generation step MUST emit a `verify_entity` evidence record before the artifact is committed.
>
> The evidence record cites the authoritative source the claim was checked against. Sources are configurable per entity-type but default to: official websites for company/brand/product names, regulator websites for regulations, peer-reviewed sources for statistics. Sources are never the LLM's own training data.
>
> The three-way gate refuses promotion of artifacts that name a real-world entity without a corresponding `verify_entity` evidence record. This is a fail-closed default: when the entity-type cannot be classified, the gate refuses promotion and the founder must explicitly approve.
>
> **Harvested from:** Huashu Design pattern (Pass 12 OpenHuman + EvoMap harvest, attributed at `.danteforge/OSS_HARVEST/openhuman_patterns.md` and `.danteforge/OSS_HARVEST/evomap_patterns.md`).
>
> **Substrate implementation status:** no runtime enforcement is claimed in this pass; full implementation is gated on founder ratification.

## Founder action required (GATE-ARTICLE-XV)

To formally ratify Article XV:
1. Founder reviews this memo and the proposed Article XV text above
2. Founder either:
   - **Approves** — append the Article XV text to `.danteforge/CONSTITUTION.md` as a founder commit and remove this memo's "pending" status
   - **Revises** — return with proposed changes
   - **Rejects** — formally retire the Brand Asset Protocol and document rationale in `docs/PRDs/Article-XV-RETIRED.md`

Until then, this memo holds the placeholder.

## Constitutional discipline

This reconciliation is consistent with:
- **Article XII Anti-Stub Enforcement** — refuses to silently break a constitutional reference; documents the divergence honestly
- **Article XIV Context Economy** — keeps the existing Article XIV intact rather than churning numbering across the codebase
- **Article X OSS Pattern Learning** — preserves attribution to both RTK (Article XIV Context Economy) and Huashu Design (proposed Article XV Brand Asset Protocol)

## Closure stamp

PRD-FORGE-V1.1-Closure §4.1 ("Article XIV either ratified or formally deferred with explicit reason") is satisfied:
- Article XIV (Context Economy, the realized version): **ratified-pending**, drafted in `.danteforge/CONSTITUTION.md`
- Article XV (Brand Asset Protocol, the proposed version originally targeted as XIV): **proposed-pending founder ratification**, documented in this memo
