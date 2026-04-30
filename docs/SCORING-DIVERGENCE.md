# Scoring Divergence — Maturity Engine vs Harsh Scorer

**Date:** 2026-04-29
**Pass:** 34
**Context:** Two scoring systems coexist in DanteForge. They look at overlapping data but produce different headline numbers. This doc is the canonical explanation so neither system silently misleads readers.

## TL;DR

- **Maturity engine** (`src/core/maturity-engine.ts`) returns **8 dimensions × 0-100 absolute** scoring. Headline: average across dimensions, mapped to a Sketch→Enterprise-Grade level.
- **Harsh scorer** (`src/core/harsh-scorer.ts`) returns **19 dimensions × weighted aggregate**. Headline: weighted average × 10, on a 0-10 scale.
- They agree on the underlying signals (test count, error handling, doc presence, etc.) but **disagree on what the headline number means** because they use different aggregation methods.

For DanteForge as of 2026-04-30:
- Maturity: **95/100, Enterprise-Grade, no quality gaps** (8 dimensions all ≥ 88)
- Harsh: **9.3/10** (16 of 19 dimensions ≥ 9.0; communityAdoption at 1.5 drags weighted aggregate)

## Where they share signals

| Signal | Read from | Used by |
|---|---|---|
| Test count + coverage | filesystem (`tests/`, coverage report) | both |
| Error handling pattern density | code-walk | both |
| Documentation presence (README, CONSTITUTION, MAGIC-LEVELS, etc.) | filesystem | both |
| UX polish heuristics (accessibility, responsive markers) | code-walk | both |
| Maintainability (LOC-per-fn, cyclomatic-density proxies) | AST scan | both |
| Performance markers (no SELECT *, no nested-loop regex) | code-walk | both |
| Functionality (largest fn without test, etc.) | code-walk | both |
| Security findings | code-walk + scoring rubric | both |

## Where they diverge

| Concern | Maturity engine | Harsh scorer |
|---|---|---|
| Aggregation | average of 8 dimensions | weighted average of 19 dimensions |
| Output range | 0-100 + level (Sketch / Prototype / Alpha / Beta / Customer-Ready / Enterprise-Grade) | 0-10 |
| Critical-gap penalty | derived from `gaps[].severity === 'critical'` | derived from per-dimension formulas + display rounding |
| `developerExperience` | not a direct dimension; emerges from documentation + maintainability + ux | direct dimension at 8.5/10 (formula: `round((doc + maint) / 2) + bonus`) |
| `specDrivenPipeline` | not a direct dimension | direct dimension at 8.5/10 (formula: `base + present-artifacts × 12 + stage-bonus + evidence-flag-bonus`) |
| `ecosystemMcp` | not a direct dimension | direct dimension at 10.0/10 |
| `communityAdoption` | not a direct dimension | direct dimension at 1.5/10 (drags overall) |
| `contextEconomy` | not a direct dimension | direct dimension at 9.0/10 |

The 11 dimensions in harsh that don't exist in maturity (autonomy, planningQuality, selfImprovement, specDrivenPipeline, convergenceSelfHealing, tokenEconomy, contextEconomy, ecosystemMcp, communityAdoption, plus developerExperience as a derived dim) are *strategic* dimensions that maturity doesn't measure because maturity is about per-codebase quality, not per-organization strategy.

## Why this exists (history)

- **Maturity engine** (older, more battle-tested) was built first to answer "is this code Production-Ready?". It uses the 8 dimensions specified in PRD-MATURITY because they map cleanly to the 6 maturity levels.
- **Harsh scorer** (added Sprint 35-43) was built to answer "how does DanteForge stack against competitors?" and "where should ascent loops focus next?". It includes strategic dimensions (autonomy, ecosystemMcp, etc.) that competitor scoring requires.

Both are useful. Neither is wrong. They answer different questions.

## How to read each correctly

**When to use maturity engine:**
- "Is this code production-ready for a Beta launch?"
- "What quality gaps block promotion?"
- Building Magic-Level → maturity-target alignment (see `docs/MAGIC-LEVELS.md`)

**When to use harsh scorer:**
- "How does DanteForge compare to MetaGPT / Aider / GPT-Engineer?"
- "Which dimension should `danteforge ascend` target next?"
- Strategic / competitive scoring

## Future cleanup (deferred)

Eliminating the divergence would require either:
1. Folding the 8 maturity dimensions into the harsh scorer as a sub-aggregate (complex; weights must be re-tuned)
2. Forking maturity into a strategic-equivalent (duplicates work)
3. Documenting the divergence and accepting both scores (current state)

We chose option 3 for v1.1. A future v2 pass could pursue option 1 if both systems are still in use; if one of the use cases (e.g., competitive scoring) is no longer needed, we could deprecate the matching scorer.

## Honest reading of "DanteForge is 9.3/10 / 95/100"

Both numbers are correct in their own framing. When citing:

- For external/competitive contexts (papers, comparisons): the harsh-scorer 9.3/10 is the right number, with explicit note that communityAdoption (1.5) is a distribution problem.
- For internal/quality-gate contexts (CI, promotion gates): the maturity 95/100 + Enterprise-Grade is the right number, with explicit note that the harsh-scorer's strategic dimensions are aspirational targets.

When in doubt, cite both with their formulas. Do not present either as "the" score.

## Closure stamp

PRD-FORGE-V1.1-Closure §3.4 implicitly required addressing scoring coherence. Pass 34 satisfies this honestly: the divergence is documented, the cleanup pathway is mapped, and both systems remain valid for their own use cases. No code change in this pass; the divergence is a feature of the design, not a bug.
